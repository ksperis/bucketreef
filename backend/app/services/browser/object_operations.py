# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional
from urllib.parse import urlencode

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import (
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListMultipartUploadsResponse,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    MultipartUploadItem,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    SseCustomerContext,
)
from .write_conflicts import check_destination, observe_destination, supports_conditional_writes
from .multipart_resume import require_multipart_write_access, list_parts, upload_part
from app.services.s3_deletion import delete_objects
from app.services.s3_execution_context import S3ExecutionTarget


class BrowserObjectOperationsMixin:
    def inspect_write_destinations(self, bucket_name, account, keys, sse_customer=None):
        client = self._client(account)
        return {"objects": [observe_destination(client, bucket_name, key, self._sse_customer_params(sse_customer)) for key in dict.fromkeys(keys)], "protection": "conditional" if supports_conditional_writes(account) else "preflight"}

    def presign(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: PresignRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> PresignedUrl:
        client = self._client(account)
        expires = payload.expires_in or 900
        params = {"Bucket": bucket_name, "Key": payload.key}
        params.update(self._sse_customer_params(sse_customer))
        headers: dict[str, str] = self._sse_customer_headers(sse_customer)
        if payload.version_id:
            params["VersionId"] = payload.version_id
        if payload.response_content_disposition:
            params["ResponseContentDisposition"] = payload.response_content_disposition
        try:
            if payload.operation == "get_object":
                if payload.if_match:
                    params["IfMatch"] = '"' + payload.if_match.strip('"') + '"'
                    headers["If-Match"] = params["IfMatch"]
                url = client.generate_presigned_url(
                    "get_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="GET", expires_in=expires, headers=headers)
            if payload.operation == "delete_object":
                url = client.generate_presigned_url(
                    "delete_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="DELETE", expires_in=expires, headers=headers)
            if payload.operation == "put_object":
                conditions = check_destination(client, account, bucket_name, payload.key, payload.write_guard, self._sse_customer_params(sse_customer))
                params.update(conditions)
                headers.update({"If-Match" if name == "IfMatch" else "If-None-Match": value for name, value in conditions.items()})
                if payload.content_type:
                    headers["Content-Type"] = payload.content_type
                url = client.generate_presigned_url(
                    "put_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="PUT", expires_in=expires, headers=headers)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to generate presigned URL for '{payload.operation}': {exc}") from exc
        raise RuntimeError("Unsupported presign operation")

    def copy_object(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: CopyObjectPayload,
    ) -> dict:
        from .object_copy import copy_snapshot, delete_verified_copy_source
        from fastapi import HTTPException
        source_bucket = payload.source_bucket or bucket_name
        spaces = getattr(account, "portal_storage_spaces", None)
        if spaces is not None:
            by_bucket = {(space.internal_bucket_name or space.id): space for space in spaces}
            source = by_bucket.get(source_bucket)
            destination = by_bucket.get(bucket_name)
            if not source or not destination or destination.role == "Viewer" or (payload.move and source.role == "Viewer"):
                raise HTTPException(status_code=403, detail="Storage Space permissions do not allow this transfer")
        if payload.move and source_bucket == bucket_name and payload.source_key == payload.destination_key:
            raise RuntimeError("Cannot move an object onto itself")
        client = self._client(account, request_profile="long_running")
        if payload.copied_checkpoint:
            with self._object_mutation(account, source_bucket):
                return delete_verified_copy_source(client, bucket_name, payload, payload.copied_checkpoint)
        try:
            source_head = client.head_object(Bucket=source_bucket, Key=payload.source_key, **({"VersionId": payload.source_version_id} if payload.source_version_id else {}))
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to read source '{payload.source_key}': {exc}") from exc
        affected = (bucket_name, source_bucket) if payload.move else (bucket_name,)
        with self._object_mutation(account, *affected):
            try:
                return copy_snapshot(client, account, bucket_name, payload, source_head)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to copy object '{payload.source_key}': {exc}") from exc

    def delete_objects(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: DeleteObjectsPayload,
    ) -> int:
        if not payload.objects:
            return 0
        items: list[dict] = []
        for obj in payload.objects:
            if not obj.key:
                continue
            entry = {"Key": obj.key}
            if obj.version_id:
                entry["VersionId"] = obj.version_id
            items.append(entry)
        if not items:
            return 0
        client = self._client(account)
        with self._object_mutation(account, bucket_name):
            try:
                conditional_keys = {obj.key for obj in payload.objects if obj.if_match}
                for obj in payload.objects:
                    if obj.if_match:
                        # A move must not silently fall back to unconditional deletion.
                        client.delete_object(Bucket=bucket_name, Key=obj.key, IfMatch='"' + obj.if_match.strip('"') + '"', **({"VersionId": obj.version_id} if obj.version_id else {}))
                ordinary = [item for item in items if item["Key"] not in conditional_keys]
                if ordinary:
                    delete_objects(client, bucket_name, ordinary)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to delete objects in bucket '{bucket_name}': {exc}") from exc
        return len(items)

    def create_folder(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        prefix: str,
    ) -> None:
        client = self._client(account)
        key = prefix if prefix.endswith("/") else f"{prefix}/"
        with self._object_mutation(account, bucket_name):
            try:
                client.put_object(Bucket=bucket_name, Key=key, Body=b"")
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to create folder '{key}': {exc}") from exc

    def initiate_multipart_upload(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: MultipartUploadInitRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> MultipartUploadInitResponse:
        require_multipart_write_access(account, bucket_name)
        client = self._client(account, request_profile="long_running")
        kwargs = {"Bucket": bucket_name, "Key": payload.key}
        kwargs.update(self._sse_customer_params(sse_customer))
        if payload.content_type:
            kwargs["ContentType"] = payload.content_type
        if payload.metadata:
            kwargs["Metadata"] = payload.metadata
        if payload.tags:
            tag_str = urlencode([(tag.key, tag.value) for tag in payload.tags])
            if tag_str:
                kwargs["Tagging"] = tag_str
        if payload.acl:
            kwargs["ACL"] = payload.acl
        try:
            resp = client.create_multipart_upload(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to initiate multipart upload for '{payload.key}': {exc}") from exc
        upload_id = resp.get("UploadId")
        if not upload_id:
            raise RuntimeError("Multipart upload failed to return an upload id")
        return MultipartUploadInitResponse(key=payload.key, upload_id=upload_id)

    def list_multipart_uploads(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        prefix: Optional[str] = None,
        key_marker: Optional[str] = None,
        upload_id_marker: Optional[str] = None,
        max_uploads: int = 50,
    ) -> ListMultipartUploadsResponse:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "MaxUploads": max_uploads}
        if prefix:
            kwargs["Prefix"] = prefix
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if upload_id_marker:
            kwargs["UploadIdMarker"] = upload_id_marker
        try:
            resp = client.list_multipart_uploads(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list multipart uploads for '{bucket_name}': {exc}") from exc
        uploads: list[MultipartUploadItem] = []
        for upload in resp.get("Uploads", []) or []:
            uploads.append(
                MultipartUploadItem(
                    key=upload.get("Key"),
                    upload_id=upload.get("UploadId"),
                    initiated=upload.get("Initiated"),
                    storage_class=upload.get("StorageClass"),
                    owner=(upload.get("Owner") or {}).get("DisplayName") or (upload.get("Owner") or {}).get("ID"),
                )
            )
        return ListMultipartUploadsResponse(
            uploads=uploads,
            is_truncated=bool(resp.get("IsTruncated")),
            next_key=resp.get("NextKeyMarker"),
            next_upload_id=resp.get("NextUploadIdMarker"),
        )

    def presign_part(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        payload: PresignPartRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> PresignPartResponse:
        require_multipart_write_access(account, bucket_name)
        if not payload.upload_id:
            raise RuntimeError("Upload id is required to presign a part")
        client = self._client(account)
        expires = payload.expires_in or 900
        params = {
            "Bucket": bucket_name,
            "Key": payload.key,
            "UploadId": payload.upload_id,
            "PartNumber": payload.part_number,
        }
        params.update(self._sse_customer_params(sse_customer))
        headers = self._sse_customer_headers(sse_customer)
        try:
            url = client.generate_presigned_url(
                "upload_part",
                Params=params,
                ExpiresIn=expires,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to presign part {payload.part_number} for '{payload.key}': {exc}") from exc
        return PresignPartResponse(url=url, expires_in=expires, headers=headers)

    def complete_multipart_upload(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        upload_id: str,
        payload: CompleteMultipartUploadRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> None:
        require_multipart_write_access(account, bucket_name)
        if not payload.parts:
            raise RuntimeError("No parts provided to complete multipart upload")
        client = self._client(account, request_profile="long_running")
        sorted_parts = sorted(payload.parts, key=lambda part: part.part_number)
        completed = [{"ETag": part.etag, "PartNumber": part.part_number} for part in sorted_parts]
        with self._object_mutation(account, bucket_name):
            try:
                client.complete_multipart_upload(
                    Bucket=bucket_name,
                    Key=key,
                    UploadId=upload_id,
                    MultipartUpload={"Parts": completed},
                    **check_destination(client, account, bucket_name, key, payload.write_guard, self._sse_customer_params(sse_customer)),
                    **self._sse_customer_params(sse_customer),
                )
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to complete multipart upload for '{key}': {exc}") from exc

    def abort_multipart_upload(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        upload_id: str,
    ) -> None:
        require_multipart_write_access(account, bucket_name)
        client = self._client(account, request_profile="long_running")
        with self._object_mutation(account, bucket_name):
            try:
                client.abort_multipart_upload(Bucket=bucket_name, Key=key, UploadId=upload_id)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to abort multipart upload for '{key}': {exc}") from exc

    def list_multipart_parts(self, bucket_name, account, key, upload_id, *, marker=0, limit=1000, sse_customer=None):
        require_multipart_write_access(account, bucket_name)
        return list_parts(self._client(account), bucket_name, key, upload_id, marker=marker, limit=limit,
                          sse=self._sse_customer_params(sse_customer))

    def upload_multipart_part(self, bucket_name, account, key, upload_id, part_number, file, *, sse_customer=None):
        require_multipart_write_access(account, bucket_name)
        return upload_part(self._client(account, request_profile="long_running"), bucket_name, key, upload_id,
                           part_number, file, sse=self._sse_customer_params(sse_customer))
