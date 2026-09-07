# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional

from app.core.sensitive_data import sanitized_error_log_detail
from app.services.s3_execution_client import require_s3_execution_credentials, s3_execution_cache_key
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.services.sts_service import get_session_token
from app.utils.cache import prune_expired_lru_cache
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_sts_endpoint

from ._shared import _normalize_expiration

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
        return (_normalize_expiration(self.expiration) - STS_CACHE_TTL_BUFFER).timestamp()


_STS_CACHE: OrderedDict[StsCacheKey, CachedStsCredentials] = OrderedDict()
_STS_CACHE_LOCK = Lock()


class BrowserStsRequestError(RuntimeError):
    """STS provider failure after the Browser STS context was validated."""


@dataclass(frozen=True)
class BrowserStsSession:
    credentials: CachedStsCredentials
    region: Optional[str]


def _sts_cache_key(account: S3ExecutionTarget, endpoint: str, cache_partition: Optional[str]) -> StsCacheKey:
    partition = (cache_partition or "shared-runtime").strip() or "shared-runtime"
    return s3_execution_cache_key(account), endpoint, partition


def _get_cached_sts_credentials(cache_key: StsCacheKey) -> Optional[CachedStsCredentials]:
    now = datetime.now(tz=timezone.utc)
    with _STS_CACHE_LOCK:
        prune_expired_lru_cache(_STS_CACHE, now=now.timestamp(), max_entries=STS_CACHE_MAX_ENTRIES)
        credentials = _STS_CACHE.get(cache_key)
        if not credentials:
            return None
        _STS_CACHE.move_to_end(cache_key)
        return credentials


def _store_sts_credentials(cache_key: StsCacheKey, credentials: CachedStsCredentials) -> None:
    with _STS_CACHE_LOCK:
        _STS_CACHE[cache_key] = credentials
        _STS_CACHE.move_to_end(cache_key)
        prune_expired_lru_cache(
            _STS_CACHE, now=datetime.now(tz=timezone.utc).timestamp(), max_entries=STS_CACHE_MAX_ENTRIES,
        )


def browser_sts_enabled(account: S3ExecutionTarget) -> bool:
    if isinstance(account, S3ExecutionContext) and account.context_kind in {"s3_user", "connection"}:
        return False
    endpoint = account.storage_endpoint
    if not endpoint:
        return False
    return resolve_feature_flags(endpoint).sts_enabled


def request_browser_sts_session(
    account: S3ExecutionTarget,
    *,
    cache_partition: Optional[str] = None,
) -> BrowserStsSession:
    if not browser_sts_enabled(account):
        raise RuntimeError("STS is disabled for this endpoint")

    access_key, secret_key = require_s3_execution_credentials(
        account, error_message="S3 credentials missing for this account",
    )

    endpoint = resolve_sts_endpoint(account.storage_endpoint) if account.storage_endpoint else None
    if not endpoint:
        raise RuntimeError("STS endpoint is not configured for this account")

    _, region, _, verify_tls = resolve_s3_client_options(account)
    cache_key = _sts_cache_key(account, endpoint, cache_partition)
    cached = _get_cached_sts_credentials(cache_key)
    if cached:
        return BrowserStsSession(credentials=cached, region=region)

    try:
        access, secret, token, expiration = get_session_token(
            STS_SESSION_DURATION_SECONDS,
            access_key,
            secret_key,
            endpoint=endpoint,
            session_token=account.session_token(),
            region=region,
            verify_tls=verify_tls,
        )
    except RuntimeError as exc:
        raise BrowserStsRequestError(sanitized_error_log_detail(exc)) from exc

    credentials = CachedStsCredentials(
        access_key_id=access,
        secret_access_key=secret,
        session_token=token,
        expiration=_normalize_expiration(expiration),
    )
    _store_sts_credentials(cache_key, credentials)
    return BrowserStsSession(credentials=credentials, region=region)
