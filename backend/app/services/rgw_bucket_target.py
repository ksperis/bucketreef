# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from app.utils.rgw_identifiers import (
    normalize_rgw_bucket_reference_name,
    validate_rgw_tenant,
)


@dataclass(frozen=True, order=True)
class RgwBucketTarget:
    """Canonical physical RGW bucket identity inside BucketReef."""

    endpoint_id: int
    tenant: str
    name: str

    @classmethod
    def create(cls, endpoint_id: int, tenant: object, name: object) -> "RgwBucketTarget":
        normalized_endpoint_id = int(endpoint_id)
        if normalized_endpoint_id < 1:
            raise ValueError("Storage endpoint id must be positive.")
        normalized_tenant = str(tenant or "").strip()
        validate_rgw_tenant(normalized_tenant)
        return cls(
            endpoint_id=normalized_endpoint_id,
            tenant=normalized_tenant,
            name=normalize_rgw_bucket_reference_name(name),
        )

    @property
    def s3_name(self) -> str:
        return f"{self.tenant}:{self.name}" if self.tenant else self.name

    @property
    def admin_ops_name(self) -> str:
        return f"{self.tenant}/{self.name}" if self.tenant else self.name

PhysicalBucketTarget = RgwBucketTarget


def split_explicit_rgw_s3_bucket_name(value: str) -> tuple[str, str] | None:
    """Validate and split ``tenant:bucket`` names used by RGW cross-tenant S3 calls."""
    if ":" not in value:
        return None
    tenant, bucket_name = value.split(":", 1)
    tenant = tenant.strip()
    if not tenant:
        raise ValueError("RGW-qualified S3 bucket names require a tenant.")
    validate_rgw_tenant(tenant)
    return tenant, normalize_rgw_bucket_reference_name(bucket_name)
