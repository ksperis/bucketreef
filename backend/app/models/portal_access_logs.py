# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal server access-log API contracts."""

from datetime import datetime
from typing import Literal, Optional, Union

from pydantic import Field, model_validator

from app.models.base import ApiModel


PortalServerAccessDirection = Literal["Upload", "Download"]
PortalServerAccessLogFilterField = Literal["action", "space", "path", "identity", "result"]
PortalServerAccessLogFilterOp = Literal[
    "eq",
    "neq",
    "contains",
    "starts_with",
    "ends_with",
    "in",
    "not_in",
    "is_null",
    "not_null",
]


class PortalServerAccessRequesterIdentity(ApiModel):
    label: str
    kind: Literal["portal_user", "external_access", "rgw_user", "rgw_account", "unknown"]
    detail: Optional[str]
    access_key_id: Optional[str]
    iam_username: Optional[str]
    user_id: Optional[int]
    email: Optional[str]
    resolved: bool


class PortalServerAccessLogFilterRule(ApiModel):
    field: PortalServerAccessLogFilterField
    op: PortalServerAccessLogFilterOp
    value: Optional[Union[str, int, float, bool, list[str], list[int], list[float], list[bool]]] = None

    @model_validator(mode="after")
    def validate_rule(self):
        if self.op not in ("is_null", "not_null") and self.value is None:
            raise ValueError("Portal server access log filter rule requires value.")
        return self


class PortalServerAccessLogFilterQuery(ApiModel):
    match: Literal["all", "any"] = "all"
    rules: list[PortalServerAccessLogFilterRule] = Field(default_factory=list)


class PortalServerAccessLogEntry(ApiModel):
    id: str
    source: Literal["server_access_logging"]
    timestamp: datetime
    storage_space_id: Optional[str]
    storage_space_name: Optional[str]
    bucket_name: str
    operation: str
    operation_category: Literal["upload", "download", "delete", "metadata", "list", "other"]
    object_key: Optional[str]
    object_name: Optional[str]
    direction: Optional[PortalServerAccessDirection]
    status_code: Optional[int]
    error_code: Optional[str]
    bytes_sent: Optional[int]
    object_size: Optional[int]
    requester: Optional[str]
    requester_identity: Optional[PortalServerAccessRequesterIdentity]
    client_ip: Optional[str]
    auth_type: Optional[str]
    request_id: Optional[str]
    request_uri: Optional[str]
    user_agent: Optional[str]
    log_object_key: str


class PortalServerAccessLogPage(ApiModel):
    entries: list[PortalServerAccessLogEntry]
    total: int
    limit: int
    offset: int
