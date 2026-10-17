# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from unittest.mock import Mock

from app.services import s3_bucket_metadata
from app.services.bucket_configuration_service import BucketConfigurationService


def test_bucket_tags_preserve_literal_keys_and_values_on_round_trip(monkeypatch):
    client = Mock()
    tag_set = [
        {"Key": " env+ ", "Value": " value//+ "},
        {"Key": "env+", "Value": "distinct"},
        {"Key": " ", "Value": ""},
    ]
    client.get_bucket_tagging.return_value = {"TagSet": tag_set}
    monkeypatch.setattr(s3_bucket_metadata, "get_s3_client", lambda *args, **kwargs: client)
    service = BucketConfigurationService()
    monkeypatch.setattr(
        service,
        "_client_kwargs",
        lambda account: {"access_key": "test-key", "secret_key": "test-secret"},
    )

    tags = [tag.model_dump() for tag in service.get_bucket_tags("reports", Mock())]
    assert tags == [{"key": item["Key"], "value": item["Value"]} for item in tag_set]
    service.set_bucket_tags("reports", Mock(), tags)

    client.put_bucket_tagging.assert_called_once_with(Bucket="reports", Tagging={"TagSet": tag_set})
    client.delete_bucket_tagging.assert_not_called()


def test_empty_bucket_tag_set_still_uses_native_delete(monkeypatch):
    client = Mock()
    monkeypatch.setattr(s3_bucket_metadata, "get_s3_client", lambda *args, **kwargs: client)

    s3_bucket_metadata.put_bucket_tags("reports", [])

    client.delete_bucket_tagging.assert_called_once_with(Bucket="reports")
    client.put_bucket_tagging.assert_not_called()


def test_metadata_client_forwards_all_connection_options(monkeypatch):
    client = Mock()
    captured = {}

    def build_client(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return client

    monkeypatch.setattr(s3_bucket_metadata, "get_s3_client", build_client)
    client.get_bucket_logging.return_value = {}

    s3_bucket_metadata.get_bucket_logging(
        "reports",
        access_key="access",
        secret_key="secret",
        session_token="token",
        endpoint="https://s3.example.test",
        region="eu-west-3",
        force_path_style=True,
        verify_tls=False,
    )

    assert captured == {
        "args": ("access", "secret"),
        "kwargs": {
            "endpoint": "https://s3.example.test",
            "session_token": "token",
            "region": "eu-west-3",
            "force_path_style": True,
            "verify_tls": False,
        },
    }
