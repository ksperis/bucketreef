# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest

from app.services import s3_client
from app.services.bucket_comparison_service import BucketComparisonService
from app.services.bucket_integrity_service import BucketIntegrityCheckService
from app.services.bucket_migration import execution_context
from app.services.bucket_migration.execution_context import BucketMigrationExecutionContextMixin
from app.services.bucket_purge_service import BucketPurgeService
from app.services.bucket_usage_stats_service import BucketUsageStatsService
from tests.execution_context_factory import make_s3_execution_context


@pytest.mark.parametrize(
    ("service", "message"),
    [
        (BucketComparisonService(), "S3 execution context is missing credentials"),
        (BucketPurgeService(), "S3 execution context is missing credentials"),
        (BucketIntegrityCheckService(), "S3 execution context is missing credentials"),
        (BucketUsageStatsService(), "S3 execution context is missing credentials"),
    ],
)
def test_long_running_services_type_missing_credentials_as_s3_failures(service, message):
    account = SimpleNamespace(effective_rgw_credentials=lambda: (None, None))

    with pytest.raises(s3_client.S3OperationError, match=message):
        service._build_client(account)


@pytest.mark.parametrize(
    "service",
    [
        BucketComparisonService(),
        BucketPurgeService(),
        BucketIntegrityCheckService(),
        BucketUsageStatsService(),
    ],
)
def test_long_running_services_do_not_mask_unexpected_credential_errors(service):
    class BrokenContext:
        @staticmethod
        def effective_rgw_credentials():
            raise RuntimeError("unexpected credential resolver bug")

    with pytest.raises(RuntimeError, match="unexpected credential resolver bug"):
        service._build_client(BrokenContext())


def test_compare_migration_purge_integrity_and_usage_select_long_running_profile(monkeypatch):
    captured: list[dict] = []

    def fake_get_s3_client(**kwargs):
        captured.append(kwargs)
        return object()

    monkeypatch.setattr(s3_client, "get_s3_client", fake_get_s3_client)
    monkeypatch.setattr(execution_context, "get_s3_client", fake_get_s3_client)
    account = make_s3_execution_context()

    BucketComparisonService()._build_client(account)
    BucketPurgeService()._build_client(account)
    BucketIntegrityCheckService()._build_client(account)
    BucketUsageStatsService()._build_client(account)
    BucketMigrationExecutionContextMixin()._context_client(
        SimpleNamespace(
            context_id="source",
            execution_context=account,
            endpoint="https://s3.example.test",
            region="us-east-1",
            force_path_style=False,
            verify_tls=True,
        )
    )

    assert len(captured) == 5
    assert all(call["request_profile"] == "long_running" for call in captured)
    assert captured[0].get("user_agent_extra") is None
    assert [call.get("user_agent_extra") for call in captured[1:4]] == [
        "bucketreef-bucket-purge",
        "bucketreef-bucket-integrity",
        "bucketreef-bucket-usage-stats",
    ]
