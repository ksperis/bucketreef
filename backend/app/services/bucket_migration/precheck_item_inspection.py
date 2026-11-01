# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .diagnostics import MigrationPermissionCheckError
from .precheck_inspection import BucketMigrationInspector


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
class SourceBucketInspection:
    access_ok: bool
    object_count: int | None
    profile: dict[str, Any] | None


@dataclass(frozen=True)
class TargetBucketInspection:
    exists: bool | None
    object_count: int | None
    profile: dict[str, Any] | None


def _feature_label(feature: str) -> str:
    return _FEATURE_LABELS.get(feature, feature.replace("_", " ").strip().title())


class BucketMigrationItemInspector:
    def __init__(self, service: Any, inspector: BucketMigrationInspector) -> None:
        self._service = service
        self._inspector = inspector

    def inspect_source_bucket(
        self,
        context: Any,
        item: Any,
        *,
        probe_policy: Any,
        add_check: Callable[..., None],
    ) -> SourceBucketInspection:
        try:
            sampled_object = self._service._precheck_can_list_bucket(
                context, item.source_bucket
            )
        except Exception as exc:  # noqa: BLE001
            permission = (
                exc.permission if isinstance(exc, MigrationPermissionCheckError) else None
            )
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
            return SourceBucketInspection(
                access_ok=False,
                object_count=None,
                profile=None,
            )

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
        return SourceBucketInspection(
            access_ok=True,
            object_count=object_count,
            profile=profile,
        )

    def inspect_target_bucket(
        self,
        context: Any,
        item: Any,
        *,
        probe_policy: Any,
        add_check: Callable[..., None],
    ) -> TargetBucketInspection:
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
            return TargetBucketInspection(
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
        return TargetBucketInspection(
            exists=True,
            object_count=object_count,
            profile=profile,
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

    def _add_feature_availability_checks(
        self,
        profile: dict[str, Any] | None,
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
