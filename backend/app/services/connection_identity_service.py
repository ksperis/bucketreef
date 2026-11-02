# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass
from hashlib import sha256
import json
import logging
from threading import Lock
from time import monotonic
from typing import Callable, Literal, Optional

from app.db import S3Connection, StorageEndpoint
from app.core.domain_enums import StorageProvider
from app.core.sensitive_data import sanitized_error_log_detail
from app.services.endpoint_read_credentials import resolve_endpoint_read_credentials
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.utils.normalize import normalize_optional_string
from app.utils.rgw_identifiers import is_rgw_account_id
from app.utils.rgw_payloads import (
    extract_rgw_user_account_aliases,
    extract_rgw_user_identity,
    rgw_qualified_uid,
)
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_rgw_admin_api_endpoint
from app.utils.cache import TtlCacheEntry, get_or_build_single_flight_cache


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ConnectionIdentityResolution:
    rgw_user_uid: Optional[str]
    rgw_account_id: Optional[str]
    metrics_enabled: bool
    usage_enabled: bool
    reason: Optional[str] = None
    rgw_tenant: Optional[str] = None

    @property
    def iam_identity(self) -> Optional[str]:
        return rgw_qualified_uid(self.rgw_user_uid, self.rgw_tenant) if self.rgw_user_uid else self.rgw_account_id

    @property
    def eligible(self) -> bool:
        return bool(self.iam_identity) and self.reason is None


@dataclass(frozen=True)
class _CacheKey:
    scope: Literal["identity", "metrics"]
    fingerprint: str


_CACHE_TTL_SECONDS = 60
_CACHE_MAX_ENTRIES = 512
_CACHE: OrderedDict[_CacheKey, TtlCacheEntry[ConnectionIdentityResolution]] = OrderedDict()
_INFLIGHT: dict[_CacheKey, Future[ConnectionIdentityResolution]] = {}
_CACHE_LOCK = Lock()


def reset_connection_identity_cache_for_tests() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
        _INFLIGHT.clear()


class ConnectionIdentityService:
    def resolve_metrics_identity(self, connection: S3Connection) -> ConnectionIdentityResolution:
        return self._resolve_cached(connection, scope="metrics", resolver=self._resolve_metrics_uncached)

    def resolve_rgw_identity(self, connection: S3Connection) -> ConnectionIdentityResolution:
        return self._resolve_cached(connection, scope="identity", resolver=self._resolve_identity_uncached)

    def _resolve_cached(
        self,
        connection: S3Connection,
        *,
        scope: Literal["identity", "metrics"],
        resolver: Callable[[S3Connection], ConnectionIdentityResolution],
    ) -> ConnectionIdentityResolution:
        key = self._cache_key(connection, scope=scope)
        return get_or_build_single_flight_cache(
            _CACHE,
            _INFLIGHT,
            _CACHE_LOCK,
            key,
            builder=lambda: resolver(connection),
            ttl_seconds=_CACHE_TTL_SECONDS,
            max_entries=_CACHE_MAX_ENTRIES,
            future_factory=Future,
            clock=monotonic,
        )

    @staticmethod
    def _identity_unavailable(
        reason: str,
        *,
        metrics_enabled: bool,
        usage_enabled: bool,
    ) -> ConnectionIdentityResolution:
        return ConnectionIdentityResolution(
            rgw_user_uid=None,
            rgw_account_id=None,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
            reason=reason,
        )

    @classmethod
    def _identity_lookup_failed(
        cls,
        connection: S3Connection,
        exc: Exception,
        *,
        metrics_enabled: bool,
        usage_enabled: bool,
    ) -> ConnectionIdentityResolution:
        logger.warning(
            "Unable to resolve RGW identity for connection id=%s: %s",
            connection.id,
            sanitized_error_log_detail(exc),
        )
        return cls._identity_unavailable(
            "RGW identity is unavailable: unable to resolve RGW identity for this connection.",
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
        )

    @staticmethod
    def _persisted_identity(
        connection: S3Connection,
        *,
        metrics_enabled: bool,
        usage_enabled: bool,
    ) -> ConnectionIdentityResolution | None:
        user_uid = normalize_optional_string(connection.rgw_user_uid)
        tenant = normalize_optional_string(connection.rgw_tenant) if user_uid else None
        account_id = normalize_optional_string(connection.rgw_account_id)
        if not user_uid and not account_id:
            return None
        return ConnectionIdentityResolution(
            rgw_user_uid=user_uid,
            rgw_tenant=(tenant or "") if user_uid else None,
            rgw_account_id=account_id,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
            reason=None,
        )

    @classmethod
    def _identity_from_lookup_payload(
        cls,
        payload: object,
        *,
        metrics_enabled: bool,
        usage_enabled: bool,
    ) -> ConnectionIdentityResolution:
        uid, tenant = extract_rgw_user_identity(payload)
        account_ids = {
            value.upper()
            for value in extract_rgw_user_account_aliases(payload)
            if is_rgw_account_id(value)
        }
        if len(account_ids) > 1:
            raise ValueError("RGW returned conflicting account identity fields")
        account_id = next(iter(account_ids), None)
        if not uid and not account_id:
            return cls._identity_unavailable(
                "RGW identity is unavailable: unable to resolve RGW identity for this connection.",
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
            )
        return ConnectionIdentityResolution(
            rgw_user_uid=uid,
            rgw_tenant=(tenant or "") if uid else None,
            rgw_account_id=account_id,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
            reason=None,
        )

    @classmethod
    def _lookup_identity(
        cls,
        connection: S3Connection,
        endpoint: StorageEndpoint,
        *,
        metrics_enabled: bool,
        usage_enabled: bool,
    ) -> ConnectionIdentityResolution:

        access_key = connection.access_key_id.strip()
        if not access_key:
            return cls._identity_unavailable(
                "RGW identity is unavailable: connection access key is missing.",
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
            )

        admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
        if not admin_endpoint:
            return cls._identity_unavailable(
                "RGW identity is unavailable: admin endpoint is not configured for this endpoint.",
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
            )

        credentials = resolve_endpoint_read_credentials(endpoint)
        if credentials is None:
            return cls._identity_unavailable(
                "RGW identity is unavailable: lookup credentials are not configured for this endpoint.",
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
            )
        lookup_access_key, lookup_secret_key = credentials

        try:
            rgw_admin = get_rgw_admin_client(
                access_key=lookup_access_key,
                secret_key=lookup_secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=endpoint.verify_tls,
            )
            payload = rgw_admin.get_user_by_access_key(access_key, allow_not_found=True)
        except RGWAdminError as exc:
            return cls._identity_lookup_failed(
                connection,
                exc,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
            )

        try:
            return cls._identity_from_lookup_payload(
                payload,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
            )
        except ValueError as exc:
            return cls._identity_lookup_failed(
                connection,
                exc,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
            )

    def _resolve_identity_uncached(self, connection: S3Connection) -> ConnectionIdentityResolution:
        endpoint = connection.storage_endpoint
        if connection.storage_endpoint_id is None or endpoint is None:
            return self._identity_unavailable(
                "RGW identity is unavailable: this connection must target a configured storage endpoint.",
                metrics_enabled=False,
                usage_enabled=False,
            )
        if endpoint.provider != StorageProvider.CEPH.value:
            return self._identity_unavailable(
                "RGW identity is unavailable: this connection endpoint is not a Ceph provider.",
                metrics_enabled=False,
                usage_enabled=False,
            )

        flags = resolve_feature_flags(endpoint)
        metrics_enabled = bool(flags.metrics_enabled)
        usage_enabled = bool(flags.usage_enabled)
        persisted = self._persisted_identity(
            connection,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
        )
        if persisted is not None:
            return persisted
        return self._lookup_identity(
            connection,
            endpoint,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
        )

    def _resolve_metrics_uncached(self, connection: S3Connection) -> ConnectionIdentityResolution:
        endpoint = connection.storage_endpoint
        if connection.storage_endpoint_id is None or endpoint is None:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="Metrics are unavailable: this connection must target a configured storage endpoint.",
            )

        if endpoint.provider != StorageProvider.CEPH.value:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="Metrics are unavailable: this connection endpoint is not a Ceph provider.",
            )

        flags = resolve_feature_flags(endpoint)
        metrics_enabled = bool(flags.metrics_enabled)
        usage_enabled = bool(flags.usage_enabled)
        if not metrics_enabled and not usage_enabled:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="Metrics are unavailable: storage metrics and usage logs are disabled for this endpoint.",
            )

        supervision = endpoint.service_identity("supervision")
        if (
            supervision is None
            or supervision.status != "ready"
            or not supervision.access_key
            or not supervision.secret_key
        ):
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="Metrics are unavailable: supervision credentials are not configured for this endpoint.",
            )

        identity = self._resolve_identity_uncached(connection)
        if identity.iam_identity:
            return ConnectionIdentityResolution(
                rgw_tenant=identity.rgw_tenant,
                rgw_user_uid=identity.rgw_user_uid,
                rgw_account_id=identity.rgw_account_id,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason=None,
            )
        return ConnectionIdentityResolution(
            rgw_user_uid=None,
            rgw_account_id=None,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
            reason=identity.reason or "Metrics are unavailable: unable to resolve RGW identity for this connection.",
        )

    @staticmethod
    def _cache_key(connection: S3Connection, *, scope: Literal["identity", "metrics"]) -> _CacheKey:
        endpoint = connection.storage_endpoint
        endpoint_configuration = None
        if endpoint is not None:
            supervision = endpoint.service_identity("supervision")
            runtime = endpoint.service_identity("runtime")
            endpoint_configuration = [
                endpoint.id,
                endpoint.updated_at.isoformat() if endpoint.updated_at is not None else None,
                endpoint.provider,
                endpoint.endpoint_url,
                endpoint.region,
                endpoint.verify_tls,
                endpoint.features,
                supervision.access_key if supervision else None,
                supervision.secret_key if supervision else None,
                supervision.status if supervision else None,
                runtime.access_key if runtime else None,
                runtime.secret_key if runtime else None,
                runtime.status if runtime else None,
            ]
        payload = json.dumps([
            connection.id,
            connection.updated_at.isoformat() if connection.updated_at is not None else None,
            connection.access_key_id.strip(),
            connection.storage_endpoint_id,
            connection.rgw_user_uid,
            connection.rgw_tenant,
            connection.rgw_account_id,
            endpoint_configuration,
        ], separators=(",", ":"))
        return _CacheKey(scope=scope, fingerprint=sha256(payload.encode("utf-8")).hexdigest())
