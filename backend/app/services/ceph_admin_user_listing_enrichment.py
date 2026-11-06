# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, Optional

from app.models.ceph_admin import CephAdminRgwUserSummary
from app.services.ceph_admin_account_access import resolve_optional_account_name
from app.services.ceph_admin_errors import upstream_error
from app.services.ceph_admin_user_payloads import extract_user_fields
from app.services.listing_progress import (
    ListingProgressEmitter,
    interpolate_progress_percent,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.cancellation import invoke_cancel_check
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.usage_stats import summarize_bucket_usage


class _UserDetailsEnricher:
    def __init__(
        self,
        *,
        users: list[CephAdminRgwUserSummary],
        requested: set[str],
        rgw_admin: RGWAdminClient,
        account_lookup_enabled: bool | None,
        progress: ListingProgressEmitter | None,
        progress_stage: str,
        progress_message: str,
        progress_start: int,
        progress_end: int,
        cancel_check: Callable[[], None] | None,
    ) -> None:
        self.users = users
        self.requested = requested
        self.rgw_admin = rgw_admin
        self.account_lookup_enabled = account_lookup_enabled
        self.progress = progress
        self.progress_stage = progress_stage
        self.progress_message = progress_message
        self.progress_start = progress_start
        self.progress_end = progress_end
        self.cancel_check = cancel_check
        self.account_name_by_id: dict[str, Optional[str]] = {}

    def run(self) -> list[CephAdminRgwUserSummary]:
        enriched: list[CephAdminRgwUserSummary] = []
        total = len(self.users)
        for index, item in enumerate(self.users, start=1):
            invoke_cancel_check(self.cancel_check)
            enriched.append(self._enrich_user(item))
            if self.progress is not None:
                self.progress.emit(
                    percent=interpolate_progress_percent(
                        self.progress_start,
                        self.progress_end,
                        processed=index,
                        total=total,
                    ),
                    stage=self.progress_stage,
                    processed=index,
                    total=total,
                    message=self.progress_message,
                )
            invoke_cancel_check(self.cancel_check)
        return enriched

    def _enrich_user(self, item: CephAdminRgwUserSummary) -> CephAdminRgwUserSummary:
        user = item.model_copy(deep=True)
        try:
            payload = self.rgw_admin.get_user(
                user.uid,
                tenant=user.tenant,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise upstream_error(exc) from exc
        if not payload or payload.get("not_found"):
            return user
        self._apply_payload(user, payload)
        return user

    def _apply_payload(
        self,
        user: CephAdminRgwUserSummary,
        payload: dict[str, Any],
    ) -> None:
        fields = extract_user_fields(payload, self.requested)
        if "account" in self.requested:
            user.account_id = fields.account_id
            user.account_name = resolve_optional_account_name(
                fields.account_id,
                fields.account_name,
                self.rgw_admin,
                account_lookup_enabled=self.account_lookup_enabled,
                cache=self.account_name_by_id,
            )
        if "profile" in self.requested:
            user.full_name = fields.display_name
            user.email = fields.email
        if "status" in self.requested:
            user.suspended = fields.suspended
        if "limits" in self.requested:
            user.max_buckets = fields.max_buckets
        if "quota" in self.requested:
            user.quota_max_size_bytes = fields.quota_max_size_bytes
            user.quota_max_objects = fields.quota_max_objects
        if "usage" in self.requested:
            self._apply_usage(user)

    def _apply_usage(self, user: CephAdminRgwUserSummary) -> None:
        lookup_uid = f"{user.tenant}${user.uid}" if user.tenant else user.uid
        try:
            buckets_payload = self.rgw_admin.get_all_buckets(
                uid=lookup_uid,
                with_stats=True,
            )
        except RGWAdminError as exc:
            raise upstream_error(exc) from exc
        _usage, total_bytes, total_objects, _count = summarize_bucket_usage(
            extract_bucket_list(buckets_payload)
        )
        user.used_bytes = total_bytes
        user.object_count = total_objects


def enrich_users(
    users: list[CephAdminRgwUserSummary],
    requested: set[str],
    rgw_admin: RGWAdminClient,
    *,
    account_lookup_enabled: bool | None,
    progress: ListingProgressEmitter | None = None,
    progress_stage: str = "detail_enrichment",
    progress_message: str = "Loading user details",
    progress_start: int = 50,
    progress_end: int = 64,
    cancel_check: Callable[[], None] | None = None,
) -> list[CephAdminRgwUserSummary]:
    if not users or not requested:
        return users
    return _UserDetailsEnricher(
        users=users,
        requested=requested,
        rgw_admin=rgw_admin,
        account_lookup_enabled=account_lookup_enabled,
        progress=progress,
        progress_stage=progress_stage,
        progress_message=progress_message,
        progress_start=progress_start,
        progress_end=progress_end,
        cancel_check=cancel_check,
    ).run()
