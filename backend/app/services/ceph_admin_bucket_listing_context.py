# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Protocol

from app.services.bucket_listing_owner_metadata import BucketListingAdminContext
from app.services.s3_execution_context import CephAdminS3ContextSource


class CephAdminBucketListingContext(
    BucketListingAdminContext, CephAdminS3ContextSource, Protocol
):
    """RGW Admin metadata and explicit S3 credentials for a bucket listing."""
