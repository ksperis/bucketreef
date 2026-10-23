# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.services.rgw_bucket_target import (
    RgwBucketTarget,
    split_explicit_rgw_s3_bucket_name,
)


def test_rgw_bucket_target_keeps_plain_and_qualified_names_separate() -> None:
    default_target = RgwBucketTarget.create(7, "", " shared ")
    tenant_target = RgwBucketTarget.create(7, " tenant_a ", " shared ")

    assert default_target.name == "shared"
    assert default_target.tenant == ""
    assert default_target.s3_name == "shared"
    assert default_target.admin_ops_name == "shared"
    assert tenant_target.name == "shared"
    assert tenant_target.tenant == "tenant_a"
    assert tenant_target.s3_name == "tenant_a:shared"
    assert tenant_target.admin_ops_name == "tenant_a/shared"


def test_rgw_bucket_target_rejects_prequalified_bucket_names() -> None:
    with pytest.raises(ValueError, match="unqualified"):
        RgwBucketTarget.create(7, "tenant_a", "tenant_a:shared")
    with pytest.raises(ValueError, match="unqualified"):
        RgwBucketTarget.create(7, "tenant_a", "tenant_a/shared")


def test_split_explicit_rgw_s3_bucket_name_only_accepts_explicit_tenant() -> None:
    assert split_explicit_rgw_s3_bucket_name("shared") is None
    assert split_explicit_rgw_s3_bucket_name("tenant_a:shared") == (
        "tenant_a",
        "shared",
    )
    with pytest.raises(ValueError, match="require a tenant"):
        split_explicit_rgw_s3_bucket_name(":shared")
