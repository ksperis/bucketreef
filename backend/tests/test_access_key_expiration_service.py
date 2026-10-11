# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta

from app.db import ManagerAccessKeyMetadata, S3Account, S3User, StorageEndpoint, StorageProvider
from app.models.iam import AccessKey
from app.models.s3_user import S3UserAccessKey
from app.services import access_key_expiration_service
from app.services.access_key_expiration_service import AccessKeyExpirationService
from app.utils.time import utcnow


class _FakeAuditService:
    def __init__(self, _db) -> None:
        pass

    def record_action(self, **_kwargs) -> None:
        pass


class _FakeS3UsersService:
    def __init__(self, _db, *, active: bool = True, missing: bool = False, failure: Exception | None = None) -> None:
        self.active = active
        self.missing = missing
        self.failure = failure
        self.calls: list[tuple] = []

    def list_keys(self, user_id: int) -> list[S3UserAccessKey]:
        self.calls.append(("list", user_id))
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

    def set_key_status(self, user_id: int, access_key: str, active: bool) -> S3UserAccessKey:
        self.calls.append(("set", user_id, access_key, active))
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
    monkeypatch.setattr(access_key_expiration_service, "AuditService", _FakeAuditService)


def test_due_rgw_user_key_is_disabled_even_after_resource_opt_out(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UsersService(db_session, active=True)
    monkeypatch.setattr(access_key_expiration_service, "S3UsersService", lambda _db: fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result["enforced"] == 1
    assert row.expiration_state == "enforced"
    assert row.expiration_enforced_at is not None
    assert fake.calls == [
        ("list", s3_user.id),
        ("set", s3_user.id, "AK-SECONDARY", False),
    ]


def test_already_inactive_key_is_idempotently_enforced(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UsersService(db_session, active=False)
    monkeypatch.setattr(access_key_expiration_service, "S3UsersService", lambda _db: fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result["enforced"] == 1
    assert row.expiration_state == "enforced"
    assert fake.calls == [("list", s3_user.id)]


def test_provider_failure_is_retried_without_marking_key_expired(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    fake = _FakeS3UsersService(db_session, failure=ValueError("temporary provider outage"))
    monkeypatch.setattr(access_key_expiration_service, "S3UsersService", lambda _db: fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result["retried"] == 1
    assert row.expiration_state == "retrying"
    assert row.expiration_enforced_at is None
    assert "temporary provider outage" in (row.expiration_last_error or "")


def test_interface_key_is_blocked_without_provider_mutation(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user, access_key_id="AK-INTERFACE")
    fake = _FakeS3UsersService(db_session, active=True)
    monkeypatch.setattr(access_key_expiration_service, "S3UsersService", lambda _db: fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result["blocked"] == 1
    assert row.expiration_state == "blocked"
    assert "interface" in (row.expiration_last_error or "").lower()
    assert fake.calls == []


def test_missing_provider_key_removes_stale_local_record(db_session, monkeypatch):
    endpoint = _endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint)
    row = _due_s3_user_row(db_session, s3_user)
    row_id = row.id
    fake = _FakeS3UsersService(db_session, missing=True)
    monkeypatch.setattr(access_key_expiration_service, "S3UsersService", lambda _db: fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    assert result["missing"] == 1
    assert db_session.query(ManagerAccessKeyMetadata).filter(ManagerAccessKeyMetadata.id == row_id).first() is None


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
    monkeypatch.setattr(access_key_expiration_service, "get_iam_service", lambda *_args, **_kwargs: fake)
    _patch_audit(monkeypatch)

    result = AccessKeyExpirationService(db_session).run_due()

    db_session.refresh(row)
    assert result["enforced"] == 1
    assert row.expiration_state == "enforced"
    assert fake.calls == [
        ("list", "alice"),
        ("set", "alice", "AK-IAM", "Inactive"),
        ("list", "alice"),
    ]
