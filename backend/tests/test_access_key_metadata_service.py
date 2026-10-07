# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.db import ManagerAccessKeyMetadata, S3Account, S3User, StorageEndpoint, StorageProvider
from app.models.access_key_metadata import AccessKeyMetadataInput
from app.models.iam import AccessKey
from app.services import access_key_metadata_service
from app.services.access_key_metadata_service import AccessKeyMetadataService
from app.services.s3_execution_context import S3ExecutionContext


def _set_global_feature(monkeypatch, enabled: bool) -> None:
    settings = SimpleNamespace(
        general=SimpleNamespace(manager_access_key_metadata_enabled=enabled)
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
