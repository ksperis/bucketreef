# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.sensitive_data import sanitized_error_log_detail, sanitize_error_detail
from app.models.bucket_migration import BucketMigrationDiagnostic


SUPPORTED_BUCKET_SETTINGS = (
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
UNSUPPORTED_BUCKET_SETTINGS = (
    "acl",
    "website",
    "notifications",
    "replication",
)


@dataclass(frozen=True)
class PlannedPrecheckItem:
    report: dict[str, Any]
    infos: int
    warnings: int
    blocking_errors: int
    unsupported_features: frozenset[str]


@dataclass
class PrecheckAggregation:
    infos: int = 0
    warnings: int = 0
    blocking_errors: int = 0
    unsupported_features: set[str] = field(default_factory=set)

    def add(self, planned: PlannedPrecheckItem) -> None:
        self.infos += planned.infos
        self.warnings += planned.warnings
        self.blocking_errors += planned.blocking_errors
        self.unsupported_features.update(planned.unsupported_features)


def create_precheck_report(*, checked_at: Any) -> dict[str, Any]:
    return {
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


def build_diagnostic(
    *,
    code: str,
    severity: str,
    blocking: bool,
    scope: str,
    message: str,
    details: dict[str, Any] | None = None,
    permission: str | None = None,
) -> dict[str, Any]:
    return BucketMigrationDiagnostic(
        **{
            "code": code,
            "severity": severity,
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
            "context_id": None,
            "bucket": None,
            "details": sanitize_error_detail(details) if details else None,
        }
    ).model_dump(mode="json")


def count_diagnostics(entries: list[dict[str, Any]]) -> dict[str, int]:
    summary = {"errors": 0, "warnings": 0, "infos": 0, "blocking_errors": 0}
    for entry in entries:
        severity = str(entry.get("severity") or "").strip().lower()
        if severity == "error":
            summary["errors"] += 1
            if bool(entry.get("blocking")):
                summary["blocking_errors"] += 1
        elif severity == "warning":
            summary["warnings"] += 1
        else:
            summary["infos"] += 1
    return summary


def planned_bucket_settings(
    *,
    profile: dict[str, Any] | None,
    strategy: str,
    copy_bucket_settings: bool,
) -> tuple[list[str], list[str]]:
    configured = (profile or {}).get("supported_settings", {})
    availability = (profile or {}).get("feature_availability", {})
    copied = [
        name
        for name in SUPPORTED_BUCKET_SETTINGS
        if copy_bucket_settings
        and configured.get(name)
        and availability.get(name, {}).get("state", "available") == "available"
    ]
    if strategy == "version_aware" and "versioning" not in copied:
        copied.insert(0, "versioning")
    omitted = [
        name
        for name in (*SUPPORTED_BUCKET_SETTINGS, *UNSUPPORTED_BUCKET_SETTINGS)
        if name not in copied
    ]
    return copied, omitted


def build_planned_item_report(
    *,
    item: Any,
    source_object_count: int | None,
    target_object_count: int | None,
    source_profile: dict[str, Any] | None,
    target_profile: dict[str, Any] | None,
    strategy: str,
    unsupported_features: frozenset[str],
    checks: list[dict[str, Any]],
    copy_bucket_settings: bool,
) -> PlannedPrecheckItem:
    counts = count_diagnostics(checks)
    settings_copied, settings_omitted = planned_bucket_settings(
        profile=source_profile,
        strategy=strategy,
        copy_bucket_settings=copy_bucket_settings,
    )
    return PlannedPrecheckItem(
        report={
            "item_id": item.id,
            "source_bucket": item.source_bucket,
            "target_bucket": item.target_bucket,
            "strategy": strategy,
            "settings_copied": settings_copied,
            "settings_omitted": settings_omitted,
            "blocking": any(entry["blocking"] for entry in checks),
            "source_object_count": source_object_count,
            "target_object_count": target_object_count,
            "source_profile": source_profile,
            "target_profile": target_profile,
            "checks": checks,
            "errors": counts["errors"],
            "warnings": counts["warnings"],
        },
        infos=counts["infos"],
        warnings=counts["warnings"],
        blocking_errors=counts["blocking_errors"],
        unsupported_features=unsupported_features,
    )


def finalize_context_failure_report(
    report: dict[str, Any],
    *,
    item_count: int,
    entries: list[dict[str, Any]],
) -> dict[str, Any]:
    counts = count_diagnostics(entries)
    report["errors"] = counts["errors"]
    report["warnings"] = counts["warnings"]
    report["status"] = "failed"
    report["summary"] = {
        "items": item_count,
        "infos": counts["infos"],
        "warnings": counts["warnings"],
        "errors": counts["errors"],
        "blocking_errors": counts["blocking_errors"],
    }
    report["checks"] = entries
    return report


def finalize_precheck_report(
    report: dict[str, Any],
    *,
    aggregation: PrecheckAggregation,
) -> dict[str, Any]:
    report["unsupported_features"] = sorted(aggregation.unsupported_features)
    report["errors"] = aggregation.blocking_errors
    report["warnings"] = aggregation.warnings
    report["status"] = "failed" if aggregation.blocking_errors > 0 else "passed"
    report["summary"] = {
        "items": len(report["items"]),
        "infos": aggregation.infos,
        "warnings": aggregation.warnings,
        "errors": aggregation.blocking_errors,
        "blocking_errors": aggregation.blocking_errors,
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


def planned_item_state(
    planned: PlannedPrecheckItem,
    *,
    active_checks_enabled: bool,
) -> str:
    only_active_pending = all(
        not entry["blocking"] or entry["code"] == "active_checks_required"
        for entry in planned.report["checks"]
    )
    if only_active_pending and not active_checks_enabled:
        return "unverified"
    if planned.blocking_errors:
        return "blocked"
    if planned.warnings:
        return "warning"
    return "ready"
