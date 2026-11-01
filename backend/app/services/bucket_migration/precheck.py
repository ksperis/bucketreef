# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from app.core.sensitive_data import sanitized_error_log_detail

from .diagnostics import MigrationPermissionCheckError
from .precheck_inspection import BucketMigrationInspector
from .precheck_reporting import (
    SUPPORTED_BUCKET_SETTINGS,
    UNSUPPORTED_BUCKET_SETTINGS,
    PlannedPrecheckItem,
    PrecheckAggregation,
    build_diagnostic,
    build_planned_item_report,
    create_precheck_report,
    finalize_context_failure_report,
    finalize_precheck_report,
    planned_item_state,
)
from .precheck_rules import BucketMigrationPrecheckRules


_FEATURE_LABELS = {
    "versioning": "Versioning",
    "object_lock": "Object lock",
    "encryption": "Encryption",
    "public_access_block": "Public access block",
    "lifecycle": "Lifecycle",
    "cors": "CORS",
    "tags": "Tags",
    "access_logging": "Access logging",
    "bucket_policy": "Bucket policy",
    "acl": "ACL",
    "website": "Website",
    "notifications": "Notifications",
    "replication": "Replication",
}
_FEATURE_AVAILABILITY_CHECKS: dict[str, tuple[str, str, bool, str]] = {
    "disabled_by_endpoint": (
        "feature_disabled_on_endpoint",
        "info",
        False,
        "{feature_label} inspection skipped because endpoint capability '{capability}' is disabled.",
    ),
    "skipped_not_required": (
        "feature_skipped_not_required",
        "info",
        False,
        "{feature_label} inspection skipped because it is not required when bucket settings copy is disabled.",
    ),
    "unavailable": (
        "feature_probe_unavailable",
        "error",
        True,
        "{feature_label} could not be verified. This required inspection is unavailable on the endpoint.",
    ),
}


@dataclass(frozen=True)
class _SourceInspection:
    access_ok: bool
    object_count: int | None
    profile: dict[str, Any] | None


@dataclass(frozen=True)
class _TargetInspection:
    exists: bool | None
    object_count: int | None
    profile: dict[str, Any] | None


@dataclass(frozen=True)
class _SourcePlan:
    strategy: str
    unsupported_features: frozenset[str]


def _feature_label(feature: str) -> str:
    return _FEATURE_LABELS.get(feature, feature.replace("_", " ").strip().title())


class BucketMigrationPrecheckPlanner:
    def __init__(self, service: Any, inspector: BucketMigrationInspector) -> None:
        self._service = service
        self._inspector = inspector
        self._rules = BucketMigrationPrecheckRules(service)

    def _global_capabilities(
        self, *, same_endpoint: bool, same_endpoint_copy_requested: bool
    ) -> dict[str, Any]:
        return {
            "supported_strategies": ["current_only", "version_aware"],
            "version_aware_available": True,
            "same_endpoint": bool(same_endpoint),
            "same_endpoint_copy_requested": bool(same_endpoint_copy_requested),
            "supported_bucket_settings": list(SUPPORTED_BUCKET_SETTINGS),
            "unsupported_bucket_settings": list(UNSUPPORTED_BUCKET_SETTINGS),
        }

    def _add_feature_availability_checks(
        self,
        profile: Optional[dict[str, Any]],
        *,
        scope_prefix: str,
        add_check: Callable[..., None],
    ) -> None:
        if not isinstance(profile, dict):
            return
        feature_availability = profile.get("feature_availability")
        if not isinstance(feature_availability, dict):
            return
        for feature_name, raw in feature_availability.items():
            if not isinstance(feature_name, str) or not isinstance(raw, dict):
                continue
            state = str(raw.get("state") or "").strip().lower()
            if not state or state == "available":
                continue
            check = _FEATURE_AVAILABILITY_CHECKS.get(state)
            if check is None:
                continue
            capability = str(raw.get("capability") or "").strip() or None
            reason = str(raw.get("reason") or "").strip() or None
            feature_label = _feature_label(feature_name)
            details = {"feature": feature_name, "state": state}
            if capability:
                details["capability"] = capability
            if reason:
                details["reason"] = reason
            code_suffix, severity, blocking, message_template = check
            add_check(
                code=f"{scope_prefix}_{code_suffix}",
                severity=severity,
                blocking=blocking,
                scope=f"{scope_prefix}_bucket",
                message=message_template.format(
                    feature_label=feature_label,
                    capability=capability or feature_name,
                ),
                details=details,
            )

    def _inspect_source_bucket(
        self,
        context: Any,
        item: Any,
        *,
        probe_policy: Any,
        add_check: Callable[..., None],
    ) -> _SourceInspection:
        try:
            sampled_object = self._service._precheck_can_list_bucket(
                context, item.source_bucket
            )
        except Exception as exc:  # noqa: BLE001
            permission = exc.permission if isinstance(exc, MigrationPermissionCheckError) else None
            details = exc.details if isinstance(exc, MigrationPermissionCheckError) else None
            add_check(
                code="source_access_failed",
                severity="error",
                blocking=True,
                scope="source_bucket",
                message=f"Source bucket read/list check failed: {exc}",
                permission=permission,
                details=details,
            )
            return _SourceInspection(access_ok=False, object_count=None, profile=None)

        add_check(
            code="source_access_ok",
            severity="info",
            blocking=False,
            scope="source_bucket",
            message=(
                "Source listing is readable. No current object is available to test content and tag reads."
                if sampled_object is False
                else "Source listing, sample content and sample tags are readable."
            ),
        )
        if sampled_object is False:
            add_check(
                code="source_object_reads_not_tested",
                severity="warning",
                blocking=False,
                scope="source_bucket",
                message="Content and tag permissions are unverified for this empty bucket. They will be checked again before copying if objects appear.",
            )

        object_count, profile = self._inspect_existing_bucket_details(
            context,
            item.source_bucket,
            scope_prefix="source",
            probe_policy=probe_policy,
            add_check=add_check,
            profile_error_severity="error",
            profile_error_blocking=True,
            profile_error_message="Unable to inspect source bucket features",
        )
        return _SourceInspection(
            access_ok=True, object_count=object_count, profile=profile
        )

    def _inspect_target_bucket(
        self,
        context: Any,
        item: Any,
        *,
        probe_policy: Any,
        add_check: Callable[..., None],
    ) -> _TargetInspection:
        target_exists: bool | None = None
        try:
            target_exists = self._service._precheck_bucket_exists(
                context, item.target_bucket
            )
            if target_exists is True:
                add_check(
                    code="target_exists",
                    severity="error",
                    blocking=True,
                    scope="target_bucket",
                    message="Destination already exists. Choose a new name, even if this bucket is empty.",
                )
            elif target_exists is False:
                add_check(
                    code="target_missing",
                    severity="info",
                    blocking=False,
                    scope="target_bucket",
                    message="Target bucket does not exist.",
                )
            else:
                add_check(
                    code="target_existence_unknown",
                    severity="error",
                    blocking=True,
                    scope="target_bucket",
                    message="Unable to verify whether target bucket exists.",
                )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="target_existence_failed",
                severity="error",
                blocking=True,
                scope="target_bucket",
                message=f"Target bucket existence check failed: {exc}",
            )

        if target_exists is not True:
            return _TargetInspection(
                exists=target_exists,
                object_count=0 if target_exists is False else None,
                profile=None,
            )

        object_count, profile = self._inspect_existing_bucket_details(
            context,
            item.target_bucket,
            scope_prefix="target",
            probe_policy=probe_policy,
            add_check=add_check,
            profile_error_severity="warning",
            profile_error_blocking=False,
            profile_error_message="Unable to inspect existing target bucket features",
        )
        return _TargetInspection(
            exists=True, object_count=object_count, profile=profile
        )

    def _inspect_existing_bucket_details(
        self,
        context: Any,
        bucket_name: str,
        *,
        scope_prefix: str,
        probe_policy: Any,
        add_check: Callable[..., None],
        profile_error_severity: str,
        profile_error_blocking: bool,
        profile_error_message: str,
    ) -> tuple[int | None, dict[str, Any] | None]:
        scope = f"{scope_prefix}_bucket"
        label = scope_prefix.title()
        object_count: int | None = None
        try:
            object_count = int(self._service._count_bucket_objects(context, bucket_name))
            add_check(
                code=f"{scope_prefix}_count_ok",
                severity="info",
                blocking=False,
                scope=scope,
                message=f"{label} bucket object count: {object_count}.",
                details={"current_object_count": object_count},
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code=f"{scope_prefix}_count_failed",
                severity="warning",
                blocking=False,
                scope=scope,
                message=f"Unable to count {scope_prefix} bucket objects: {exc}",
            )

        profile: dict[str, Any] | None = None
        try:
            profile = self._inspector.inspect_bucket_state(
                context,
                bucket_name,
                probe_policy=probe_policy,
            )
            self._add_feature_availability_checks(
                profile,
                scope_prefix=scope_prefix,
                add_check=add_check,
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code=f"{scope_prefix}_profile_inspection_failed",
                severity=profile_error_severity,
                blocking=profile_error_blocking,
                scope=scope,
                message=f"{profile_error_message}: {exc}",
            )
        return object_count, profile

    def _plan_source_bucket(
        self,
        context: Any,
        item: Any,
        migration: Any,
        *,
        profile: dict[str, Any] | None,
        object_count: int | None,
        initial_strategy: str,
        add_check: Callable[..., None],
    ) -> _SourcePlan:
        if profile is None:
            return _SourcePlan(
                strategy=initial_strategy,
                unsupported_features=frozenset(),
            )

        profile["current_object_count"] = object_count
        unsupported_settings = list(profile.get("unsupported_settings") or [])
        unsupported_features = frozenset(
            str(setting) for setting in unsupported_settings
        )
        if initial_strategy == "skip_existing":
            return _SourcePlan(
                strategy=initial_strategy,
                unsupported_features=unsupported_features,
            )

        strategy = self._rules.evaluate_source_strategy(
            profile=profile,
            initial_strategy=initial_strategy,
            add_check=add_check,
        )
        self._rules.add_source_encryption_check(
            profile.get("encryption") or {},
            migration=migration,
            add_check=add_check,
        )
        self._rules.add_unsupported_settings_check(
            unsupported_settings,
            copy_bucket_settings=bool(migration.copy_bucket_settings),
            add_check=add_check,
        )

        if (
            strategy.strategy == "version_aware"
            and not strategy.requires_object_lock_governance
        ):
            self._rules.validate_version_aware_source_access(
                context,
                item,
                profile,
                add_check=add_check,
            )

        return _SourcePlan(
            strategy=strategy.strategy,
            unsupported_features=unsupported_features,
        )

    def _resolve_contexts(
        self,
        migration: Any,
        report: dict[str, Any],
    ) -> tuple[Any | None, Any | None, list[dict[str, Any]]]:
        entries: list[dict[str, Any]] = []
        try:
            source_ctx = self._service._resolve_context(migration.source_context_id)
            target_ctx = self._service._resolve_context(migration.target_context_id)
            same_endpoint = self._service._is_same_endpoint(
                source_ctx,
                target_ctx,
            )
            report["contexts"] = {
                "source": {
                    "context_id": source_ctx.context_id,
                    "endpoint": source_ctx.endpoint,
                    "region": source_ctx.region,
                },
                "target": {
                    "context_id": target_ctx.context_id,
                    "endpoint": target_ctx.endpoint,
                    "region": target_ctx.region,
                },
            }
            report["same_endpoint"] = bool(same_endpoint)
            report["capabilities"] = self._global_capabilities(
                same_endpoint=same_endpoint,
                same_endpoint_copy_requested=bool(migration.use_same_endpoint_copy),
            )
        except Exception as exc:  # noqa: BLE001
            entries.append(
                build_diagnostic(
                    code="context_resolution_failed",
                    severity="error",
                    blocking=True,
                    scope="migration",
                    message=(
                        "Unable to resolve migration contexts: "
                        f"{sanitized_error_log_detail(exc)}"
                    ),
                )
            )
            report["contexts_error"] = sanitized_error_log_detail(exc)
            report["capabilities"] = self._global_capabilities(
                same_endpoint=False,
                same_endpoint_copy_requested=bool(migration.use_same_endpoint_copy),
            )
            return None, None, entries

        if not source_ctx.endpoint:
            entries.append(
                build_diagnostic(
                    code="source_endpoint_missing",
                    severity="error",
                    blocking=True,
                    scope="source_context",
                    message="Source context endpoint is missing.",
                )
            )
        if not target_ctx.endpoint:
            entries.append(
                build_diagnostic(
                    code="target_endpoint_missing",
                    severity="error",
                    blocking=True,
                    scope="target_context",
                    message="Target context endpoint is missing.",
                )
            )
        return source_ctx, target_ctx, entries

    def _plan_item(
        self,
        source_ctx: Any,
        target_ctx: Any,
        item: Any,
        migration: Any,
        *,
        checked_at: Any,
        probe_policy: Any,
        same_endpoint_copy_enabled: bool,
    ) -> PlannedPrecheckItem:
        checks: list[dict[str, Any]] = []

        def add_check(
            *,
            code: str,
            severity: str,
            blocking: bool,
            scope: str,
            message: str,
            details: Optional[dict[str, Any]] = None,
            permission: str | None = None,
        ) -> None:
            checks.append(
                build_diagnostic(
                    code=code,
                    severity=severity,
                    blocking=blocking,
                    scope=scope,
                    message=message,
                    details=details,
                    permission=permission,
                )
            )
            target_scope = scope.startswith("target")
            checks[-1]["context_id"] = (
                target_ctx.context_id if target_scope else source_ctx.context_id
            )
            checks[-1]["bucket"] = (
                item.target_bucket if target_scope else item.source_bucket
            )
            if permission:
                checks[-1][
                    "remediation"
                ] = f"Allow {permission} for this execution identity, then run checks again."

        source = self._inspect_source_bucket(
            source_ctx,
            item,
            probe_policy=probe_policy,
            add_check=add_check,
        )
        target = self._inspect_target_bucket(
            target_ctx,
            item,
            probe_policy=probe_policy,
            add_check=add_check,
        )
        item.source_count = source.object_count
        item.target_count = target.object_count
        source_plan = self._plan_source_bucket(
            source_ctx,
            item,
            migration,
            profile=source.profile,
            object_count=source.object_count,
            initial_strategy=("current_only"),
            add_check=add_check,
        )
        self._rules.add_item_safety_checks(
            source_ctx,
            target_ctx,
            item,
            migration,
            source_access_ok=source.access_ok,
            source_profile=source.profile,
            target_exists=target.exists,
            strategy=source_plan.strategy,
            same_endpoint_copy_enabled=same_endpoint_copy_enabled,
            add_check=add_check,
        )
        self._store_item_plan(
            item,
            checked_at=checked_at,
            source_profile=source.profile,
            target_profile=target.profile,
            strategy=source_plan.strategy,
        )
        return build_planned_item_report(
            item=item,
            source_object_count=source.object_count,
            target_object_count=target.object_count,
            source_profile=source.profile,
            target_profile=target.profile,
            strategy=source_plan.strategy,
            unsupported_features=source_plan.unsupported_features,
            checks=checks,
            copy_bucket_settings=bool(migration.copy_bucket_settings),
        )

    def _store_item_plan(
        self,
        item: Any,
        *,
        checked_at: Any,
        source_profile: dict[str, Any] | None,
        target_profile: dict[str, Any] | None,
        strategy: str,
    ) -> None:
        item.source_snapshot = source_profile
        item.target_snapshot = target_profile
        item.execution_strategy = strategy
        item.updated_at = checked_at

    def run(
        self, migration: Any, *, checked_at: Any, on_progress=None
    ) -> dict[str, Any]:
        report = create_precheck_report(checked_at=checked_at)
        source_ctx, target_ctx, context_entries = self._resolve_contexts(
            migration,
            report,
        )
        if source_ctx is None or target_ctx is None or context_entries:
            return finalize_context_failure_report(
                report,
                item_count=len(migration.items),
                entries=context_entries,
            )

        same_endpoint = bool(report.get("same_endpoint"))
        same_endpoint_copy_enabled = bool(
            same_endpoint and migration.use_same_endpoint_copy
        )
        aggregation = PrecheckAggregation()
        probe_policy = self._inspector.build_probe_policy(
            copy_bucket_settings=bool(migration.copy_bucket_settings)
        )

        for item in sorted(migration.items, key=lambda entry: entry.id):
            if on_progress:
                on_progress(report)
            self._service._preparation_item = item
            planned = self._plan_item(
                source_ctx,
                target_ctx,
                item,
                migration,
                checked_at=checked_at,
                probe_policy=probe_policy,
                same_endpoint_copy_enabled=same_endpoint_copy_enabled,
            )
            planned.report["state"] = planned_item_state(
                planned,
                active_checks_enabled=bool(self._service._preparation_active_checks),
            )
            report["items"].append(planned.report)
            if on_progress:
                on_progress(report)
            aggregation.add(planned)

        return finalize_precheck_report(
            report,
            aggregation=aggregation,
        )
