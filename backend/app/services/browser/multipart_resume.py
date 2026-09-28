# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Stateless multipart operations. The browser owns recovery metadata."""
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException


def require_multipart_write_access(account, bucket_name):
    spaces = getattr(account, "portal_storage_spaces", None)
    if spaces is not None:
        space = next((space for space in spaces if (space.internal_bucket_name or space.id) == bucket_name), None)
        if space is None or space.role == "Viewer":
            raise HTTPException(status_code=403, detail="Storage Space permissions do not allow this upload")


def list_parts(client, bucket_name, key, upload_id, *, marker=0, limit=1000, sse=None):
    try:
        response = client.list_parts(Bucket=bucket_name, Key=key, UploadId=upload_id,
                                     PartNumberMarker=marker, MaxParts=limit, **(sse or {}))
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchUpload":
            raise HTTPException(status_code=404, detail="Multipart upload no longer exists and cannot be resumed") from exc
        raise RuntimeError(f"Unable to list multipart parts: {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to list multipart parts: {exc}") from exc
    return {"parts": [{"part_number": part["PartNumber"], "etag": part["ETag"], "size": part["Size"]} for part in response.get("Parts", [])],
            "is_truncated": bool(response.get("IsTruncated")), "next_part_number_marker": response.get("NextPartNumberMarker")}


def upload_part(client, bucket_name, key, upload_id, part_number, file, *, sse=None):
    if file.size is None or file.size > 5 * 1024 ** 3:
        raise HTTPException(status_code=413, detail="A multipart part must have a known size of at most 5 GiB")
    try:
        result = client.upload_part(Bucket=bucket_name, Key=key, UploadId=upload_id,
                                    PartNumber=part_number, Body=file.file, ContentLength=file.size, **(sse or {}))
        return {"part_number": part_number, "etag": result["ETag"], "size": file.size}
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to upload multipart part: {exc}") from exc
