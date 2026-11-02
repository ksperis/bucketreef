# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from unittest.mock import Mock

from app.services import s3_bucket_access, s3_bucket_metadata, s3_bucket_security, s3_client
from app.services.bucket_configuration_service import BucketConfigurationService


def _service_without_client_resolution(monkeypatch) -> BucketConfigurationService:
    service = BucketConfigurationService()
    monkeypatch.setattr(service, "_bucket_client_kwargs", lambda *_args: {})
    return service


def test_bucket_security_models_are_normalized_consistently(monkeypatch):
    service = _service_without_client_resolution(monkeypatch)
    context = Mock()
    object_lock = {
        "enabled": True,
        "mode": "GOVERNANCE",
        "days": 30,
        "years": None,
    }
    public_access_block = {
        "block_public_acls": True,
        "ignore_public_acls": False,
        "block_public_policy": True,
        "restrict_public_buckets": False,
    }

    monkeypatch.setattr(s3_client, "get_bucket_versioning", lambda *_args, **_kwargs: "Enabled")
    monkeypatch.setattr(s3_bucket_security, "get_bucket_object_lock", lambda *_args, **_kwargs: object_lock)
    monkeypatch.setattr(
        s3_bucket_security,
        "get_bucket_public_access_block",
        lambda *_args, **_kwargs: public_access_block,
    )
    monkeypatch.setattr(s3_bucket_metadata, "get_bucket_lifecycle", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(s3_bucket_access, "get_bucket_cors", lambda *_args, **_kwargs: [])

    properties = service.get_bucket_properties("reports", context)

    assert properties.object_lock == service.get_bucket_object_lock("reports", context)
    assert properties.object_lock == service.get_object_lock("reports", context)
    assert properties.public_access_block == service.get_public_access_block("reports", context)


def test_bucket_security_readers_preserve_missing_value_contracts(monkeypatch):
    service = _service_without_client_resolution(monkeypatch)
    context = Mock()
    monkeypatch.setattr(s3_bucket_security, "get_bucket_object_lock", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(s3_bucket_security, "get_bucket_public_access_block", lambda *_args, **_kwargs: None)

    assert service.get_bucket_object_lock("reports", context) is None
    assert service.get_object_lock("reports", context).model_dump() == {
        "enabled": None,
        "mode": None,
        "days": None,
        "years": None,
    }
    assert service.get_public_access_block("reports", context).model_dump() == {
        "block_public_acls": None,
        "ignore_public_acls": None,
        "block_public_policy": None,
        "restrict_public_buckets": None,
    }
