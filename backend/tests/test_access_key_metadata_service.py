# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.db import ManagerAccessKeyMetadata, S3Account, S3User, StorageEndpoint, StorageProvider
from app.models.access_key_metadata import AccessKeyMetadataInput
from app.models.iam import AccessKey
from app.models.s3_user import S3UserGeneratedKey
from app.services import access_key_metadata_service
from app.services.access_key_metadata_service import AccessKeyMetadataService
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.time import utcnow


def _set_global_feature(monkeypatch, enabled: bool) -> None:
    settings = SimpleNamespace(
        general=SimpleNamespace(
            manager_access_key_metadata_enabled=enabled,
            manager_access_key_expiration_enabled=False,
        )
    )
    monkeypatch.setattr(
        access_key_metadata_service,
        "load_app_settings_for_db_readonly",
        lambda _db: settings,
    )


def _storage_endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="metadata-endpoint",
        endpoint_url="https://metadata.example.test",
        provider=StorageProvider.CEPH.value,
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


def _account(db_session, endpoint: StorageEndpoint, *, enabled: bool) -> S3Account:
    account = S3Account(
        name="metadata-account",
        rgw_account_id="80000000000000001",
        rgw_user_uid="80000000000000001-admin",
        storage_endpoint_id=endpoint.id,
        allow_access_key_metadata=enabled,
    )
    db_session.add(account)
    db_session.flush()
    return account


def _s3_user(db_session, endpoint: StorageEndpoint, *, enabled: bool) -> S3User:
    user = S3User(
        name="metadata-user",
        rgw_user_uid="metadata-user",
        rgw_access_key="AK-ROOT",
        rgw_secret_key="SK-ROOT",
        storage_endpoint_id=endpoint.id,
        allow_access_key_metadata=enabled,
    )
    db_session.add(user)
    db_session.flush()
    return user


def test_access_key_metadata_requires_global_and_resource_opt_in(db_session, monkeypatch):
    endpoint = _storage_endpoint(db_session)
    account = _account(db_session, endpoint, enabled=False)
    s3_user = _s3_user(db_session, endpoint, enabled=False)
    db_session.commit()

    service = AccessKeyMetadataService(db_session)
    account_context = S3ExecutionContext.from_account(account)
    user_context = S3ExecutionContext.from_s3_user(s3_user)

    _set_global_feature(monkeypatch, False)
    account.allow_access_key_metadata = True
    s3_user.allow_access_key_metadata = True
    db_session.commit()
    assert service.enabled_for_context(account_context) is False
    assert service.enabled_for_context(user_context) is False

    _set_global_feature(monkeypatch, True)
    account.allow_access_key_metadata = False
    s3_user.allow_access_key_metadata = False
    db_session.commit()
    assert service.enabled_for_context(account_context) is False
    assert service.enabled_for_context(user_context) is False

    account.allow_access_key_metadata = True
    s3_user.allow_access_key_metadata = True
    db_session.commit()
    assert service.enabled_for_context(account_context) is True
    assert service.enabled_for_context(user_context) is True


def test_iam_metadata_round_trip_clear_and_principal_cleanup(db_session):
    endpoint = _storage_endpoint(db_session)
    account = _account(db_session, endpoint, enabled=True)
    db_session.commit()

    service = AccessKeyMetadataService(db_session)
    saved = service.set_iam_metadata(
        account.id,
        "alice",
        "AK-1",
        AccessKeyMetadataInput(name=" backup-service ", notes=" Nightly backup "),
    )

    assert saved is not None
    assert saved.name == "backup-service"
    assert saved.notes == "Nightly backup"

    key = AccessKey(access_key_id="AK-1", status="Active")
    service.apply_metadata([key], service.iam_metadata(account.id, "alice"))
    assert key.name == "backup-service"
    assert key.notes == "Nightly backup"

    service.set_iam_metadata(
        account.id,
        "alice",
        "AK-2",
        AccessKeyMetadataInput(name="video-uploader"),
    )
    assert db_session.query(ManagerAccessKeyMetadata).count() == 2

    service.set_iam_metadata(
        account.id,
        "alice",
        "AK-1",
        AccessKeyMetadataInput(name="   ", notes="\n"),
    )
    assert set(service.iam_metadata(account.id, "alice")) == {"AK-2"}

    service.delete_iam_principal_metadata(account.id, "alice")
    assert service.iam_metadata(account.id, "alice") == {}


def test_apply_metadata_supports_generated_s3_user_key():
    expires_at = utcnow() + timedelta(hours=1)
    key = S3UserGeneratedKey(access_key_id="AK-GENERATED", secret_access_key="SK-GENERATED")
    row = SimpleNamespace(
        name="worker",
        notes="Generated key",
        expires_at=expires_at,
        expiration_state="scheduled",
        expiration_enforced_at=None,
        expiration_last_attempt_at=None,
        expiration_last_error=None,
    )

    AccessKeyMetadataService.apply_metadata([key], {key.access_key_id: row})

    assert key.name == "worker"
    assert key.notes == "Generated key"
    assert key.expires_at == expires_at
    assert key.expiration_state == "scheduled"


def test_s3_user_metadata_round_trip_and_delete(db_session):
    endpoint = _storage_endpoint(db_session)
    s3_user = _s3_user(db_session, endpoint, enabled=True)
    db_session.commit()

    service = AccessKeyMetadataService(db_session)
    saved = service.set_s3_user_metadata(
        s3_user.id,
        "AK-SECONDARY",
        AccessKeyMetadataInput(name="sync-agent", notes="External replication client"),
    )

    assert saved is not None
    assert saved.name == "sync-agent"
    assert service.s3_user_metadata(s3_user.id)["AK-SECONDARY"].notes == "External replication client"

    service.delete_s3_user_metadata(s3_user.id, "AK-SECONDARY")
    assert service.s3_user_metadata(s3_user.id) == {}


def test_expiration_update_preserves_existing_name_and_notes(db_session):
    endpoint = _storage_endpoint(db_session)
    account = _account(db_session, endpoint, enabled=True)
    db_session.commit()
    service = AccessKeyMetadataService(db_session)
    service.set_iam_metadata(
        account.id,
        "alice",
        "AK-1",
        AccessKeyMetadataInput(name="backup", notes="nightly"),
    )
    expires_at = utcnow() + timedelta(hours=2)

    saved = service.set_iam_metadata(
        account.id,
        "alice",
        "AK-1",
        AccessKeyMetadataInput(expires_at=expires_at),
    )

    assert saved is not None
    assert saved.name == "backup"
    assert saved.notes == "nightly"
    assert saved.expires_at == expires_at
    assert saved.expiration_state == "scheduled"

    cleared = service.set_iam_metadata(
        account.id,
        "alice",
        "AK-1",
        AccessKeyMetadataInput(expires_at=None),
    )
    assert cleared is not None
    assert cleared.name == "backup"
    assert cleared.notes == "nightly"
    assert cleared.expires_at is None
    assert cleared.expiration_state is None


def test_expiration_requires_global_resource_and_scheduler_opt_in(db_session, monkeypatch):
    endpoint = _storage_endpoint(db_session)
    account = _account(db_session, endpoint, enabled=True)
    account.allow_access_key_expiration = True
    s3_user = _s3_user(db_session, endpoint, enabled=True)
    s3_user.allow_access_key_expiration = True
    s3_user.allow_access_key_management = True
    db_session.commit()
    service = AccessKeyMetadataService(db_session)
    account_context = S3ExecutionContext.from_account(account)
    user_context = S3ExecutionContext.from_s3_user(s3_user)

    monkeypatch.setattr(
        access_key_metadata_service,
        "get_settings",
        lambda: SimpleNamespace(scheduled_jobs_enabled=True),
    )
    monkeypatch.setattr(
        access_key_metadata_service,
        "load_app_settings_for_db_readonly",
        lambda _db: SimpleNamespace(
            general=SimpleNamespace(
                manager_access_key_metadata_enabled=True,
                manager_access_key_expiration_enabled=True,
            )
        ),
    )
    assert service.expiration_enabled_for_context(account_context) is True
    assert service.expiration_enabled_for_context(user_context) is True

    s3_user.allow_access_key_management = False
    db_session.commit()
    assert service.expiration_enabled_for_context(user_context) is False

    account.allow_access_key_expiration = False
    db_session.commit()
    assert service.expiration_enabled_for_context(account_context) is False

    account.allow_access_key_expiration = True
    db_session.commit()
    monkeypatch.setattr(
        access_key_metadata_service,
        "get_settings",
        lambda: SimpleNamespace(scheduled_jobs_enabled=False),
    )
    assert service.expiration_enabled_for_context(account_context) is False


def test_expiration_rejects_naive_datetime():
    with pytest.raises(ValidationError, match="timezone"):
        AccessKeyMetadataInput(expires_at=datetime(2026, 10, 7, 21, 0))
