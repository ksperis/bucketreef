# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from app.core.sensitive_data import sanitized_error_log_detail, sanitize_error_detail
from app.models.bucket_migration import BucketMigrationDiagnostic

from .precheck_inspection import BucketMigrationInspector
from .precheck_rules import BucketMigrationPrecheckRules, PrecheckItemSafety


_PRECHECK_REPORT_VERSION = 3
_SUPPORTED_BUCKET_SETTINGS = (
    "versioning",
    "object_lock",
    "encryption",
    "public_access_block",
    "lifecycle",
    "cors",
    "tags",
    "access_logging",
    "bucket_policy",
)
_UNSUPPORTED_BUCKET_SETTINGS = (
    "acl",
    "website",
    "notifications",
    "replication",
)
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


@dataclass(frozen=True)
class _PlannedItem:
    report: dict[str, Any]
    infos: int
    warnings: int
    blocking_errors: int
    same_endpoint_copy_safe: bool
    delete_source_safe: bool
    rollback_safe: bool
    unsupported_features: frozenset[str]


def _check_entry(
    *,
    code: str,
    severity: str,
    blocking: bool,
    scope: str,
    message: str,
    details: Optional[dict[str, Any]] = None,
    permission: str | None = None,
) -> dict[str, Any]:
    return BucketMigrationDiagnostic(
        **{
            "code": code,
            "severity": severity,
            "level": severity,
            "blocking": bool(blocking),
            "scope": scope,
            "message": sanitized_error_log_detail(message),
            "remediation": (
                (
                    "Choose a new destination name."
                    if code == "target_exists"
                    else "Review the indicated context permissions or configuration, then run checks again."
                )
                if blocking
                else None
            ),
            "impact": (
                "Copy cannot start until this check is resolved." if blocking else None
            ),
            "permission": permission,
            "details": sanitize_error_detail(details) if details else None,
        }
    ).model_dump(exclude_none=True)


def _count_entries(entries: list[dict[str, Any]]) -> dict[str, int]:
    summary = {"errors": 0, "warnings": 0, "infos": 0, "blocking_errors": 0}
    for entry in entries:
        severity = (
            str(entry.get("severity") or entry.get("level") or "").strip().lower()
        )
        if severity == "error":
            summary["errors"] += 1
            if bool(entry.get("blocking")):
                summary["blocking_errors"] += 1
        elif severity == "warning":
            summary["warnings"] += 1
        else:
            summary["infos"] += 1
    return summary


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
            "supported_bucket_settings": list(_SUPPORTED_BUCKET_SETTINGS),
            "unsupported_bucket_settings": list(_UNSUPPORTED_BUCKET_SETTINGS),
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
            capability = str(raw.get("capability") or "").strip() or None
            reason = str(raw.get("reason") or "").strip() or None
            feature_label = _feature_label(feature_name)
            details = {"feature": feature_name, "state": state}
            if capability:
                details["capability"] = capability
            if reason:
                details["reason"] = reason
            if state == "disabled_by_endpoint":
                add_check(
                    code=f"{scope_prefix}_feature_disabled_on_endpoint",
                    severity="info",
                    blocking=False,
                    scope=f"{scope_prefix}_bucket",
                    message=(
                        f"{feature_label} inspection skipped because endpoint capability "
                        f"'{capability or feature_name}' is disabled."
                    ),
                    details=details,
                )
            elif state == "skipped_not_required":
                add_check(
                    code=f"{scope_prefix}_feature_skipped_not_required",
                    severity="info",
                    blocking=False,
                    scope=f"{scope_prefix}_bucket",
                    message=(
                        f"{feature_label} inspection skipped because it is not required "
                        "when bucket settings copy is disabled."
                    ),
                    details=details,
                )
            elif state == "unavailable":
                add_check(
                    code=f"{scope_prefix}_feature_probe_unavailable",
                    severity="error",
                    blocking=True,
                    scope=f"{scope_prefix}_bucket",
                    message=f"{feature_label} could not be verified. This required inspection is unavailable on the endpoint.",
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
            add_check(
                code="source_access_failed",
                severity="error",
                blocking=True,
                scope="source_bucket",
                message=f"Source bucket read/list check failed: {exc}",
                permission=getattr(exc, "permission", None),
                details=getattr(exc, "details", None),
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

        object_count: int | None = None
        try:
            object_count = int(
                self._service._count_bucket_objects(context, item.source_bucket)
            )
            add_check(
                code="source_count_ok",
                severity="info",
                blocking=False,
                scope="source_bucket",
                message=f"Source bucket object count: {object_count}.",
                details={"current_object_count": object_count},
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="source_count_failed",
                severity="warning",
                blocking=False,
                scope="source_bucket",
                message=f"Unable to count source bucket objects: {exc}",
            )

        profile: dict[str, Any] | None = None
        try:
            profile = self._inspector.inspect_bucket_state(
                context,
                item.source_bucket,
                probe_policy=probe_policy,
            )
            self._add_feature_availability_checks(
                profile,
                scope_prefix="source",
                add_check=add_check,
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="source_profile_inspection_failed",
                severity="error",
                blocking=True,
                scope="source_bucket",
                message=f"Unable to inspect source bucket features: {exc}",
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

        object_count: int | None = None
        try:
            object_count = int(
                self._service._count_bucket_objects(context, item.target_bucket)
            )
            add_check(
                code="target_count_ok",
                severity="info",
                blocking=False,
                scope="target_bucket",
                message=f"Target bucket object count: {object_count}.",
                details={"current_object_count": object_count},
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="target_count_failed",
                severity="warning",
                blocking=False,
                scope="target_bucket",
                message=f"Unable to count target bucket objects: {exc}",
            )

        profile: dict[str, Any] | None = None
        try:
            profile = self._inspector.inspect_bucket_state(
                context,
                item.target_bucket,
                probe_policy=probe_policy,
            )
            self._add_feature_availability_checks(
                profile,
                scope_prefix="target",
                add_check=add_check,
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="target_profile_inspection_failed",
                severity="warning",
                blocking=False,
                scope="target_bucket",
                message=f"Unable to inspect existing target bucket features: {exc}",
            )
        return _TargetInspection(
            exists=True, object_count=object_count, profile=profile
        )

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

        versioning = profile.get("versioning") or {}
        version_scan = profile.get("version_scan") or {}
        object_lock = profile.get("object_lock") or {}
        requires_version_aware = bool(
            versioning.get("enabled")
            or versioning.get("suspended")
            or version_scan.get("has_noncurrent_versions")
            or version_scan.get("has_delete_markers")
        )
        requires_object_lock_governance = bool(
            object_lock.get("enabled")
            or object_lock.get("mode")
            or object_lock.get("days") is not None
            or object_lock.get("years") is not None
        )
        strategy = (
            "version_aware"
            if requires_version_aware or requires_object_lock_governance
            else initial_strategy
        )
        self._rules.add_source_strategy_check(
            versioning=versioning,
            version_scan=version_scan,
            object_lock=object_lock,
            requires_version_aware=requires_version_aware,
            requires_object_lock_governance=requires_object_lock_governance,
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

        if strategy == "version_aware" and not requires_object_lock_governance:
            self._rules.validate_version_aware_source_access(
                context,
                item,
                profile,
                add_check=add_check,
            )

        return _SourcePlan(
            strategy=strategy,
            unsupported_features=unsupported_features,
        )

    def _new_report(self, *, checked_at: Any) -> dict[str, Any]:
        return {
            "report_version": _PRECHECK_REPORT_VERSION,
            "status": "passed",
            "checked_at": checked_at.isoformat(),
            "contexts": {},
            "items": [],
            "errors": 0,
            "warnings": 0,
            "summary": {},
            "capabilities": {},
            "unsupported_features": [],
        }

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
                _check_entry(
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
                _check_entry(
                    code="source_endpoint_missing",
                    severity="error",
                    blocking=True,
                    scope="source_context",
                    message="Source context endpoint is missing.",
                )
            )
        if not target_ctx.endpoint:
            entries.append(
                _check_entry(
                    code="target_endpoint_missing",
                    severity="error",
                    blocking=True,
                    scope="target_context",
                    message="Target context endpoint is missing.",
                )
            )
        return source_ctx, target_ctx, entries

    def _context_failure_report(
        self,
        report: dict[str, Any],
        migration: Any,
        entries: list[dict[str, Any]],
    ) -> dict[str, Any]:
        counts = _count_entries(entries)
        report["errors"] = counts["errors"]
        report["warnings"] = counts["warnings"]
        report["status"] = "failed"
        report["summary"] = {
            "items": len(migration.items),
            "infos": counts["infos"],
            "warnings": counts["warnings"],
            "errors": counts["errors"],
            "blocking_errors": counts["blocking_errors"],
        }
        report["checks"] = entries
        return report

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
    ) -> _PlannedItem:
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
                _check_entry(
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
        item.source_snapshot_json = self._service._json_dumps_safe(source.profile)
        safety = self._rules.evaluate_item_safety(
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
        counts = _count_entries(checks)
        blocking = any(entry["blocking"] for entry in checks)
        self._store_item_plan(
            item,
            checked_at=checked_at,
            source_profile=source.profile,
            target_profile=target.profile,
            strategy=source_plan.strategy,
            safety=safety,
            blocking=blocking,
            checks=checks,
        )
        configured = (source.profile or {}).get("supported_settings", {})
        availability = (source.profile or {}).get("feature_availability", {})
        settings_copied = [
            name
            for name in _SUPPORTED_BUCKET_SETTINGS
            if migration.copy_bucket_settings
            and configured.get(name)
            and availability.get(name, {}).get("state", "available") == "available"
        ]
        if (
            source_plan.strategy == "version_aware"
            and "versioning" not in settings_copied
        ):
            settings_copied.insert(0, "versioning")
        settings_omitted = [
            name
            for name in (*_SUPPORTED_BUCKET_SETTINGS, *_UNSUPPORTED_BUCKET_SETTINGS)
            if name not in settings_copied
        ]
        return _PlannedItem(
            report={
                "item_id": item.id,
                "source_bucket": item.source_bucket,
                "target_bucket": item.target_bucket,
                "strategy": source_plan.strategy,
                "settings_copied": settings_copied,
                "settings_omitted": settings_omitted,
                "blocking": blocking,
                "delete_source_safe": safety.delete_source_safe,
                "rollback_safe": safety.rollback_safe,
                "same_endpoint_copy_safe": safety.same_endpoint_copy_safe,
                "source_object_count": source.object_count,
                "target_object_count": target.object_count,
                "source_profile": source.profile,
                "target_profile": target.profile,
                "checks": checks,
                "messages": checks,
                "errors": counts["errors"],
                "warnings": counts["warnings"],
            },
            infos=counts["infos"],
            warnings=counts["warnings"],
            blocking_errors=counts["blocking_errors"],
            same_endpoint_copy_safe=safety.same_endpoint_copy_safe,
            delete_source_safe=safety.delete_source_safe,
            rollback_safe=safety.rollback_safe,
            unsupported_features=source_plan.unsupported_features,
        )

    def _store_item_plan(
        self,
        item: Any,
        *,
        checked_at: Any,
        source_profile: dict[str, Any] | None,
        target_profile: dict[str, Any] | None,
        strategy: str,
        safety: PrecheckItemSafety,
        blocking: bool,
        checks: list[dict[str, Any]],
    ) -> None:
        item.source_snapshot_json = self._service._json_dumps_safe(source_profile)
        item.target_snapshot_json = self._service._json_dumps_safe(target_profile)
        execution_plan = {
            "report_version": _PRECHECK_REPORT_VERSION,
            "strategy": strategy,
            "supported": not blocking,
            "blocked": blocking,
            "delete_source_safe": safety.delete_source_safe,
            "rollback_safe": safety.rollback_safe,
            "same_endpoint_copy_safe": safety.same_endpoint_copy_safe,
            "blocking_codes": [
                entry["code"] for entry in checks if bool(entry.get("blocking"))
            ],
        }
        item.execution_plan_json = self._service._json_dumps_safe(execution_plan)
        item.updated_at = checked_at

    def _finalize_report(
        self,
        report: dict[str, Any],
        *,
        infos: int,
        warnings: int,
        blocking_errors: int,
        same_endpoint_copy_safe: bool,
        delete_source_safe: bool,
        rollback_safe: bool,
        unsupported_features: set[str],
    ) -> dict[str, Any]:
        report["same_endpoint_copy_safe"] = same_endpoint_copy_safe
        report["delete_source_safe"] = delete_source_safe
        report["rollback_safe"] = rollback_safe
        report["unsupported_features"] = sorted(unsupported_features)
        report["errors"] = blocking_errors
        report["warnings"] = warnings
        report["status"] = "failed" if blocking_errors > 0 else "passed"
        report["summary"] = {
            "items": len(report["items"]),
            "infos": infos,
            "warnings": warnings,
            "errors": blocking_errors,
            "blocking_errors": blocking_errors,
            "strategies": {
                strategy: sum(
                    item.get("strategy") == strategy for item in report["items"]
                )
                for strategy in (
                    "current_only",
                    "version_aware",
                    "skip_existing",
                )
            },
        }
        return report

    def run(
        self, migration: Any, *, checked_at: Any, on_progress=None
    ) -> dict[str, Any]:
        report = self._new_report(checked_at=checked_at)
        source_ctx, target_ctx, context_entries = self._resolve_contexts(
            migration,
            report,
        )
        if source_ctx is None or target_ctx is None or context_entries:
            return self._context_failure_report(
                report,
                migration,
                context_entries,
            )

        same_endpoint = bool(report.get("same_endpoint"))
        same_endpoint_copy_enabled = bool(
            same_endpoint and migration.use_same_endpoint_copy
        )
        global_same_endpoint_copy_safe = True
        global_delete_source_safe = True
        global_rollback_safe = True
        global_unsupported_features: set[str] = set()
        blocking_errors = 0
        warnings = 0
        infos = 0
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
            only_active_pending = all(
                not entry["blocking"] or entry["code"] == "active_checks_required"
                for entry in planned.report["checks"]
            )
            planned.report["state"] = (
                "unverified"
                if only_active_pending
                and not getattr(self._service, "_preparation_active_checks", False)
                else (
                    "blocked"
                    if planned.blocking_errors
                    else "warning" if planned.warnings else "ready"
                )
            )
            planned.report["source_identity"] = migration.source_context_id
            planned.report["target_identity"] = migration.target_context_id
            report["items"].append(planned.report)
            if on_progress:
                on_progress(report)
            infos += planned.infos
            warnings += planned.warnings
            blocking_errors += planned.blocking_errors
            global_unsupported_features.update(planned.unsupported_features)
            global_same_endpoint_copy_safe = (
                global_same_endpoint_copy_safe and planned.same_endpoint_copy_safe
            )
            global_delete_source_safe = (
                global_delete_source_safe and planned.delete_source_safe
            )
            global_rollback_safe = global_rollback_safe and planned.rollback_safe

        return self._finalize_report(
            report,
            infos=infos,
            warnings=warnings,
            blocking_errors=blocking_errors,
            same_endpoint_copy_safe=global_same_endpoint_copy_safe,
            delete_source_safe=global_delete_source_safe,
            rollback_safe=global_rollback_safe,
            unsupported_features=global_unsupported_features,
        )
