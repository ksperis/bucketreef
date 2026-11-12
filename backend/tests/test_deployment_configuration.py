# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.db import AuditLog, S3Account, StorageEndpoint
from app.models.deployment_configuration import DeploymentManifest
from app.models.storage_endpoint import StorageEndpointCreate
from app.services.app_settings_service import (
    DeploymentFeatureLockedError,
    enable_onboarding_features,
    get_general_feature_locks,
    load_app_settings_for_db,
    save_app_settings_for_db,
)
from app.services.deployment_configuration_service import DeploymentConfigurationService
from app.services.deployment_configuration_state import get_deployment_configuration
from app.services.storage_endpoints_service import StorageEndpointsService


def manifest(revision, **changes):
    return DeploymentManifest(schema_version=1, revision=revision, **changes)


def endpoint(key="main", url="https://s3.example.test", **fields):
    return {"key": key, "name": key, "endpoint_url": url, "provider": "other", **fields}


def test_apply_update_and_explicitly_release_shared_configuration(db_session):
    configuration = DeploymentConfigurationService(db_session)
    service = StorageEndpointsService(db_session)
    initial = service.create_endpoint(StorageEndpointCreate(
        name="Original", endpoint_url="https://s3.example.test", provider="other",
    ))
    account = S3Account(name="Account", rgw_account_id="RGW80000000000000001", rgw_user_uid="test-account", storage_endpoint_id=initial.id)
    db_session.add(account)
    db_session.commit()

    first = manifest(1, storage_endpoints=[endpoint()], features={"portal_enabled": True, "manager_enabled": False})
    assert configuration.apply(first).changed
    assert not configuration.apply(first).changed
    with pytest.raises(ValueError, match="stale"):
        configuration.apply(manifest(1, features={"portal_enabled": False}))

    other_session = sessionmaker(bind=db_session.get_bind())
    with other_session() as peer:
        assert StorageEndpointsService(peer).deployment_manages_endpoints()
        assert get_general_feature_locks(peer).portal_enabled.value is True
        assert load_app_settings_for_db(peer).general.portal_enabled is True
        settings = load_app_settings_for_db(peer)
        settings.general.portal_enabled = False
        with pytest.raises(DeploymentFeatureLockedError, match="portal_enabled"):
            save_app_settings_for_db(peer, settings)
        with pytest.raises(DeploymentFeatureLockedError, match="manager_enabled"):
            enable_onboarding_features(peer, ("manager_enabled",))
        with pytest.raises(ValueError, match="managed by the deployment"):
            StorageEndpointsService(peer).delete_endpoint(initial.id)

    configuration.apply(manifest(2, storage_endpoints=[endpoint(url="https://new.example.test")]))
    db_session.expire_all()
    assert db_session.get(StorageEndpoint, initial.id).endpoint_url == "https://new.example.test"
    assert account.storage_endpoint_id == initial.id
    configuration.apply(manifest(3, storage_endpoints=None, features={"portal_enabled": None}))
    assert not service.deployment_manages_endpoints()
    assert db_session.get(StorageEndpoint, initial.id).is_editable
    assert not get_general_feature_locks(db_session).portal_enabled.forced
    assert get_general_feature_locks(db_session).manager_enabled.forced
    assert load_app_settings_for_db(db_session).general.portal_enabled
    assert len(db_session.scalars(select(AuditLog).where(AuditLog.action == "deployment_configuration.apply")).all()) == 3


def test_omission_and_invalid_inventory_leave_entire_previous_revision_intact(db_session):
    service = DeploymentConfigurationService(db_session)
    service.apply(manifest(1, storage_endpoints=[endpoint()], features={"portal_enabled": True}))
    for definitions in (
        [],
        [endpoint("other", "https://elsewhere.example.test")],
        [endpoint(), endpoint("duplicate")],
    ):
        with pytest.raises(ValueError):
            service.apply(manifest(2, storage_endpoints=definitions, features={"portal_enabled": False}))
        assert get_deployment_configuration(db_session).revision == 1
        assert load_app_settings_for_db(db_session).general.portal_enabled
        assert len(db_session.scalars(select(StorageEndpoint)).all()) == 1


@pytest.mark.parametrize("definition", [
    {"unknown": True},
    {"endpoint_url": "invalid"},
    {"admin_secret_key": "do-not-accept"},
    {"latitude": 91},
    {"provider": "ceph"},
    {"credentials": {"runtime": {"access_key_file": "/var/run/a", "secret_key_file": "relative"}}},
])
def test_manifest_rejects_invalid_endpoints(definition):
    with pytest.raises(ValidationError):
        manifest(1, storage_endpoints=[endpoint(**definition)])


def test_simultaneous_retries_publish_one_revision(db_session):
    session_factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    barrier = Barrier(2)
    first = manifest(1, storage_endpoints=[endpoint()])

    def apply():
        with session_factory() as session:
            barrier.wait(timeout=10)
            try:
                return DeploymentConfigurationService(session).apply(first).changed
            except ValueError as exc:
                assert "operation is running" in str(exc)
                return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sum(executor.map(lambda _: apply(), range(2))) == 1
    assert get_deployment_configuration(db_session).revision == 1
    assert len(db_session.scalars(select(StorageEndpoint)).all()) == 1


def test_pending_identity_reconciliation_retries_without_rereading_credentials(db_session, monkeypatch, tmp_path):
    access_file = tmp_path / "ceph-access"
    secret_file = tmp_path / "ceph-secret"
    access_file.write_text("ceph-access")
    secret_file.write_text("ceph-secret")
    value = manifest(1, storage_endpoints=[endpoint(
        provider="ceph", service_identity_mode="external", ceph_admin_allowed=True,
        credentials={"ceph_admin": {"access_key_file": access_file, "secret_key_file": secret_file}},
    )])
    service = DeploymentConfigurationService(db_session)

    def fail(*args, **kwargs):
        raise RuntimeError("RGW unavailable")

    monkeypatch.setattr(service.identities, "reconcile", fail)
    first = service.apply(value)
    assert first.changed and first.pending_endpoints == ("main",)
    access_file.unlink()
    secret_file.unlink()

    def finish(ep, **kwargs):
        identity = ep.service_identity("ceph_admin")
        assert identity.secret_key == "ceph-secret"
        identity.status = "ready"
        identity.rgw_uid = "ceph-admin"
        db_session.commit()

    monkeypatch.setattr(service.identities, "reconcile", finish)
    second = service.apply(value)
    assert not second.changed and not second.pending_endpoints


def test_json_manifest_rejects_ambiguous_duplicate_keys():
    with pytest.raises(ValueError, match="Duplicate keys"):
        DeploymentManifest.from_json(
            '{"schema_version":1,"revision":1,"storage_endpoints":[],"storage_endpoints":null}'
        )


def test_managed_identity_must_exist_on_new_rgw_target_before_publishing(
    db_session, monkeypatch, tmp_path,
):
    from app.db import EndpointServiceIdentity

    access_file = tmp_path / "admin-access"
    secret_file = tmp_path / "admin-secret"
    access_file.write_text("admin-access")
    secret_file.write_text("first-admin-secret")
    credentials = {"admin": {"access_key_file": access_file, "secret_key_file": secret_file}}

    def ceph(url):
        return endpoint(
            url=url, provider="ceph", service_identity_mode="managed",
            credentials=credentials, features={"admin": {"enabled": True}},
        )

    service = DeploymentConfigurationService(db_session)
    monkeypatch.setattr(service.identities, "reconcile", lambda *_args, **_kwargs: None)
    service.apply(manifest(1, storage_endpoints=[ceph("https://old.example.test")]))
    current = db_session.scalars(select(StorageEndpoint)).one()
    endpoint_id = current.id
    current_identity = current.service_identity("runtime")
    assert isinstance(current_identity, EndpointServiceIdentity)
    provenance = f"{service.identities.installation_id()}:{current.identity_namespace}"
    current_identity.status = "ready"
    current_identity.rgw_uid = "bucketreef-runtime"
    current_identity.access_key = "managed-access"
    current_identity.secret_key = "managed-secret"
    current_identity.provenance = provenance
    db_session.commit()

    class Target:
        payload = None

        def get_user(self, uid, *, allow_not_found):
            assert not db_session.in_transaction()
            assert uid == "bucketreef-runtime"
            return self.payload

    target = Target()
    monkeypatch.setattr(
        "app.services.deployment_configuration_service.get_rgw_admin_client",
        lambda **_kwargs: target,
    )
    secret_file.write_text("second-admin-secret")
    updated = manifest(2, storage_endpoints=[ceph("https://new.example.test")])
    with pytest.raises(ValueError, match="does not have the existing managed identity"):
        service.apply(updated)
    assert get_deployment_configuration(db_session).revision == 1
    assert db_session.get(StorageEndpoint, endpoint_id).endpoint_url == "https://old.example.test"

    target.payload = {"keys": [{"access_key": "managed-access"}]}
    assert service.apply(updated).changed
    current = db_session.get(StorageEndpoint, endpoint_id)
    assert current.endpoint_url == "https://new.example.test"
    assert current.admin_secret_key == "second-admin-secret"
    assert current.service_identity("runtime").access_key == "managed-access"
    raw = db_session.connection().exec_driver_sql(
        "SELECT admin_secret_key FROM storage_endpoints WHERE id = ?", (endpoint_id,)
    ).scalar_one()
    assert raw and "second-admin-secret" not in raw
