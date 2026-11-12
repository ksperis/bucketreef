# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional

from app.core.sensitive_data import sanitized_error_log_detail
from app.services.s3_execution_client import (
    require_s3_execution_credentials_with_error,
    s3_execution_cache_key,
)
from app.services.s3_execution_context import S3ExecutionContext
from app.services.sts_service import StsOperationError, get_session_token
from app.services.s3_client_options import resolve_s3_client_options
from app.utils.cache import TtlCacheEntry, prune_expired_lru_cache
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_sts_endpoint
from app.utils.time import assume_utc

STS_SESSION_DURATION_SECONDS = 900
STS_CACHE_TTL_BUFFER = timedelta(minutes=2)
STS_CACHE_MAX_ENTRIES = 512
StsCacheKey = tuple[str, str, str]


@dataclass(frozen=True)
class CachedStsCredentials:
    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: datetime

    @property
    def expires_at(self) -> float:
        expiration = assume_utc(self.expiration)
        assert expiration is not None
        return (expiration - STS_CACHE_TTL_BUFFER).timestamp()


_STS_CACHE: OrderedDict[StsCacheKey, TtlCacheEntry[CachedStsCredentials]] = OrderedDict()
_STS_CACHE_LOCK = Lock()


class BrowserStsRequestError(RuntimeError):
    """STS provider failure after the Browser STS context was validated."""


class BrowserStsUnavailableError(RuntimeError):
    """Browser STS cannot be used for the selected execution context."""


@dataclass(frozen=True)
class BrowserStsSession:
    credentials: CachedStsCredentials
    region: Optional[str]


def _sts_cache_key(context: S3ExecutionContext, endpoint: str, cache_partition: Optional[str]) -> StsCacheKey:
    partition = (cache_partition or "shared-runtime").strip() or "shared-runtime"
    return s3_execution_cache_key(context), endpoint, partition


def _get_cached_sts_credentials(cache_key: StsCacheKey) -> Optional[CachedStsCredentials]:
    now = datetime.now(tz=timezone.utc)
    with _STS_CACHE_LOCK:
        prune_expired_lru_cache(_STS_CACHE, now=now.timestamp(), max_entries=STS_CACHE_MAX_ENTRIES)
        entry = _STS_CACHE.get(cache_key)
        if not entry:
            return None
        _STS_CACHE.move_to_end(cache_key)
        return entry.value


def _store_sts_credentials(cache_key: StsCacheKey, credentials: CachedStsCredentials) -> None:
    with _STS_CACHE_LOCK:
        _STS_CACHE[cache_key] = TtlCacheEntry(
            expires_at=credentials.expires_at,
            value=credentials,
        )
        _STS_CACHE.move_to_end(cache_key)
        prune_expired_lru_cache(
            _STS_CACHE, now=datetime.now(tz=timezone.utc).timestamp(), max_entries=STS_CACHE_MAX_ENTRIES,
        )


def browser_sts_enabled(context: S3ExecutionContext) -> bool:
    if context.context_kind in {"s3_user", "connection", "openstack_project"}:
        return False
    endpoint = context.storage_endpoint
    if not endpoint:
        return False
    return resolve_feature_flags(endpoint).sts_enabled


def request_browser_sts_session(
    context: S3ExecutionContext,
    *,
    cache_partition: Optional[str] = None,
) -> BrowserStsSession:
    if not browser_sts_enabled(context):
        raise BrowserStsUnavailableError("STS is disabled for this endpoint")

    access_key, secret_key = require_s3_execution_credentials_with_error(
        context,
        error_message="S3 credentials missing for this context",
        error_type=BrowserStsUnavailableError,
    )

    endpoint = resolve_sts_endpoint(context.storage_endpoint) if context.storage_endpoint else None
    if not endpoint:
        raise BrowserStsUnavailableError("STS endpoint is not configured for this context")

    _, region, _, verify_tls = resolve_s3_client_options(context)
    cache_key = _sts_cache_key(context, endpoint, cache_partition)
    cached = _get_cached_sts_credentials(cache_key)
    if cached:
        return BrowserStsSession(credentials=cached, region=region)

    try:
        access, secret, token, expiration = get_session_token(
            STS_SESSION_DURATION_SECONDS,
            access_key,
            secret_key,
            endpoint=endpoint,
            session_token=context.session_token(),
            region=region,
            verify_tls=verify_tls,
        )
    except StsOperationError as exc:
        raise BrowserStsRequestError(sanitized_error_log_detail(exc)) from exc

    normalized_expiration = assume_utc(expiration)
    assert normalized_expiration is not None
    credentials = CachedStsCredentials(
        access_key_id=access,
        secret_access_key=secret,
        session_token=token,
        expiration=normalized_expiration,
    )
    _store_sts_credentials(cache_key, credentials)
    return BrowserStsSession(credentials=credentials, region=region)
