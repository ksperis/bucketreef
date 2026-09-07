# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass
from hashlib import sha256
import json
from threading import Lock
from time import monotonic
from typing import Callable, Literal, Optional

from app.db import S3Connection, StorageProvider
from app.services.endpoint_read_credentials import resolve_endpoint_read_credentials
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.utils.normalize import (
    normalize_optional_string,
    normalize_storage_provider,
)
from app.utils.rgw_identifiers import is_rgw_account_id
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_rgw_admin_api_endpoint
from app.utils.cache import prune_expired_lru_cache


@dataclass(frozen=True)
class ConnectionIdentityResolution:
    rgw_user_uid: Optional[str]
    rgw_account_id: Optional[str]
    metrics_enabled: bool
    usage_enabled: bool
    reason: Optional[str] = None

    @property
    def iam_identity(self) -> Optional[str]:
        return self.rgw_user_uid or self.rgw_account_id

    @property
    def eligible(self) -> bool:
        return bool(self.iam_identity) and self.reason is None


@dataclass
class _CacheEntry:
    expires_at: float
    value: ConnectionIdentityResolution


@dataclass(frozen=True)
class _CacheKey:
    scope: Literal["identity", "metrics"]
    fingerprint: str


_CACHE_TTL_SECONDS = 60
_CACHE_MAX_ENTRIES = 512
_CACHE: OrderedDict[_CacheKey, _CacheEntry] = OrderedDict()
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
        is_owner = False
        with _CACHE_LOCK:
            prune_expired_lru_cache(_CACHE, now=monotonic(), max_entries=_CACHE_MAX_ENTRIES)
            cached = _CACHE.get(key)
            if cached is not None:
                _CACHE.move_to_end(key)
                return cached.value
            in_flight = _INFLIGHT.get(key)
            if in_flight is None:
                in_flight = Future()
                _INFLIGHT[key] = in_flight
                is_owner = True

        if not is_owner:
            return in_flight.result()

        try:
            resolved = resolver(connection)
            with _CACHE_LOCK:
                if _INFLIGHT.get(key) is in_flight:
                    _CACHE[key] = _CacheEntry(expires_at=monotonic() + _CACHE_TTL_SECONDS, value=resolved)
                    _CACHE.move_to_end(key)
                    prune_expired_lru_cache(_CACHE, now=monotonic(), max_entries=_CACHE_MAX_ENTRIES)
            in_flight.set_result(resolved)
            return resolved
        except BaseException as exc:
            in_flight.set_exception(exc)
            raise
        finally:
            with _CACHE_LOCK:
                if _INFLIGHT.get(key) is in_flight:
                    _INFLIGHT.pop(key, None)

    def _resolve_identity_uncached(self, connection: S3Connection) -> ConnectionIdentityResolution:
        endpoint = connection.storage_endpoint
        if connection.storage_endpoint_id is None or endpoint is None:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="RGW identity is unavailable: this connection must target a configured storage endpoint.",
            )

        if normalize_storage_provider(endpoint.provider) != StorageProvider.CEPH:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="RGW identity is unavailable: this connection endpoint is not a Ceph provider.",
            )

        flags = resolve_feature_flags(endpoint)
        metrics_enabled = bool(flags.metrics_enabled)
        usage_enabled = bool(flags.usage_enabled)

        uid, account_id = _identity_from_metadata(
            connection.credential_owner_type,
            connection.credential_owner_identifier,
        )
        if uid:
            return ConnectionIdentityResolution(
                rgw_user_uid=uid,
                rgw_account_id=account_id,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason=None,
            )

        access_key = connection.access_key_id.strip()
        if not access_key:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="RGW identity is unavailable: connection access key is missing.",
            )

        admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
        if not admin_endpoint:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="RGW identity is unavailable: admin endpoint is not configured for this endpoint.",
            )

        credentials = resolve_endpoint_read_credentials(endpoint)
        if credentials is None:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="RGW identity is unavailable: lookup credentials are not configured for this endpoint.",
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
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason=f"RGW identity is unavailable: unable to resolve RGW identity ({exc}).",
            )

        uid, account_id = _identity_from_rgw_payload(payload)
        if not uid:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="RGW identity is unavailable: unable to resolve RGW identity for this connection.",
            )
        return ConnectionIdentityResolution(
            rgw_user_uid=uid,
            rgw_account_id=account_id,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
            reason=None,
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

        if normalize_storage_provider(endpoint.provider) != StorageProvider.CEPH:
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

        supervision_access_key = endpoint.supervision_access_key
        supervision_secret_key = endpoint.supervision_secret_key
        if not supervision_access_key or not supervision_secret_key:
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
            endpoint_configuration = [
                endpoint.id,
                endpoint.updated_at.isoformat() if endpoint.updated_at is not None else None,
                endpoint.provider,
                endpoint.endpoint_url,
                endpoint.region,
                endpoint.verify_tls,
                endpoint.features_config,
                endpoint.supervision_access_key,
                endpoint.supervision_secret_key,
                endpoint.admin_access_key,
                endpoint.admin_secret_key,
            ]
        payload = json.dumps([
            connection.id,
            connection.updated_at.isoformat() if connection.updated_at is not None else None,
            connection.access_key_id.strip(),
            connection.storage_endpoint_id,
            connection.credential_owner_type,
            connection.credential_owner_identifier,
            endpoint_configuration,
        ], separators=(",", ":"))
        return _CacheKey(scope=scope, fingerprint=sha256(payload.encode("utf-8")).hexdigest())


def _identity_from_metadata(owner_type: Optional[str], owner_identifier: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    type_slug = (normalize_optional_string(owner_type) or "").lower()
    identifier = normalize_optional_string(owner_identifier)
    if not identifier:
        return None, None

    if "$" in identifier:
        account_hint = identifier.split("$", 1)[0].strip()
        account_id = account_hint if is_rgw_account_id(account_hint) else None
        return identifier, account_id

    if type_slug == "account_user":
        if ":" in identifier:
            account_id, principal = [part.strip() for part in identifier.split(":", 1)]
            if is_rgw_account_id(account_id) and principal:
                return f"{account_id}${principal}", account_id
        return None, None

    if type_slug == "s3_user":
        candidate = identifier
        if candidate.lower().startswith("iam:"):
            candidate = candidate.split(":", 1)[1].strip()
        if candidate and ":" not in candidate:
            return candidate, None
        return None, None

    if type_slug == "iam_user":
        candidate = identifier
        if candidate.lower().startswith("iam:"):
            candidate = candidate.split(":", 1)[1].strip()
        if ":" in candidate:
            account_id, principal = [part.strip() for part in candidate.split(":", 1)]
            if is_rgw_account_id(account_id) and principal:
                return f"{account_id}${principal}", account_id
        if candidate and ":" not in candidate:
            return candidate, None
        return None, None

    return None, None


def _identity_from_rgw_payload(payload: object) -> tuple[Optional[str], Optional[str]]:
    if not isinstance(payload, dict) or payload.get("not_found"):
        return None, None
    candidates: list[dict] = [payload]
    nested_user = payload.get("user")
    if isinstance(nested_user, dict):
        candidates.append(nested_user)

    uid: Optional[str] = None
    account_id: Optional[str] = None
    for candidate in candidates:
        uid = normalize_optional_string(
            candidate.get("uid")
            or candidate.get("user_id")
            or (candidate.get("user") if isinstance(candidate.get("user"), str) else None)
        )
        if uid:
            break
    for candidate in candidates:
        account_id = normalize_optional_string(
            candidate.get("account_id")
            or candidate.get("account")
            or candidate.get("tenant")
        )
        if account_id:
            break
    if uid and "$" in uid and not account_id:
        account_hint = uid.split("$", 1)[0].strip()
        if is_rgw_account_id(account_hint):
            account_id = account_hint
    if not uid and account_id and is_rgw_account_id(account_id):
        return None, account_id
    return uid, account_id
