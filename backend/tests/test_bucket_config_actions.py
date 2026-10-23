# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from pydantic import ValidationError

from app.db import S3Account
from app.models.bucket import (
    BucketCors,
    BucketPublicAccessBlock,
    BucketPublicAccessBlockUpdate,
    BucketVersioningUpdate,
)
from app.services import bucket_config_actions


def test_public_access_block_read_and_write_contracts_are_explicit() -> None:
    expected_fields = {
        "block_public_acls",
        "ignore_public_acls",
        "block_public_policy",
        "restrict_public_buckets",
    }
    assert set(BucketPublicAccessBlock.model_json_schema()["required"]) == expected_fields
    assert set(BucketPublicAccessBlockUpdate.model_json_schema()["required"]) == expected_fields

    with pytest.raises(ValidationError):
        BucketPublicAccessBlockUpdate.model_validate({"block_public_acls": True})


def test_get_bucket_cors_config_uses_dedicated_cors_service():
    calls: dict[str, int] = {"cors": 0}

    class FakeBucketsService:
        def get_bucket_cors(self, bucket_name, account):  # noqa: ANN001
            calls["cors"] += 1
            assert bucket_name == "demo-bucket"
            assert account.name == "account-a"
            return [{"AllowedMethods": ["GET"], "AllowedOrigins": ["*"]}]

        def get_bucket_properties(self, bucket_name, account):  # noqa: ANN001
            raise AssertionError("get_bucket_properties should not be used for CORS")

    result = bucket_config_actions.get_bucket_cors_config(
        service=FakeBucketsService(),
        context=S3Account(name="account-a"),
        bucket_name="demo-bucket",
    )

    assert result == BucketCors(rules=[{"AllowedMethods": ["GET"], "AllowedOrigins": ["*"]}])
    assert calls == {"cors": 1}


def test_update_bucket_versioning_config_returns_no_content_response():
    calls: list[tuple[str, bool]] = []

    class FakeConfigurationService:
        def set_versioning(self, bucket_name, account, enabled):  # noqa: ANN001
            assert account.name == "account-a"
            calls.append((bucket_name, enabled))

    response, metadata = bucket_config_actions.update_bucket_versioning_config(
        service=FakeConfigurationService(),
        context=S3Account(name="account-a"),
        bucket_name="demo-bucket",
        payload=BucketVersioningUpdate(enabled=True),
    )

    assert response.status_code == 204
    assert response.body == b""
    assert metadata == {"enabled": True}
    assert calls == [("demo-bucket", True)]
