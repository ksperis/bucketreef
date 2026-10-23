# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import cast

import pytest
from fastapi import HTTPException

from app.db import S3Account, User
from app.models.bucket import BucketLifecycleConfig
from app.services.audit_service import AuditService
from app.services.bucket_config_mutation_service import BucketConfigMutationService
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.s3_execution_context import S3ExecutionContext


def _context() -> S3ExecutionContext:
    account = S3Account(name="browser-config-mutation")
    account.id = 77
    return S3ExecutionContext.from_account(account)


def test_browser_bucket_config_update_runs_action_before_cache_and_audit():
    calls: list[object] = []
    account = _context()
    actor = User(email="browser-config@example.com", role="admin")

    class FakeConfigurationService:
        def set_lifecycle(self, bucket_name, context, *, rules):  # noqa: ANN001
            assert bucket_name == "demo"
            assert context is account
            assert rules == [{"ID": "rule-1"}]
            calls.append("action")
            return "result"

    def invalidate_cache(received: S3ExecutionContext, bucket_name: str) -> None:
        assert received is account
        assert bucket_name == "demo"
        calls.extend(["bucket-cache", "object-cache"])

    class FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ANN003
            calls.append(("audit", kwargs))

    service = BucketConfigMutationService(
        configuration_service=cast(BucketConfigurationService, FakeConfigurationService()),
        audit_service=cast(AuditService, FakeAuditService()),
        audit_scope="browser",
        cache_invalidator=invalidate_cache,
    )

    result = service.update(
        actor=actor,
        context=account,
        bucket_name="demo",
        config_area="lifecycle",
        payload=BucketLifecycleConfig(rules=[{"ID": "rule-1"}]),
    )

    assert result == "result"
    assert calls[:3] == ["action", "bucket-cache", "object-cache"]
    audit = calls[3]
    assert isinstance(audit, tuple)
    assert audit[0] == "audit"
    assert audit[1] == {
        "user": actor,
        "scope": "browser",
        "action": "update_bucket_lifecycle",
        "entity_type": "bucket",
        "entity_id": "demo",
        "execution_context": account,
        "metadata": {"rules_count": 1},
    }


def test_browser_bucket_config_delete_does_not_invalidate_or_audit_failed_action():
    calls: list[str] = []
    account = _context()

    class FakeConfigurationService:
        def delete_lifecycle(self, bucket_name, context):  # noqa: ANN001
            assert bucket_name == "demo"
            assert context is account
            calls.append("action")
            raise RuntimeError("failed")

    def invalidate_cache(_account: S3ExecutionContext, _bucket_name: str) -> None:
        calls.extend(["bucket-cache", "object-cache"])

    class FakeAuditService:
        def record_action(self, **_kwargs):  # noqa: ANN003
            calls.append("audit")

    service = BucketConfigMutationService(
        configuration_service=cast(BucketConfigurationService, FakeConfigurationService()),
        audit_service=cast(AuditService, FakeAuditService()),
        audit_scope="browser",
        cache_invalidator=invalidate_cache,
    )

    with pytest.raises(HTTPException) as exc:
        service.delete(
            actor=User(email="browser-config@example.com", role="admin"),
            context=account,
            bucket_name="demo",
            config_area="lifecycle",
        )

    assert exc.value.status_code == 502
    assert calls == ["action"]


def test_browser_bucket_config_delete_records_no_synthetic_metadata():
    calls: list[object] = []
    account = _context()
    actor = User(email="browser-config@example.com", role="admin")

    class FakeConfigurationService:
        def delete_lifecycle(self, bucket_name, context):  # noqa: ANN001
            assert bucket_name == "demo"
            assert context is account
            calls.append("action")

    def invalidate_cache(_account: S3ExecutionContext, _bucket_name: str) -> None:
        calls.extend(["bucket-cache", "object-cache"])

    class FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ANN003
            calls.append(("audit", kwargs))

    service = BucketConfigMutationService(
        configuration_service=cast(BucketConfigurationService, FakeConfigurationService()),
        audit_service=cast(AuditService, FakeAuditService()),
        audit_scope="browser",
        cache_invalidator=invalidate_cache,
    )

    response = service.delete(
        actor=actor,
        context=account,
        bucket_name="demo",
        config_area="lifecycle",
    )

    assert response.status_code == 204
    assert response.body == b""
    assert calls[:3] == ["action", "bucket-cache", "object-cache"]
    audit = calls[3]
    assert isinstance(audit, tuple)
    assert audit[1]["action"] == "delete_bucket_lifecycle"
    assert audit[1]["metadata"] is None


def test_bucket_config_mutation_uses_configured_manager_scope_and_cache() -> None:
    calls: list[object] = []
    account = _context()
    actor = User(email="manager-config@example.com", role="admin")

    class FakeConfigurationService:
        def set_lifecycle(self, _bucket_name, _context, *, rules):  # noqa: ANN001
            assert rules == []
            calls.append("action")
            return "result"

    class FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ANN003
            calls.append(("audit", kwargs))

    def invalidate_cache(received: S3ExecutionContext, bucket_name: str) -> None:
        assert received is account
        assert bucket_name == "demo"
        calls.append("manager-cache")

    service = BucketConfigMutationService(
        configuration_service=cast(BucketConfigurationService, FakeConfigurationService()),
        audit_service=cast(AuditService, FakeAuditService()),
        audit_scope="manager",
        cache_invalidator=invalidate_cache,
    )

    assert service.update(
        actor=actor,
        context=account,
        bucket_name="demo",
        config_area="lifecycle",
        payload=BucketLifecycleConfig(rules=[]),
    ) == "result"
    assert calls[:2] == ["action", "manager-cache"]
    audit = calls[2]
    assert isinstance(audit, tuple)
    assert audit[1]["scope"] == "manager"
    assert audit[1]["action"] == "update_bucket_lifecycle"


def test_bucket_config_delete_rejects_area_without_delete_contract() -> None:
    service = BucketConfigMutationService(
        configuration_service=cast(BucketConfigurationService, object()),
        audit_service=cast(AuditService, object()),
        audit_scope="manager",
        cache_invalidator=lambda _context, _bucket_name: None,
    )

    with pytest.raises(ValueError, match="does not support delete: acl"):
        service.delete(
            actor=User(email="manager-config@example.com", role="admin"),
            context=_context(),
            bucket_name="demo",
            config_area="acl",
        )
