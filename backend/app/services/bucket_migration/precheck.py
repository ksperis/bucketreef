# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from app.core.sensitive_data import sanitized_error_log_detail

from .precheck_inspection import BucketMigrationInspector
from .precheck_item_inspection import (
    BucketMigrationItemInspector,
    SourceBucketInspection,
    TargetBucketInspection,
)
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


@dataclass(frozen=True)
class _SourcePlan:
    strategy: str
    unsupported_features: frozenset[str]


class BucketMigrationPrecheckPlanner:
    def __init__(self, service: Any, inspector: BucketMigrationInspector) -> None:
        self._service = service
        self._inspector = inspector
        self._item_inspector = BucketMigrationItemInspector(service, inspector)
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

    def _plan_source_bucket(
        self,
        context: Any,
        item: Any,
        migration: Any,
        *,
        profile: dict[str, Any] | None,
        object_count: int | None,
        add_check: Callable[..., None],
    ) -> _SourcePlan:
        if profile is None:
            return _SourcePlan(
                strategy="current_only",
                unsupported_features=frozenset(),
            )

        profile["current_object_count"] = object_count
        unsupported_settings = list(profile.get("unsupported_settings") or [])
        unsupported_features = frozenset(
            str(setting) for setting in unsupported_settings
        )
        strategy = self._rules.evaluate_source_strategy(
            profile=profile,
            add_check=add_check,
        )
        self._rules.add_source_encryption_check(
            profile.get("encryption") or {},
            migration=migration,
            add_check=add_check,
        )
        self._rules.add_unsupported_settings_check(
            unsupported_settings,
            copy_bucket_settings=migration.copy_bucket_settings,
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
                same_endpoint_copy_requested=migration.use_same_endpoint_copy,
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
                same_endpoint_copy_requested=migration.use_same_endpoint_copy,
            )
            return None, None, entries

        entries.extend(self._missing_endpoint_diagnostics(source_ctx, target_ctx))
        return source_ctx, target_ctx, entries

    @staticmethod
    def _missing_endpoint_diagnostics(
        source_ctx: Any,
        target_ctx: Any,
    ) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
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
        return entries

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
        checks, add_check = self._create_item_check_collector(
            source_ctx,
            target_ctx,
            item,
        )
        source, target = self._inspect_item_buckets(
            source_ctx,
            target_ctx,
            item,
            probe_policy=probe_policy,
            add_check=add_check,
        )
        source_plan = self._plan_source_bucket(
            source_ctx,
            item,
            migration,
            profile=source.profile,
            object_count=source.object_count,
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
            copy_bucket_settings=migration.copy_bucket_settings,
        )

    def _inspect_item_buckets(
        self,
        source_ctx: Any,
        target_ctx: Any,
        item: Any,
        *,
        probe_policy: Any,
        add_check: Callable[..., None],
    ) -> tuple[SourceBucketInspection, TargetBucketInspection]:
        source = self._item_inspector.inspect_source_bucket(
            source_ctx,
            item,
            probe_policy=probe_policy,
            add_check=add_check,
        )
        target = self._item_inspector.inspect_target_bucket(
            target_ctx,
            item,
            probe_policy=probe_policy,
            add_check=add_check,
        )
        item.source_count = source.object_count
        item.target_count = target.object_count
        return source, target

    @staticmethod
    def _create_item_check_collector(
        source_ctx: Any,
        target_ctx: Any,
        item: Any,
    ) -> tuple[list[dict[str, Any]], Callable[..., None]]:
        checks: list[dict[str, Any]] = []

        def add_check(
            *,
            code: str,
            severity: str,
            blocking: bool,
            scope: str,
            message: str,
            details: dict[str, Any] | None = None,
            permission: str | None = None,
        ) -> None:
            check = build_diagnostic(
                code=code,
                severity=severity,
                blocking=blocking,
                scope=scope,
                message=message,
                details=details,
                permission=permission,
            )
            target_scope = scope.startswith("target")
            check["context_id"] = (
                target_ctx.context_id if target_scope else source_ctx.context_id
            )
            check["bucket"] = (
                item.target_bucket if target_scope else item.source_bucket
            )
            if permission:
                check["remediation"] = (
                    f"Allow {permission} for this execution identity, then run checks again."
                )
            checks.append(check)

        return checks, add_check

    def _store_item_plan(
        self,
        item: Any,
        *,
        checked_at: Any,
        source_profile: dict[str, Any] | None,
        strategy: str,
    ) -> None:
        item.source_snapshot = source_profile
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
            copy_bucket_settings=migration.copy_bucket_settings
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
