# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional
from urllib.parse import urlencode

from fastapi import HTTPException
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
from app.services.s3_deletion import delete_objects
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.services.keystone_client import OpenStackError


def require_multipart_write_access(context: S3ExecutionTarget, bucket_name: str) -> None:
    spaces = context.portal_storage_spaces if isinstance(context, S3ExecutionContext) else None
    if spaces is not None:
        space = next((space for space in spaces if (space.internal_bucket_name or space.id) == bucket_name), None)
        if space is None or space.role == "Viewer":
            raise HTTPException(status_code=403, detail="Storage Space permissions do not allow this upload")


class BrowserObjectOperationsMixin:
    @staticmethod
    def _object_identity_kwargs(
        bucket_name: str,
        key: str,
        version_id: Optional[str] = None,
    ) -> dict[str, str]:
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        return kwargs

    @staticmethod
    def _require_copy_access(
        bucket_name: str,
        source_bucket: str,
        context: S3ExecutionTarget,
        *,
        move: bool,
    ) -> None:
        spaces = (
            context.portal_storage_spaces
            if isinstance(context, S3ExecutionContext)
            else None
        )
        if spaces is None:
            return
        by_bucket = {(space.internal_bucket_name or space.id): space for space in spaces}
        source = by_bucket.get(source_bucket)
        destination = by_bucket.get(bucket_name)
        if not source or not destination or destination.role == "Viewer" or (move and source.role == "Viewer"):
            raise HTTPException(status_code=403, detail="Storage Space permissions do not allow this transfer")

    def _copy_object_request(
        self,
        client,
        *,
        bucket_name: str,
        source_bucket: str,
        payload: CopyObjectPayload,
    ) -> dict[str, object]:
        kwargs: dict[str, object] = {
            "Bucket": bucket_name,
            "Key": payload.destination_key,
            "CopySource": self._object_identity_kwargs(
                source_bucket,
                payload.source_key,
                payload.source_version_id,
            ),
        }
        if payload.replace_metadata:
            source_head_kwargs = self._object_identity_kwargs(
                source_bucket,
                payload.source_key,
                payload.source_version_id,
            )
            try:
                source_head = client.head_object(**source_head_kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(
                    f"Unable to fetch metadata for '{payload.source_key}' before copy: {exc}"
                ) from exc
            kwargs["MetadataDirective"] = "REPLACE"
            kwargs["Metadata"] = payload.metadata or {}
            for source_field in (
                "ContentType",
                "CacheControl",
                "ContentDisposition",
                "ContentEncoding",
                "ContentLanguage",
                "Expires",
                "StorageClass",
            ):
                value = source_head.get(source_field)
                if value is not None:
                    kwargs[source_field] = value
        if payload.replace_tags:
            tag_str = urlencode([(tag.key, tag.value) for tag in payload.tags])
            kwargs["TaggingDirective"] = "REPLACE"
            if tag_str:
                kwargs["Tagging"] = tag_str
        if payload.acl:
            kwargs["ACL"] = payload.acl
        return kwargs

    def _replace_copied_object_tags(
        self,
        client,
        *,
        bucket_name: str,
        payload: CopyObjectPayload,
        destination_version_id: Optional[str],
    ) -> None:
        if not payload.replace_tags:
            return
        tagging_kwargs: dict[str, object] = self._object_identity_kwargs(
            bucket_name,
            payload.destination_key,
            destination_version_id,
        )
        tag_set = [{"Key": tag.key, "Value": tag.value} for tag in payload.tags]
        if tag_set:
            client.put_object_tagging(**tagging_kwargs, Tagging={"TagSet": tag_set})
        else:
            client.delete_object_tagging(**tagging_kwargs)

    def _verify_and_delete_move_source(
        self,
        client,
        *,
        bucket_name: str,
        source_bucket: str,
        payload: CopyObjectPayload,
        destination_version_id: Optional[str],
    ) -> None:
        if not payload.move:
            return
        source_head = client.head_object(
            **self._object_identity_kwargs(
                source_bucket,
                payload.source_key,
                payload.source_version_id,
            )
        )
        destination_head = client.head_object(
            **self._object_identity_kwargs(
                bucket_name,
                payload.destination_key,
                destination_version_id,
            )
        )
        source_etag = self._clean_etag(source_head.get("ETag"))
        destination_etag = self._clean_etag(destination_head.get("ETag"))
        source_size = int(source_head.get("ContentLength") or 0)
        destination_size = int(destination_head.get("ContentLength") or 0)
        if source_size != destination_size:
            raise RuntimeError("Copy verification failed (size mismatch).")
        if not source_etag or not destination_etag:
            raise RuntimeError("Copy verification failed (missing ETag).")
        if source_etag != destination_etag:
            raise RuntimeError("Copy verification failed (ETag mismatch).")
        client.delete_object(
            **self._object_identity_kwargs(
                source_bucket,
                payload.source_key,
                payload.source_version_id,
            )
        )

    def presign(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        payload: PresignRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> PresignedUrl:
        client = self._client(context)
        expires = payload.expires_in or 900
        deadline = getattr(context, "credential_expires_at", None)
        if deadline is not None:
            from app.utils.time import utcnow
            remaining = int((deadline - utcnow()).total_seconds())
            if remaining < 1:
                raise OpenStackError("reauthentication_required", "OpenStack access expired; reconnect")
            expires = min(expires, remaining)
            if context.access_validator is not None:
                context.access_validator()
        params = {"Bucket": bucket_name, "Key": payload.key}
        params.update(self._sse_customer_params(sse_customer))
        headers: dict[str, str] = self._sse_customer_headers(sse_customer)
        if payload.version_id:
            params["VersionId"] = payload.version_id
        if payload.response_content_disposition:
            params["ResponseContentDisposition"] = payload.response_content_disposition
        try:
            if payload.operation == "get_object":
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
        context: S3ExecutionTarget,
        payload: CopyObjectPayload,
    ) -> None:
        source_bucket = payload.source_bucket or bucket_name
        self._require_copy_access(
            bucket_name,
            source_bucket,
            context,
            move=payload.move,
        )
        if payload.move and source_bucket == bucket_name and payload.source_key == payload.destination_key:
            raise RuntimeError("Cannot move an object onto itself")
        client = self._client(context, request_profile="long_running")
        kwargs = self._copy_object_request(
            client,
            bucket_name=bucket_name,
            source_bucket=source_bucket,
            payload=payload,
        )
        affected_buckets = (bucket_name, source_bucket) if payload.move else (bucket_name,)
        with self._object_mutation(context, *affected_buckets):
            try:
                resp = client.copy_object(**kwargs)
                destination_version_id = resp.get("VersionId")
                self._replace_copied_object_tags(
                    client,
                    bucket_name=bucket_name,
                    payload=payload,
                    destination_version_id=destination_version_id,
                )
                self._verify_and_delete_move_source(
                    client,
                    bucket_name=bucket_name,
                    source_bucket=source_bucket,
                    payload=payload,
                    destination_version_id=destination_version_id,
                )
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to copy object '{payload.source_key}' -> '{payload.destination_key}': {exc}") from exc

    def delete_objects(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
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
        client = self._client(context)
        with self._object_mutation(context, bucket_name):
            try:
                delete_objects(client, bucket_name, items)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to delete objects in bucket '{bucket_name}': {exc}") from exc
        return len(items)

    def create_folder(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        prefix: str,
    ) -> None:
        client = self._client(context)
        key = prefix if prefix.endswith("/") else f"{prefix}/"
        with self._object_mutation(context, bucket_name):
            try:
                client.put_object(Bucket=bucket_name, Key=key, Body=b"")
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to create folder '{key}': {exc}") from exc

    def initiate_multipart_upload(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        payload: MultipartUploadInitRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> MultipartUploadInitResponse:
        require_multipart_write_access(context, bucket_name)
        client = self._client(context, request_profile="long_running")
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
        context: S3ExecutionTarget,
        prefix: Optional[str] = None,
        key_marker: Optional[str] = None,
        upload_id_marker: Optional[str] = None,
        max_uploads: int = 50,
    ) -> ListMultipartUploadsResponse:
        client = self._client(context)
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
        context: S3ExecutionTarget,
        payload: PresignPartRequest,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> PresignPartResponse:
        if not payload.upload_id:
            raise RuntimeError("Upload id is required to presign a part")
        require_multipart_write_access(context, bucket_name)
        client = self._client(context)
        expires = payload.expires_in or 900
        deadline = getattr(context, "credential_expires_at", None)
        if deadline is not None:
            from app.utils.time import utcnow
            remaining = int((deadline - utcnow()).total_seconds())
            if remaining < 1:
                raise OpenStackError("reauthentication_required", "OpenStack access expired; reconnect")
            expires = min(expires, remaining)
            if context.access_validator is not None:
                context.access_validator()
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
        return PresignPartResponse(url=url, method="PUT", expires_in=expires, headers=headers)

    def complete_multipart_upload(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        key: str,
        upload_id: str,
        payload: CompleteMultipartUploadRequest,
    ) -> None:
        if not payload.parts:
            raise RuntimeError("No parts provided to complete multipart upload")
        require_multipart_write_access(context, bucket_name)
        client = self._client(context, request_profile="long_running")
        sorted_parts = sorted(payload.parts, key=lambda part: part.part_number)
        completed = [{"ETag": part.etag, "PartNumber": part.part_number} for part in sorted_parts]
        with self._object_mutation(context, bucket_name):
            try:
                client.complete_multipart_upload(
                    Bucket=bucket_name,
                    Key=key,
                    UploadId=upload_id,
                    MultipartUpload={"Parts": completed},
                )
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to complete multipart upload for '{key}': {exc}") from exc

    def abort_multipart_upload(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        key: str,
        upload_id: str,
    ) -> None:
        require_multipart_write_access(context, bucket_name)
        client = self._client(context, request_profile="long_running")
        with self._object_mutation(context, bucket_name):
            try:
                client.abort_multipart_upload(Bucket=bucket_name, Key=key, UploadId=upload_id)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to abort multipart upload for '{key}': {exc}") from exc
