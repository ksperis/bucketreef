# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Annotated, Optional

from pydantic import BeforeValidator, Field

from app.models.base import ApiModel
from app.utils.s3_endpoint import normalize_s3_endpoint

NormalizedS3Endpoint = Annotated[Optional[str], BeforeValidator(normalize_s3_endpoint)]


class S3KeyLogin(ApiModel):
    access_key: str = Field(min_length=1)
    secret_key: str = Field(min_length=1)
    endpoint_url: NormalizedS3Endpoint = None


class SessionCapabilities(ApiModel):
    can_manage_iam: bool = False
    can_manage_buckets: bool = True
    can_view_traffic: bool = False
    access_browser: bool = True
    endpoint_url: NormalizedS3Endpoint = None


class SessionDescriptor(ApiModel):
    actor_type: str
    account_id: Optional[str]
    account_name: Optional[str]
    capabilities: SessionCapabilities
