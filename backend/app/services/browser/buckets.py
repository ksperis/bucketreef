# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import BrowserBucket, PaginatedBrowserBucketsResponse
from app.services.s3_client import create_bucket as s3_create_bucket
from app.services.s3_client import set_bucket_versioning as s3_set_bucket_versioning
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from ._shared import _BUCKET_LIST_CACHE

logger = logging.getLogger(__name__)


def _bucket_search_values(bucket: BrowserBucket) -> list[str]:
    values = [
        bucket.name,
        bucket.display_name,
        bucket.workspace_label,
        bucket.description,
        bucket.internal_bucket_name,
        bucket.status,
        bucket.role,
    ]
    return [str(value).strip() for value in values if str(value or "").strip()]


class BrowserBucketsMixin:
    def _list_portal_storage_space_buckets(self, context: S3ExecutionTarget) -> Optional[list[BrowserBucket]]:
        if not isinstance(context, S3ExecutionContext):
            return None
        spaces = context.portal_storage_spaces
        if spaces is None:
            return None
        buckets: list[BrowserBucket] = []
        for space in spaces:
            name = space.internal_bucket_name or space.id
            if not name:
                continue
            buckets.append(
                BrowserBucket(
                    name=name,
                    display_name=space.name or name,
                    workspace_label="Storage Space",
                    description=space.description,
                    used_bytes=space.used_bytes,
                    object_count=space.object_count,
                    quota_max_size_bytes=space.quota_max_size_bytes,
                    quota_max_objects=space.quota_max_objects,
                    status=space.status,
                    role=space.role,
                    internal_bucket_name=name,
                    icon=space.icon,
                )
            )
        buckets.sort(key=lambda bucket: (bucket.display_name or bucket.name).lower())
        return buckets

    def list_buckets(self, context: S3ExecutionTarget) -> list[BrowserBucket]:
        portal_buckets = self._list_portal_storage_space_buckets(context)
        if portal_buckets is not None:
            return portal_buckets
        allowed_portal_buckets = (
            context.portal_allowed_buckets
            if isinstance(context, S3ExecutionContext)
            else None
        )
        context_key = self._context_cache_key(context)
        cached = _BUCKET_LIST_CACHE.get(context_key)
        if cached is not None:
            logger.debug("Browser bucket cache hit: context=%s count=%s", context_key, len(cached))
            if allowed_portal_buckets is not None:
                return [bucket for bucket in cached if bucket.name in allowed_portal_buckets]
            return list(cached)
        client = self._client(context)
        try:
            resp = client.list_buckets()
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list buckets: {exc}") from exc
        buckets: list[BrowserBucket] = []
        for bucket in resp.get("Buckets", []):
            name = bucket.get("Name")
            if not name:
                continue
            buckets.append(BrowserBucket(name=name, creation_date=bucket.get("CreationDate")))
        buckets.sort(key=lambda bucket: bucket.name)
        _BUCKET_LIST_CACHE.set(context_key, buckets)
        logger.debug("Browser bucket cache miss: context=%s count=%s", context_key, len(buckets))
        if allowed_portal_buckets is not None:
            return [bucket for bucket in buckets if bucket.name in allowed_portal_buckets]
        return list(buckets)

    def search_buckets(
        self,
        context: S3ExecutionTarget,
        *,
        search: Optional[str] = None,
        exact: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> PaginatedBrowserBucketsResponse:
        normalized_page = max(1, int(page or 1))
        normalized_page_size = max(1, min(200, int(page_size or 50)))
        buckets = self.list_buckets(context)
        query = (search or "").strip()
        if query:
            query_normalized = query.lower()
            if exact:
                filtered = [
                    bucket
                    for bucket in buckets
                    if any(value.lower() == query_normalized for value in _bucket_search_values(bucket))
                ]
            else:
                filtered = [
                    bucket
                    for bucket in buckets
                    if any(query_normalized in value.lower() for value in _bucket_search_values(bucket))
                ]
        else:
            filtered = buckets
        total = len(filtered)
        start = (normalized_page - 1) * normalized_page_size
        end = start + normalized_page_size
        items = filtered[start:end] if start < total else []
        return PaginatedBrowserBucketsResponse(
            items=items,
            total=total,
            page=normalized_page,
            page_size=normalized_page_size,
            has_next=end < total,
        )

    def create_bucket(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        *,
        versioning: bool = False,
    ) -> None:
        access_key, secret_key, session_token = self._resolve_s3_credentials(context)
        client_options = {
            **self._s3_client_kwargs(context),
            "access_key": access_key,
            "secret_key": secret_key,
            "session_token": session_token,
        }
        with self._object_mutation(context, bucket_name):
            try:
                s3_create_bucket(bucket_name, **client_options)
                if versioning:
                    s3_set_bucket_versioning(bucket_name, enabled=True, **client_options)
            finally:
                self.invalidate_bucket_list_cache_for_context(context)
