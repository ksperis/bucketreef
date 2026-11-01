# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import status

from app.models.ceph_admin import CephAdminRgwUserSummary
from app.services.listing_progress import (
    ListingProgressEmitter,
    interpolate_progress_percent,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.cancellation import invoke_cancel_check
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.quota_stats import extract_rgw_user_quota_limits
from app.utils.rgw_payloads import (
    extract_bucket_list,
    extract_rgw_account_name,
    extract_rgw_user_account_id,
    extract_rgw_user_bool,
    extract_rgw_user_int,
    extract_rgw_user_scalar,
)
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
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if not payload or payload.get("not_found"):
            return user
        self._apply_payload(user, payload)
        return user

    def _apply_payload(
        self,
        user: CephAdminRgwUserSummary,
        payload: dict[str, Any],
    ) -> None:
        if "account" in self.requested:
            account_id = extract_rgw_user_account_id(payload)
            user.account_id = account_id
            user.account_name = self._resolve_account_name(
                account_id,
                extract_rgw_user_scalar(
                    payload,
                    "account_name",
                    top_level_first=True,
                ),
            )
        if "profile" in self.requested:
            user.full_name = extract_rgw_user_scalar(payload, "display_name")
            user.email = extract_rgw_user_scalar(payload, "email")
        if "status" in self.requested:
            user.suspended = extract_rgw_user_bool(payload, "suspended")
        if "limits" in self.requested:
            user.max_buckets = extract_rgw_user_int(payload, "max_buckets")
        if "quota" in self.requested:
            quota_size, quota_objects = extract_rgw_user_quota_limits(payload)
            user.quota_max_size_bytes = quota_size
            user.quota_max_objects = quota_objects
        if "usage" in self.requested:
            self._apply_usage(user)

    def _resolve_account_name(
        self,
        account_id: str | None,
        payload_account_name: str | None,
    ) -> str | None:
        if not account_id:
            return payload_account_name
        if account_id not in self.account_name_by_id:
            account_payload = None
            if self.account_lookup_enabled is not False:
                try:
                    account_payload = self.rgw_admin.get_account(
                        account_id,
                        allow_not_found=True,
                        allow_not_implemented=True,
                    )
                except RGWAdminError as exc:
                    raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
            self.account_name_by_id[account_id] = extract_rgw_account_name(account_payload)
        return self.account_name_by_id.get(account_id) or payload_account_name

    def _apply_usage(self, user: CephAdminRgwUserSummary) -> None:
        lookup_uid = f"{user.tenant}${user.uid}" if user.tenant else user.uid
        try:
            buckets_payload = self.rgw_admin.get_all_buckets(
                uid=lookup_uid,
                with_stats=True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
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
