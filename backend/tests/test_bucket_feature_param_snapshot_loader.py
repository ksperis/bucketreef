# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.bucket import (
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketNotificationConfiguration,
    BucketProperties,
)
from app.models.bucket_listing import BucketListingSummary
from app.services import bucket_feature_param_snapshot_loader as snapshot_loader
from app.services.bucket_feature_param_matching import FEATURE_PARAM_UNAVAILABLE
from app.services.s3_execution_context import S3ExecutionContext


class _Service:
    def __init__(self):
        self.calls: list[str] = []
        self.failures: set[str] = set()

    def _value(self, source: str, value):
        self.calls.append(source)
        if source in self.failures:
            raise RuntimeError(source)
        return value

    def get_bucket_properties(self, *_args):
        return self._value("props", BucketProperties())

    def get_lifecycle(self, *_args):
        return self._value("lifecycle", BucketLifecycleConfig(rules=[{"ID": "rule-1"}]))

    def get_bucket_logging(self, *_args):
        return self._value("logging", {"enabled": True})

    def get_bucket_website(self, *_args):
        return self._value("website", {"index": "index.html"})

    def get_policy(self, *_args):
        return self._value("policy", {"Statement": []})

    def get_bucket_notifications(self, *_args):
        return self._value(
            "notifications",
            BucketNotificationConfiguration(configuration={"TopicConfigurations": []}),
        )

    def get_bucket_encryption(self, *_args):
        return self._value("encryption", BucketEncryptionConfiguration(rules=[]))


def _context() -> S3ExecutionContext:
    return S3ExecutionContext(
        context_id="1",
        context_kind="account",
        name="account",
        access_key=None,
        secret_key=None,
    )


def test_feature_param_snapshot_loads_requested_sources_in_stable_order():
    service = _Service()

    snapshot = snapshot_loader._load_feature_param_snapshot_for_bucket(
        BucketListingSummary(name="bucket-a"),
        {"policy", "props", "lifecycle"},
        service,
        _context(),
    )

    assert service.calls == ["props", "lifecycle", "policy"]
    assert isinstance(snapshot["props"], BucketProperties)
    assert snapshot["lifecycle"] == [{"ID": "rule-1"}]
    assert snapshot["policy"] == {"Statement": []}


def test_feature_param_snapshot_marks_runtime_errors_unavailable():
    service = _Service()
    service.failures.add("website")

    snapshot = snapshot_loader._load_feature_param_snapshot_for_bucket(
        BucketListingSummary(name="bucket-a"),
        {"website", "encryption"},
        service,
        _context(),
    )

    assert snapshot["website"] is FEATURE_PARAM_UNAVAILABLE
    assert isinstance(snapshot["encryption"], BucketEncryptionConfiguration)


def test_feature_param_snapshot_skips_notifications_when_sns_is_disabled(monkeypatch):
    service = _Service()
    monkeypatch.setattr(snapshot_loader, "execution_context_sns_feature_enabled", lambda _context: False)

    snapshot = snapshot_loader._load_feature_param_snapshot_for_bucket(
        BucketListingSummary(name="bucket-a"),
        {"notifications"},
        service,
        _context(),
    )

    assert snapshot["notifications"] is FEATURE_PARAM_UNAVAILABLE
    assert service.calls == []
