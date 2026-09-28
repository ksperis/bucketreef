# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Copy a stable source, including objects above the single-copy limit."""
from __future__ import annotations

from math import ceil
from urllib.parse import urlencode
from botocore.exceptions import ClientError

from .write_conflicts import check_destination

SINGLE_COPY_LIMIT = 5 * 1024**3


def source_identity(head):
    return (head.get("VersionId"), head.get("ETag"), head.get("ContentLength"), head.get("LastModified"))


def delete_verified_copy_source(client, bucket, payload, checkpoint):
    """Retry only deletion; never issue another copy for a completed copy step."""
    state = checkpoint.model_dump() if hasattr(checkpoint, "model_dump") else checkpoint
    result = {"copied": True, "source_deleted": False, "checkpoint": state}
    if not payload.move:
        raise RuntimeError("A copied checkpoint is only valid for a move")
    source_bucket = payload.source_bucket or bucket
    try:
        target = client.head_object(Bucket=bucket, Key=payload.destination_key,
                                   **({"VersionId": state["destination_version_id"]} if state.get("destination_version_id") else {}))
        if target.get("ContentLength") != state["source_size"] or target.get("ETag") != state["destination_etag"]:
            result["reason"] = "Copied, not deleted: destination verification failed."
            return result
        try:
            current = client.head_object(Bucket=source_bucket, Key=payload.source_key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                result["source_deleted"] = True
                return result
            raise
        expected = (state.get("source_version_id"), state["source_etag"], state["source_size"], state.get("source_modified"))
        if source_identity(current) != expected:
            result["reason"] = "Copied, not deleted: the source changed."
            return result
        client.delete_object(Bucket=source_bucket, Key=payload.source_key, IfMatch=state["source_etag"])
        result["source_deleted"] = True
    except Exception as exc:
        result["reason"] = f"Copied, not deleted: verification or conditional deletion failed ({type(exc).__name__})."
    return result


def copy_snapshot(client, account, bucket, payload, source_head=None):
    source_bucket = payload.source_bucket or bucket
    source = {"Bucket": source_bucket, "Key": payload.source_key}
    if payload.source_version_id:
        source["VersionId"] = payload.source_version_id
    head = source_head if source_head is not None else client.head_object(**source)
    if head.get("VersionId"):
        source["VersionId"] = head["VersionId"]
    if not head.get("ETag"):
        raise RuntimeError("Source has no ETag; a stable copy cannot be verified.")
    destination = {"Bucket": bucket, "Key": payload.destination_key}
    conditions = check_destination(client, account, bucket, payload.destination_key, payload.write_guard)
    common = {}
    if payload.acl:
        common["ACL"] = payload.acl
    fields = ("ContentType", "CacheControl", "ContentDisposition", "ContentEncoding", "ContentLanguage", "Expires", "StorageClass")
    if payload.replace_metadata:
        common.update(MetadataDirective="REPLACE", Metadata=payload.metadata or {})
        common.update({field: head[field] for field in fields if field in head})
    if payload.replace_tags:
        common.update(TaggingDirective="REPLACE", Tagging=urlencode([(t.key, t.value) for t in payload.tags]))
    if head["ContentLength"] <= SINGLE_COPY_LIMIT:
        response = client.copy_object(**destination, CopySource=source, CopySourceIfMatch=head["ETag"], **conditions, **common)
        written_etag = (response.get("CopyObjectResult") or {}).get("ETag")
    else:
        common.pop("MetadataDirective", None)
        common.pop("TaggingDirective", None)
        common.setdefault("Metadata", head.get("Metadata", {}))
        common.update({field: head[field] for field in fields if field in head and field not in common})
        if not payload.replace_tags:
            tags = client.get_object_tagging(**source).get("TagSet", [])
            common["Tagging"] = urlencode([(t["Key"], t["Value"]) for t in tags])
        upload_id = client.create_multipart_upload(**destination, **common)["UploadId"]
        try:
            parts = []
            part_size = max(64 * 1024**2, ceil(head["ContentLength"] / 10000))
            for number, start in enumerate(range(0, head["ContentLength"], part_size), 1):
                end = min(start + part_size, head["ContentLength"]) - 1
                part = client.upload_part_copy(**destination, UploadId=upload_id, PartNumber=number,
                    CopySource=source, CopySourceIfMatch=head["ETag"], CopySourceRange=f"bytes={start}-{end}")
                parts.append({"PartNumber": number, "ETag": part["CopyPartResult"]["ETag"]})
            # Recheck immediately before committing the destination; never retry without conditions.
            conditions = check_destination(client, account, bucket, payload.destination_key, payload.write_guard)
            response = client.complete_multipart_upload(**destination, UploadId=upload_id, MultipartUpload={"Parts": parts}, **conditions)
            written_etag = response.get("ETag")
        except Exception:
            try:
                client.abort_multipart_upload(**destination, UploadId=upload_id)
            except Exception:
                pass  # Preserve the original failure, never complete a partial copy.
            raise
    if payload.replace_tags:
        # RGW compatibility: preserve literal whitespace in tag keys and values.
        tagging_target = {**destination, **({"VersionId": response["VersionId"]} if response.get("VersionId") else {})}
        tags = [{"Key": tag.key, "Value": tag.value} for tag in payload.tags]
        if tags:
            client.put_object_tagging(**tagging_target, Tagging={"TagSet": tags})
        else:
            client.delete_object_tagging(**tagging_target)
    result = {"copied": True, "source_deleted": False, "source_etag": head["ETag"], "destination_etag": written_etag}
    if not payload.move:
        return result
    if written_etag:
        result["checkpoint"] = {"source_etag": head["ETag"], "source_size": head["ContentLength"],
                                "source_modified": head.get("LastModified"), "source_version_id": head.get("VersionId"),
                                "destination_etag": written_etag, "destination_version_id": response.get("VersionId")}
    # The old versions stay at the original key. Delete the current key only.
    try:
        current = client.head_object(Bucket=source_bucket, Key=payload.source_key)
        target = client.head_object(**destination, **({"VersionId": response["VersionId"]} if response.get("VersionId") else {}))
        if source_identity(head) != source_identity(current):
            result["reason"] = "Copied, not deleted: the source changed."
        elif target.get("ContentLength") != head["ContentLength"] or not written_etag or target.get("ETag") != written_etag:
            result["reason"] = "Copied, not deleted: destination verification failed."
        else:
            # Unsupported conditional deletion fails safely, with the source retained.
            client.delete_object(Bucket=source_bucket, Key=payload.source_key, IfMatch=head["ETag"])
            result["source_deleted"] = True
    except Exception as exc:
        result["reason"] = f"Copied, not deleted: verification or conditional deletion failed ({type(exc).__name__})."
    return result
