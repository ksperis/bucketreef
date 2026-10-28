# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Annotated, Optional, Literal

from pydantic import AfterValidator, Field

from app.models.base import ApiModel
from app.models.portal_storage_spaces import PortalStorageSpaceIcon


class BrowserBucket(ApiModel):
    name: str
    creation_date: Optional[datetime] = None
    display_name: Optional[str] = None
    workspace_label: Optional[str] = None
    description: Optional[str] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    status: Optional[str] = None
    role: Optional[str] = None
    internal_bucket_name: Optional[str] = None
    icon: Optional[PortalStorageSpaceIcon] = None


class CreateBucketPayload(ApiModel):
    name: str
    versioning: bool = False


class CreateFolderPayload(ApiModel):
    prefix: str = Field(..., description="Folder prefix, trailing slash optional")


class EnsureCorsPayload(ApiModel):
    origin: Optional[str] = None


class BrowserObject(ApiModel):
    key: str
    size: int
    last_modified: Optional[datetime] = None
    etag: Optional[str] = None
    storage_class: Optional[str] = None


class ObjectUploadResponse(ApiModel):
    key: str
    message: str


BrowserObjectSortBy = Literal["name", "size", "modified", "storage_class", "etag"]
BrowserObjectSortDir = Literal["asc", "desc"]
BrowserObjectLazyColumn = Literal[
    "content_type",
    "tags_count",
    "metadata_count",
    "cache_control",
    "expires",
    "restore_status",
]


class ListBrowserObjectsResponse(ApiModel):
    prefix: str
    objects: list[BrowserObject]
    prefixes: list[str]
    is_truncated: bool
    next_continuation_token: Optional[str]


class ObjectColumnsRequest(ApiModel):
    keys: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1, max_length=200)
    columns: list[BrowserObjectLazyColumn] = Field(min_length=1, max_length=6)


class ObjectColumnValues(ApiModel):
    key: str
    content_type: Optional[str] = None
    tags_count: Optional[int] = None
    metadata_count: Optional[int] = None
    cache_control: Optional[str] = None
    expires: Optional[datetime] = None
    restore_status: Optional[str] = None
    metadata_status: Literal["ready", "error"] = "ready"
    tags_status: Literal["ready", "error"] = "ready"


class ObjectColumnsResponse(ApiModel):
    items: list[ObjectColumnValues]


class PaginatedBrowserBucketsResponse(ApiModel):
    items: list[BrowserBucket]
    total: int
    page: int
    page_size: int
    has_next: bool


class BrowserUsageSummary(ApiModel):
    available: bool
    source: Optional[Literal["account", "s3_user", "portal", "connection", "openstack_project"]]
    label: Optional[str]
    used_bytes: Optional[int]
    object_count: Optional[int]
    quota_max_size_bytes: Optional[int]
    quota_max_objects: Optional[int]


class BrowserObjectVersion(ApiModel):
    key: str
    version_id: Optional[str]
    is_latest: bool
    is_delete_marker: bool
    last_modified: Optional[datetime]
    size: Optional[int]
    etag: Optional[str]
    storage_class: Optional[str]


class ListObjectVersionsResponse(ApiModel):
    prefix: Optional[str]
    common_prefixes: list[str]
    versions: list[BrowserObjectVersion]
    delete_markers: list[BrowserObjectVersion]
    is_truncated: bool
    key_marker: Optional[str]
    version_id_marker: Optional[str]
    next_key_marker: Optional[str]
    next_version_id_marker: Optional[str]


class ObjectMetadata(ApiModel):
    key: str
    size: int
    etag: Optional[str]
    last_modified: Optional[datetime]
    content_type: Optional[str]
    cache_control: Optional[str]
    content_disposition: Optional[str]
    content_encoding: Optional[str]
    content_language: Optional[str]
    expires: Optional[datetime]
    storage_class: Optional[str]
    restore_status: Optional[str]
    metadata: dict[str, str]
    version_id: Optional[str]


class ObjectTag(ApiModel):
    key: str = Field(min_length=1)
    value: str


def _validate_object_tag_keys(tags: list[ObjectTag]) -> list[ObjectTag]:
    seen: set[str] = set()
    for tag in tags:
        if tag.key in seen:
            raise ValueError(f"Duplicate object tag key: {tag.key}")
        seen.add(tag.key)
    return tags


ObjectTagList = Annotated[list[ObjectTag], AfterValidator(_validate_object_tag_keys)]


class ObjectTags(ApiModel):
    key: str
    tags: ObjectTagList
    version_id: Optional[str]


class ObjectTagsUpdate(ApiModel):
    key: str
    tags: ObjectTagList
    version_id: Optional[str] = None


class ObjectMetadataUpdate(ApiModel):
    key: str
    version_id: Optional[str] = None
    content_type: Optional[str] = None
    cache_control: Optional[str] = None
    content_disposition: Optional[str] = None
    content_encoding: Optional[str] = None
    content_language: Optional[str] = None
    expires: Optional[str] = None
    metadata: Optional[dict[str, str]] = None
    storage_class: Optional[str] = None


class ObjectAcl(ApiModel):
    key: str
    acl: str
    version_id: Optional[str]


class ObjectAclUpdate(ApiModel):
    key: str
    acl: str
    version_id: Optional[str] = None


class ObjectLegalHold(ApiModel):
    key: str
    status: Optional[Literal["ON", "OFF"]]
    version_id: Optional[str]


class ObjectLegalHoldUpdate(ApiModel):
    key: str
    status: Literal["ON", "OFF"]
    version_id: Optional[str] = None


class ObjectRetention(ApiModel):
    key: str
    mode: Optional[Literal["GOVERNANCE", "COMPLIANCE"]]
    retain_until: Optional[datetime]
    version_id: Optional[str]


class ObjectRetentionUpdate(ApiModel):
    key: str
    mode: Literal["GOVERNANCE", "COMPLIANCE"]
    retain_until: datetime
    bypass_governance: Optional[bool] = None
    version_id: Optional[str] = None


class ObjectRestoreRequest(ApiModel):
    key: str
    days: int = Field(default=1, ge=1, le=3650)
    tier: Optional[Literal["Standard", "Bulk", "Expedited"]] = None
    version_id: Optional[str] = None


class PresignRequest(ApiModel):
    key: str
    operation: Literal["get_object", "put_object", "delete_object"]
    expires_in: int = Field(default=900, ge=60, le=43200)
    content_type: Optional[str] = None
    response_content_disposition: Optional[str] = None
    version_id: Optional[str] = None


class PresignedUrl(ApiModel):
    url: str
    method: str
    expires_in: int
    headers: dict[str, str]


class SseCustomerContext(ApiModel):
    algorithm: Literal["AES256"] = "AES256"
    key: str
    key_md5: str


class MultipartUploadInitRequest(ApiModel):
    key: str
    content_type: Optional[str] = None
    metadata: dict[str, str] = Field(default_factory=dict)
    tags: ObjectTagList = Field(default_factory=list)
    acl: Optional[str] = None


class MultipartUploadInitResponse(ApiModel):
    key: str
    upload_id: str


class MultipartUploadItem(ApiModel):
    key: str
    upload_id: str
    initiated: Optional[datetime]
    storage_class: Optional[str]
    owner: Optional[str]


class ListMultipartUploadsResponse(ApiModel):
    uploads: list[MultipartUploadItem]
    is_truncated: bool
    next_key: Optional[str]
    next_upload_id: Optional[str]


class PresignPartRequest(ApiModel):
    key: str
    upload_id: Optional[str] = None
    part_number: int
    expires_in: int = Field(default=900, ge=60, le=43200)


class PresignPartResponse(ApiModel):
    url: str
    method: str
    expires_in: int
    headers: dict[str, str]


class CompletedPart(ApiModel):
    part_number: int
    etag: str


class CompleteMultipartUploadRequest(ApiModel):
    parts: list[CompletedPart]


class CopyObjectPayload(ApiModel):
    source_bucket: Optional[str] = None
    source_key: str
    destination_key: str
    source_version_id: Optional[str] = None
    metadata: dict[str, str] = Field(default_factory=dict)
    replace_metadata: bool = False
    tags: ObjectTagList = Field(default_factory=list)
    replace_tags: bool = False
    acl: Optional[str] = None
    move: bool = False


class DeleteObjectEntry(ApiModel):
    key: str
    version_id: Optional[str] = None


class DeleteObjectsPayload(ApiModel):
    objects: list[DeleteObjectEntry]


class DeleteObjectsResponse(ApiModel):
    deleted: int


class CleanupObjectVersionsPayload(ApiModel):
    prefix: Optional[str] = None
    keep_last_n: Optional[int] = Field(default=None, ge=1)
    older_than_days: Optional[int] = Field(default=None, ge=1)
    delete_orphan_markers: bool = False


class CleanupObjectVersionsResponse(ApiModel):
    prefix: Optional[str]
    deleted_versions: int
    deleted_delete_markers: int
    scanned_versions: int
    scanned_delete_markers: int


class BucketCorsRule(ApiModel):
    allowed_origins: list[str] = Field(default_factory=list)
    allowed_methods: list[str] = Field(default_factory=list)
    allowed_headers: list[str] = Field(default_factory=list)
    expose_headers: list[str] = Field(default_factory=list)
    max_age_seconds: Optional[int] = None


class BucketCorsStatus(ApiModel):
    enabled: bool
    rules: list[BucketCorsRule] = Field(default_factory=list)
    error: Optional[str] = None


class StsStatus(ApiModel):
    available: bool
    error: Optional[str]


class BrowserStsCredentials(ApiModel):
    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: datetime
    endpoint: str
    region: str
