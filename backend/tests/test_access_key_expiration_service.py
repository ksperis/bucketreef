# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta

import pytest

from app.db import ManagerAccessKeyMetadata, S3Account, S3User, StorageEndpoint
from app.core.domain_enums import StorageProvider
from app.models.iam import AccessKey
from app.models.s3_user import S3UserAccessKey
from app.services import access_key_expiration_service
from app.services.access_key_expiration_service import (
    AccessKeyExpirationService,
    RetryableExpirationError,
)
from app.utils.time import utcnow
from tests.db_transaction_test_utils import (
    fail_next_sqlite_statement_with_busy_snapshot,
    fail_next_transaction_commit,
)


class _FakeAuditService:
    calls: list[dict] = []

    def __init__(self, _db) -> None:
        pass

    def record_action(self, **kwargs) -> None:
        type(self).calls.append(kwargs)


class _FakeS3UserAccessKeyService:
    def __init__(self, db, *, active: bool = True, missing: bool = False, failure: Exception | None = None) -> None:
        self.db = db
        self.active = active
        self.missing = missing
        self.failure = failure
        self.calls: list[tuple] = []

    def list_keys(self, s3_user, _admin) -> list[S3UserAccessKey]:
        assert self.db.in_transaction() is False
        self.calls.append(("list", s3_user.id))
        if self.failure is not None:
            raise self.failure
        if self.missing:
            return []
        return [
            S3UserAccessKey(
                access_key_id="AK-SECONDARY",
                status="enabled" if self.active else "disabled",
                is_ui_managed=False,
                is_active=self.active,
            )
        ]

    def set_key_status(self, s3_user, _admin, access_key: str, active: bool) -> S3UserAccessKey:
        assert self.db.in_transaction() is False
        self.calls.append(("set", s3_user.id, access_key, active))
        self.active = active
        return S3UserAccessKey(
            access_key_id=access_key,
            status="enabled" if active else "disabled",
            is_ui_managed=False,
            is_active=active,
        )


class _FakeIamService:
    def __init__(self) -> None:
        self.status = "Active"
        self.calls: list[tuple] = []

    def list_access_keys(self, user_name: str) -> list[AccessKey]:
        self.calls.append(("list", user_name))
        return [AccessKey(access_key_id="AK-IAM", status=self.status)]

    def update_access_key_status(self, user_name: str, access_key_id: str, status: str) -> None:
        self.calls.append(("set", user_name, access_key_id, status))
        self.status = status


def _endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="expiration-endpoint",
        endpoint_url="https://expiration.example.test",
        provider=StorageProvider.CEPH.value,
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


def _s3_user(db_session, endpoint: StorageEndpoint) -> S3User:
    user = S3User(
        name="expiration-user",
        rgw_user_uid="expiration-user",
        rgw_access_key="AK-INTERFACE",
        rgw_secret_key="SK-INTERFACE",
        storage_endpoint_id=endpoint.id,
        allow_access_key_management=False,
        allow_access_key_expiration=False,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _due_s3_user_row(db_session, s3_user: S3User, access_key_id: str = "AK-SECONDARY") -> ManagerAccessKeyMetadata:
    row = ManagerAccessKeyMetadata(
        s3_user_id=s3_user.id,
        access_key_id=access_key_id,
        expires_at=utcnow() - timedelta(minutes=1),
        expiration_state="scheduled",
    )
    db_session.add(row)
    db_session.commit()
    return row


def _patch_audit(monkeypatch) -> None:
    _FakeAuditService.calls.clear()
    monkeypatch.setattr(access_key_expiration_service, "AuditService", _FakeAuditService)


def _patch_s3_user_keys(monkeypatch, fake: _FakeS3UserAccessKeyService) -> None:
    monkeypatch.setattr(
        access_key_expiration_service,
        "S3UserAccessKeyService",
        lambda: fake,
    )
    monkeypatch.setattr(
        access_key_expiration_service.S3UserRgwContextService,
        "admin_for_endpoint",
        staticmethod(lambda _endpoint: object()),
    )


def test_due_rgw_user_key_is_disabled_even_after_resource_opt_out(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UserAccessKeyService(db_session, active=True)
    _patch_s3_user_keys(monkeypatch, fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result.enforced == 1
    assert row.expiration_state == "enforced"
    assert row.expiration_enforced_at is not None
    assert fake.calls == [
        ("list", s3_user.id),
        ("set", s3_user.id, "AK-SECONDARY", False),
    ]
    audit_context = _FakeAuditService.calls[0]["execution_context"]
    assert audit_context.context_kind == "s3_user"
    assert audit_context.context_id == f"s3u-{s3_user.id}"


def test_enforced_persistence_retries_sqlite_busy_without_repeating_provider_call(
    db_session,
    monkeypatch,
):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UserAccessKeyService(db_session, active=True)
    _patch_s3_user_keys(monkeypatch, fake)
    _patch_audit(monkeypatch)

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "UPDATE manager_access_key_metadata SET expiration_state",
    ) as statements:
        result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result.enforced == 1
    assert row.expiration_state == "enforced"
    assert len(statements) == 2
    assert fake.calls == [
        ("list", s3_user.id),
        ("set", s3_user.id, "AK-SECONDARY", False),
    ]


def test_attempt_commit_failure_rolls_back_before_provider_call(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UserAccessKeyService(db_session, active=True)
    _patch_s3_user_keys(monkeypatch, fake)

    with fail_next_transaction_commit(db_session):
        with pytest.raises(RuntimeError, match="commit failed"):
            AccessKeyExpirationService(db_session).run_due()

    assert fake.calls == []
    db_session.expire_all()
    persisted = db_session.get(ManagerAccessKeyMetadata, row.id)
    assert persisted is not None
    assert persisted.expiration_state == "scheduled"
    assert persisted.expiration_last_attempt_at is None


def test_already_inactive_key_is_idempotently_enforced(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UserAccessKeyService(db_session, active=False)
    _patch_s3_user_keys(monkeypatch, fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result.enforced == 1
    assert row.expiration_state == "enforced"
    assert fake.calls == [("list", s3_user.id)]


def test_provider_failure_is_retried_without_marking_key_expired(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UserAccessKeyService(db_session, failure=ValueError("temporary provider outage"))
    _patch_s3_user_keys(monkeypatch, fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result.retried == 1
    assert row.expiration_state == "retrying"
    assert row.expiration_enforced_at is None
    assert "temporary provider outage" in (row.expiration_last_error or "")


def test_missing_account_credentials_are_typed_as_retryable():
    account = S3Account(
        name="expiration-account-missing-credentials",
        rgw_account_id="80000000000000009",
        rgw_user_uid="80000000000000009-admin",
        rgw_access_key=None,
        rgw_secret_key=None,
    )

    with pytest.raises(
        RetryableExpirationError,
        match="credentials are unavailable",
    ):
        AccessKeyExpirationService._iam_service_for_account(account)


def test_s3_user_provider_must_confirm_key_is_inactive(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)

    class UnconfirmedS3UserAccessKeyService(_FakeS3UserAccessKeyService):
        def set_key_status(
            self,
            s3_user,
            _admin,
            access_key: str,
            active: bool,
        ) -> S3UserAccessKey:
            assert self.db.in_transaction() is False
            self.calls.append(("set", s3_user.id, access_key, active))
            return S3UserAccessKey(
                access_key_id=access_key,
                status="enabled",
                is_ui_managed=False,
                is_active=True,
            )

    fake = UnconfirmedS3UserAccessKeyService(db_session, active=True)
    _patch_s3_user_keys(monkeypatch, fake)

    with pytest.raises(
        RetryableExpirationError,
        match="did not confirm the RGW access key as inactive",
    ):
        AccessKeyExpirationService(db_session)._process_s3_user(row.id, s3_user.id)


def test_failure_state_commit_failure_restores_session(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UserAccessKeyService(db_session, failure=ValueError("temporary provider outage"))
    _patch_s3_user_keys(monkeypatch, fake)

    with fail_next_transaction_commit(db_session, occurrence=2):
        with pytest.raises(RuntimeError, match="commit failed"):
            AccessKeyExpirationService(db_session).run_due()

    assert fake.calls == [("list", s3_user.id)]
    db_session.expire_all()
    persisted = db_session.get(ManagerAccessKeyMetadata, row.id)
    assert persisted is not None
    assert persisted.expiration_state == "scheduled"
    assert persisted.expiration_last_attempt_at is not None
    assert persisted.expiration_last_error is None


def test_provider_failure_persists_only_sanitized_error_details(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UserAccessKeyService(
        db_session,
        failure=ValueError("secret_key=TOPSECRET endpoint=https://private.example.test/admin"),
    )
    _patch_s3_user_keys(monkeypatch, fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result.retried == 1
    assert row.expiration_state == "retrying"
    assert row.expiration_last_error == "secret_key=<redacted> endpoint=<redacted-url>"
    assert "TOPSECRET" not in (row.expiration_last_error or "")
    assert "private.example.test" not in (row.expiration_last_error or "")


def test_interface_key_is_blocked_without_provider_mutation(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user, access_key_id="AK-INTERFACE")
    fake = _FakeS3UserAccessKeyService(db_session, active=True)
    _patch_s3_user_keys(monkeypatch, fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result.blocked == 1
    assert row.expiration_state == "blocked"
    assert "interface" in (row.expiration_last_error or "").lower()
    assert fake.calls == []


def test_missing_provider_key_removes_stale_local_record(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    row_id = row.id
    fake = _FakeS3UserAccessKeyService(db_session, missing=True)
    _patch_s3_user_keys(monkeypatch, fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    assert result.missing == 1
    assert db_session.get(ManagerAccessKeyMetadata, row_id) is None


def test_due_iam_key_is_disabled_and_confirmed(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    account = S3Account(
        name="expiration-account",
        rgw_account_id="80000000000000002",
        rgw_user_uid="80000000000000002-admin",
        rgw_access_key="AK-ROOT",
        rgw_secret_key="SK-ROOT",
        storage_endpoint_id=endpoint.id,
        allow_access_key_expiration=False,
    )
    db_session.add(account)
    db_session.flush()
    row = ManagerAccessKeyMetadata(
        account_id=account.id,
        principal_name="alice",
        access_key_id="AK-IAM",
        expires_at=utcnow() - timedelta(minutes=1),
        expiration_state="scheduled",
    )
    db_session.add(row)
    db_session.commit()
    fake = _FakeIamService()
    monkeypatch.setattr(access_key_expiration_service, "resolve_iam_client_options", lambda _context: ("https://iam.example.test", None, True))
    monkeypatch.setattr(access_key_expiration_service, "RGWIAMService", lambda *_args, **_kwargs: fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result.enforced == 1
    assert row.expiration_state == "enforced"
    assert fake.calls == [
        ("list", "alice"),
        ("set", "alice", "AK-IAM", "Inactive"),
        ("list", "alice"),
    ]


def test_missing_iam_provider_key_removes_stale_local_record(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    account = S3Account(
        name="expiration-account-missing",
        rgw_account_id="80000000000000003",
        rgw_user_uid="80000000000000003-admin",
        rgw_access_key="AK-ROOT",
        rgw_secret_key="SK-ROOT",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()
    row = ManagerAccessKeyMetadata(
        account_id=account.id,
        principal_name="alice",
        access_key_id="AK-IAM",
        expires_at=utcnow() - timedelta(minutes=1),
        expiration_state="scheduled",
    )
    db_session.add(row)
    db_session.commit()
    row_id = row.id

    class MissingIamService(_FakeIamService):
        def list_access_keys(self, user_name: str) -> list[AccessKey]:
            self.calls.append(("list", user_name))
            return []

    fake = MissingIamService()
    monkeypatch.setattr(
        access_key_expiration_service,
        "resolve_iam_client_options",
        lambda _context: ("https://iam.example.test", None, True),
    )
    monkeypatch.setattr(
        access_key_expiration_service,
        "RGWIAMService",
        lambda *_args, **_kwargs: fake,
    )

    result = AccessKeyExpirationService(db_session).run_due()

    assert result.missing == 1
    assert db_session.get(ManagerAccessKeyMetadata, row_id) is None
    assert fake.calls == [("list", "alice")]


def test_iam_provider_must_confirm_key_is_inactive(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    account = S3Account(
        name="expiration-account-unconfirmed",
        rgw_account_id="80000000000000004",
        rgw_user_uid="80000000000000004-admin",
        rgw_access_key="AK-ROOT",
        rgw_secret_key="SK-ROOT",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()
    row = ManagerAccessKeyMetadata(
        account_id=account.id,
        principal_name="alice",
        access_key_id="AK-IAM",
        expires_at=utcnow() - timedelta(minutes=1),
        expiration_state="scheduled",
    )
    db_session.add(row)
    db_session.commit()

    class UnconfirmedIamService(_FakeIamService):
        def update_access_key_status(
            self,
            user_name: str,
            access_key_id: str,
            status: str,
        ) -> None:
            self.calls.append(("set", user_name, access_key_id, status))

    fake = UnconfirmedIamService()
    with pytest.raises(
        RetryableExpirationError,
        match="did not confirm the IAM access key as inactive",
    ):
        AccessKeyExpirationService._ensure_iam_key_inactive(
            fake,
            principal_name="alice",
            access_key_id="AK-IAM",
        )

    fake = UnconfirmedIamService()
    monkeypatch.setattr(
        access_key_expiration_service,
        "resolve_iam_client_options",
        lambda _context: ("https://iam.example.test", None, True),
    )
    monkeypatch.setattr(
        access_key_expiration_service,
        "RGWIAMService",
        lambda *_args, **_kwargs: fake,
    )

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result.retried == 1
    assert row.expiration_state == "retrying"
    assert row.expiration_enforced_at is None
    assert "did not confirm" in (row.expiration_last_error or "")
    assert fake.calls == [
        ("list", "alice"),
        ("set", "alice", "AK-IAM", "Inactive"),
        ("list", "alice"),
    ]
