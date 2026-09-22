# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.manager_object_listing import ListObjectsResponse, S3Object
from app.services.object_listing_identity import is_current_folder_marker
from app.services.s3_client import get_s3_client
from app.services.s3_execution_client import (
    require_s3_execution_credentials,
    s3_execution_client_kwargs,
)
from app.services.s3_execution_context import S3ExecutionTarget


class ManagerObjectListingService:
    def _client(self, account: S3ExecutionTarget):
        access_key, secret_key = require_s3_execution_credentials(
            account,
            error_message="Execution context credentials are missing",
        )
        return get_s3_client(
            access_key,
            secret_key,
            request_profile="long_running",
            **s3_execution_client_kwargs(account),
        )

    def list_objects(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        prefix: str = "",
        continuation_token: Optional[str] = None,
        max_keys: int = 1000,
    ) -> ListObjectsResponse:
        client = self._client(account)
        kwargs = {
            "Bucket": bucket_name,
            "Prefix": prefix or "",
            "Delimiter": "/",
            "MaxKeys": max_keys,
        }
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        try:
            response = client.list_objects_v2(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list objects for '{bucket_name}': {exc}") from exc

        objects: list[S3Object] = []
        for entry in response.get("Contents", []):
            key = entry.get("Key")
            if not key:
                continue
            size = int(entry.get("Size") or 0)
            if is_current_folder_marker(key=key, prefix=prefix, size=size):
                continue
            objects.append(
                S3Object(
                    key=key,
                    size=size,
                    last_modified=entry.get("LastModified"),
                    storage_class=entry.get("StorageClass"),
                )
            )

        prefixes = [
            item.get("Prefix")
            for item in response.get("CommonPrefixes", [])
            if item.get("Prefix")
        ]
        return ListObjectsResponse(
            prefix=prefix,
            objects=objects,
            prefixes=prefixes,
            is_truncated=bool(response.get("IsTruncated")),
            next_continuation_token=response.get("NextContinuationToken"),
        )


def get_manager_object_listing_service() -> ManagerObjectListingService:
    return ManagerObjectListingService()
