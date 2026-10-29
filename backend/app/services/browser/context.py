# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations


import logging
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.core.sensitive_data import sanitized_error_log_detail
from app.models.browser import (
    BrowserObjectSortBy,
    BrowserObjectSortDir,
    BucketCorsRule,
    BucketCorsStatus,
    SseCustomerContext,
)
from app.services.aws_client_config import StorageRequestProfile
from app.services.s3_client import get_s3_client
from app.services.s3_execution_client import require_s3_execution_credentials, s3_execution_cache_key
from app.services.s3_execution_context import (
    S3ExecutionContext,
    S3ExecutionTarget,
    is_ceph_admin_execution_context,
)
from app.services.rgw_bucket_target import split_explicit_rgw_s3_bucket_name
from app.utils.s3_endpoint import resolve_s3_client_kwargs
from app.utils.aws_errors import aws_error_code

from ._shared import (
    _BUCKET_LIST_CACHE,
    _OBJECT_LAZY_HEAD_CACHE,
    _OBJECT_LAZY_TAGS_CACHE,
    _OBJECT_LIST_CACHE,
    _OBJECT_SORT_SNAPSHOT_CACHE,
    _normalize_expiration,
)
from .sts import browser_sts_enabled, request_browser_sts_session

logger = logging.getLogger(__name__)

_BROWSER_CORS_REQUIRED_METHODS = {"GET", "PUT", "POST", "HEAD"}
_BROWSER_CORS_MANAGED_METHODS = ("GET", "PUT", "POST", "DELETE", "HEAD")
_BROWSER_CORS_MANAGED_HEADERS = ("Content-Type", "x-amz-*")
_BROWSER_CORS_EXPOSE_HEADERS = ("ETag", "x-amz-request-id", "x-amz-id-2")


def _ordered_unique(values: list[str] | tuple[str, ...]) -> list[str]:
    return list(dict.fromkeys(values))


def _cors_rule_matches_origin(rule: dict, origin: str) -> bool:
    allowed_origins = set(rule.get("AllowedOrigins") or [])
    return "*" in allowed_origins or origin in allowed_origins


def _cors_header_allowed(allowed_headers: list[str], header: str) -> bool:
    header = header.lower()
    for entry in allowed_headers:
        entry_lower = entry.lower()
        if entry_lower == "*" or entry_lower == header:
            return True
        if entry_lower.endswith("*") and header.startswith(entry_lower[:-1]):
            return True
    return False


def _browser_cors_rule_enabled(rule: dict, origin: str) -> bool:
    if not _cors_rule_matches_origin(rule, origin):
        return False
    allowed_methods = {method.upper() for method in (rule.get("AllowedMethods") or [])}
    if not _BROWSER_CORS_REQUIRED_METHODS.issubset(allowed_methods):
        return False
    allowed_headers = rule.get("AllowedHeaders") or []
    if not allowed_headers or not _cors_header_allowed(allowed_headers, "content-type"):
        return False
    exposed_headers = {
        str(header).strip().lower()
        for header in (rule.get("ExposeHeaders") or [])
    }
    return "*" in exposed_headers or "etag" in exposed_headers


def _repair_browser_cors_rule(rule: dict, origin: str) -> bool:
    changed = False
    allowed_origins = list(rule.get("AllowedOrigins") or [])
    if origin not in allowed_origins and "*" not in allowed_origins:
        rule["AllowedOrigins"] = _ordered_unique([*allowed_origins, origin])
        changed = True

    allowed_methods = _ordered_unique(
        [method.upper() for method in (rule.get("AllowedMethods") or [])]
    )
    if not set(_BROWSER_CORS_MANAGED_METHODS).issubset(allowed_methods):
        rule["AllowedMethods"] = _ordered_unique(
            [*allowed_methods, *_BROWSER_CORS_MANAGED_METHODS]
        )
        changed = True

    allowed_headers = set(rule.get("AllowedHeaders") or [])
    desired_headers = set(_BROWSER_CORS_MANAGED_HEADERS)
    if not allowed_headers or "*" in allowed_headers:
        rule["AllowedHeaders"] = sorted(desired_headers)
        changed = True
    elif not desired_headers.issubset(allowed_headers):
        rule["AllowedHeaders"] = _ordered_unique(
            [*allowed_headers, *_BROWSER_CORS_MANAGED_HEADERS]
        )
        changed = True

    expose_headers = set(rule.get("ExposeHeaders") or [])
    desired_expose = set(_BROWSER_CORS_EXPOSE_HEADERS)
    if not desired_expose.issubset(expose_headers):
        rule["ExposeHeaders"] = _ordered_unique(
            [*expose_headers, *_BROWSER_CORS_EXPOSE_HEADERS]
        )
        changed = True
    if rule.get("MaxAgeSeconds") is None:
        rule["MaxAgeSeconds"] = 3000
        changed = True
    return changed


class BrowserContextMixin:
    def _resolve_s3_credentials(self, context: S3ExecutionTarget) -> tuple[str, str, Optional[str]]:
        access_key, secret_key = require_s3_execution_credentials(
            context, error_message="S3 credentials missing for this context",
        )
        session_token = context.session_token()
        if not browser_sts_enabled(context):
            return access_key, secret_key, session_token
        try:
            credentials = request_browser_sts_session(context).credentials
        except RuntimeError as exc:
            context_id = context.context_id if isinstance(context, S3ExecutionContext) else context.id
            logger.info(
                "STS session token unavailable for context %s: %s", context_id, sanitized_error_log_detail(exc),
            )
        else:
            return credentials.access_key_id, credentials.secret_access_key, credentials.session_token
        return access_key, secret_key, session_token

    def _s3_client_kwargs(self, context: S3ExecutionTarget) -> dict:
        return resolve_s3_client_kwargs(context)

    def _client(
        self,
        context: S3ExecutionTarget,
        *,
        request_profile: StorageRequestProfile = "interactive",
        bucket_name: str | None = None,
    ):
        access_key, secret_key, session_token = self._resolve_s3_credentials(context)
        client_options = self._s3_client_kwargs(context)
        client_options["session_token"] = session_token
        if (
            bucket_name
            and is_ceph_admin_execution_context(context)
            and split_explicit_rgw_s3_bucket_name(bucket_name) is not None
        ):
            client_options["force_path_style"] = True
            client_options["allow_rgw_qualified_bucket_names"] = True
        if request_profile != "interactive":
            client_options["request_profile"] = request_profile
        from app.services.openstack_execution_guard import guard_openstack_client
        return guard_openstack_client(context, get_s3_client(
            access_key,
            secret_key,
            **client_options,
        ))

    def _bucket_client(
        self,
        context: S3ExecutionTarget,
        bucket_name: str,
        *,
        request_profile: StorageRequestProfile = "interactive",
    ):
        if (
            is_ceph_admin_execution_context(context)
            and split_explicit_rgw_s3_bucket_name(bucket_name) is not None
        ):
            return self._client(
                context,
                request_profile=request_profile,
                bucket_name=bucket_name,
            )
        if request_profile == "interactive":
            return self._client(context)
        return self._client(context, request_profile=request_profile)

    def _sse_customer_params(self, sse_customer: Optional[SseCustomerContext]) -> dict[str, str]:
        if not sse_customer:
            return {}
        return {
            "SSECustomerAlgorithm": sse_customer.algorithm,
            "SSECustomerKey": sse_customer.key,
            "SSECustomerKeyMD5": sse_customer.key_md5,
        }

    def _sse_customer_headers(self, sse_customer: Optional[SseCustomerContext]) -> dict[str, str]:
        if not sse_customer:
            return {}
        return {
            "x-amz-server-side-encryption-customer-algorithm": sse_customer.algorithm,
            "x-amz-server-side-encryption-customer-key": sse_customer.key,
            "x-amz-server-side-encryption-customer-key-MD5": sse_customer.key_md5,
        }

    def _clean_etag(self, etag: Optional[str]) -> Optional[str]:
        if not etag:
            return None
        return etag.strip('"')

    def _context_cache_key(self, context: S3ExecutionTarget) -> str:
        access_key, _ = context.effective_rgw_credentials()
        if not access_key:
            raise RuntimeError("S3 credentials missing for this context")
        return s3_execution_cache_key(context)

    def _object_list_cache_key(
        self,
        *,
        context_cache_key: str,
        bucket_name: str,
        prefix: str,
        continuation_token: Optional[str],
        max_keys: int,
        query: Optional[str],
        query_exact: bool,
        query_case_sensitive: bool,
        item_type: str,
        storage_class: Optional[str],
        recursive: bool,
        include_folder_markers: bool = False,
    ) -> tuple:
        return (
            context_cache_key,
            bucket_name,
            prefix,
            continuation_token or "",
            max_keys,
            (query or "").strip(),
            bool(query_exact),
            bool(query_case_sensitive),
            item_type,
            storage_class or "",
            bool(recursive),
            bool(include_folder_markers),
        )

    def _object_sort_snapshot_cache_key(
        self,
        *,
        context_cache_key: str,
        bucket_name: str,
        prefix: str,
        query: Optional[str],
        query_exact: bool,
        query_case_sensitive: bool,
        item_type: str,
        storage_class: Optional[str],
        recursive: bool,
        sort_by: BrowserObjectSortBy,
        sort_dir: BrowserObjectSortDir,
        include_folder_markers: bool = False,
    ) -> tuple:
        return (
            context_cache_key,
            bucket_name,
            prefix,
            (query or "").strip(),
            bool(query_exact),
            bool(query_case_sensitive),
            item_type,
            storage_class or "",
            bool(recursive),
            bool(include_folder_markers),
            sort_by,
            sort_dir,
        )

    def _object_lazy_head_cache_key(
        self,
        *,
        context_cache_key: str,
        bucket_name: str,
        key: str,
        sse_customer: Optional[SseCustomerContext],
    ) -> tuple:
        return (
            context_cache_key,
            bucket_name,
            key,
            "head",
            sse_customer.key_md5 if sse_customer is not None else "",
        )

    def _object_lazy_tags_cache_key(
        self,
        *,
        context_cache_key: str,
        bucket_name: str,
        key: str,
    ) -> tuple:
        return (
            context_cache_key,
            bucket_name,
            key,
            "tags",
        )

    def _normalize_datetime_value(self, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        return _normalize_expiration(value)

    def _normalize_restore_status(self, value: object) -> Optional[str]:
        text = str(value or "").strip()
        if not text:
            return None
        if 'ongoing-request="true"' in text:
            return "In progress"
        match = re.search(r'expiry-date="([^"]+)"', text)
        if not match:
            return None
        try:
            expires_at = datetime.strptime(match.group(1), "%a, %d %b %Y %H:%M:%S %Z")
            expires_at = expires_at.replace(tzinfo=timezone.utc)
            return f"Restored until {expires_at.isoformat()}"
        except ValueError:
            return "Restored"

    def invalidate_bucket_list_cache(self, context_key: str) -> None:
        if not context_key:
            return
        removed = _BUCKET_LIST_CACHE.invalidate_where(lambda key: key == context_key)
        if removed > 0:
            logger.debug("Browser bucket cache invalidated: context=%s entries=%s", context_key, removed)

    def invalidate_object_list_cache(self, context_key: str, bucket_name: str) -> None:
        if not context_key or not bucket_name:
            return
        removed = _OBJECT_LIST_CACHE.invalidate_where(
            lambda key: len(key) >= 2 and key[0] == context_key and key[1] == bucket_name
        )
        removed += _OBJECT_SORT_SNAPSHOT_CACHE.invalidate_where(
            lambda key: len(key) >= 2 and key[0] == context_key and key[1] == bucket_name
        )
        removed += _OBJECT_LAZY_HEAD_CACHE.invalidate_where(
            lambda key: len(key) >= 2 and key[0] == context_key and key[1] == bucket_name
        )
        removed += _OBJECT_LAZY_TAGS_CACHE.invalidate_where(
            lambda key: len(key) >= 2 and key[0] == context_key and key[1] == bucket_name
        )
        if removed > 0:
            logger.debug("Browser object cache invalidated: context=%s bucket=%s entries=%s", context_key, bucket_name, removed)

    def invalidate_bucket_list_cache_for_context(self, context: S3ExecutionTarget) -> None:
        try:
            context_key = self._context_cache_key(context)
        except RuntimeError:
            return
        self.invalidate_bucket_list_cache(context_key)

    def invalidate_object_list_cache_for_context(self, context: S3ExecutionTarget, bucket_name: str) -> None:
        if not bucket_name:
            return
        try:
            context_key = self._context_cache_key(context)
        except RuntimeError:
            return
        self.invalidate_object_list_cache(context_key, bucket_name)

    @contextmanager
    def _object_mutation(self, context: S3ExecutionTarget, *bucket_names: str) -> Iterator[None]:
        """Expire object views even when a mutation fails after changing storage."""
        try:
            yield
        finally:
            for bucket_name in dict.fromkeys(bucket_names):
                self.invalidate_object_list_cache_for_context(context, bucket_name)

    def get_bucket_cors_status(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        origin: Optional[str] = None,
    ) -> BucketCorsStatus:
        client = self._client(context)
        try:
            resp = client.get_bucket_cors(Bucket=bucket_name)
        except (ClientError, BotoCoreError) as exc:
            code = aws_error_code(exc)
            if code in {"NoSuchCORSConfiguration", "NoSuchCORS"}:
                return BucketCorsStatus(enabled=False, rules=[])
            return BucketCorsStatus(enabled=False, rules=[], error=sanitized_error_log_detail(exc))
        rules = []
        raw_rules = resp.get("CORSRules", []) or []
        enabled = bool(raw_rules)
        for rule in resp.get("CORSRules", []) or []:
            rules.append(
                BucketCorsRule(
                    allowed_origins=rule.get("AllowedOrigins") or [],
                    allowed_methods=rule.get("AllowedMethods") or [],
                    allowed_headers=rule.get("AllowedHeaders") or [],
                    expose_headers=rule.get("ExposeHeaders") or [],
                    max_age_seconds=rule.get("MaxAgeSeconds"),
                )
            )
        if origin and raw_rules:
            enabled = any(_browser_cors_rule_enabled(rule, origin) for rule in raw_rules)
        return BucketCorsStatus(enabled=enabled, rules=rules)

    def ensure_bucket_cors(self, bucket_name: str, context: S3ExecutionTarget, origin: str) -> BucketCorsStatus:
        if not origin:
            raise RuntimeError("Missing origin")
        client = self._client(context)
        try:
            resp = client.get_bucket_cors(Bucket=bucket_name)
            rules = resp.get("CORSRules", []) or []
        except (ClientError, BotoCoreError) as exc:
            code = aws_error_code(exc)
            if code in {"NoSuchCORSConfiguration", "NoSuchCORS"}:
                rules = []
            else:
                raise RuntimeError(f"Unable to fetch CORS for '{bucket_name}': {exc}") from exc

        updated = False
        matched = False
        for rule in rules:
            if _cors_rule_matches_origin(rule, origin):
                matched = True
                if _repair_browser_cors_rule(rule, origin):
                    updated = True
                break

        if not matched:
            new_rule = {
                "AllowedOrigins": [origin],
                "AllowedMethods": list(_BROWSER_CORS_MANAGED_METHODS),
                "AllowedHeaders": sorted(_BROWSER_CORS_MANAGED_HEADERS),
                "ExposeHeaders": list(_BROWSER_CORS_EXPOSE_HEADERS),
                "MaxAgeSeconds": 3000,
            }
            rules.append(new_rule)
            updated = True

        if updated:
            try:
                client.put_bucket_cors(Bucket=bucket_name, CORSConfiguration={"CORSRules": rules})
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to update CORS for '{bucket_name}': {exc}") from exc

        return self.get_bucket_cors_status(bucket_name, context, origin=origin)
