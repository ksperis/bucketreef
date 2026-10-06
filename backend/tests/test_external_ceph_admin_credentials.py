# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from copy import deepcopy
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.db import AuditLog, KeyRotationIntent, User, UserRole
from app.models.app_settings import AppSettings
from app.models.storage_endpoint import StorageEndpointFeatureDetectionRequest, StorageEndpointUpdate
from app.models.key_rotation import KeyRotationRequest
from app.services.key_rotation_service import KeyRotationService
from app.services.mappers.storage_endpoint import ceph_admin_identity_active
from app.services.rgw_admin import RGWAdminError
from app.services.storage_endpoints_service import StorageEndpointsService
from tests.service_identity_helpers import service_identity
from tests.test_endpoint_service_identities import identities  # noqa: F401


def configure(db, endpoint, rgw, *, admin=True, system=False):
    rgw.users["manual-admin"] = {"user_id": "manual-admin", "admin": admin, "system": system,
        "caps": "", "keys": [{"access_key": "CEPH-AK", "secret_key": "CEPH-SK"}]}
    endpoint.service_identities.append(service_identity("ceph_admin", "CEPH-AK", "CEPH-SK", status="missing"))
    endpoint.ceph_admin_allowed = True
    db.commit()


def test_manual_validation_is_independent_of_admin_ops_and_global_flag(identities, db_session):
    service, endpoint, rgw = identities
    configure(db_session, endpoint, rgw)
    endpoint.admin_access_key = endpoint.admin_secret_key = None
    db_session.commit()
    original = deepcopy(rgw.users)
    service.reconcile(endpoint)
    identity = endpoint.service_identity("ceph_admin")
    assert identity.mode == "external" and identity.status == "ready" and identity.rgw_uid == "manual-admin"
    assert rgw.users == original and not rgw.calls
    assert not ceph_admin_identity_active(endpoint, ceph_admin_enabled=False)
    assert ceph_admin_identity_active(endpoint, ceph_admin_enabled=True)
    endpoint.ceph_admin_allowed = False
    assert not ceph_admin_identity_active(endpoint, ceph_admin_enabled=True)
    assert service.revoke(endpoint, "ceph_admin")
    assert identity.secret_key == "CEPH-SK" and not rgw.calls
    ciphertext = db_session.execute(text("SELECT secret_key FROM endpoint_service_identities WHERE kind='ceph_admin'")).scalar_one()
    assert "CEPH-SK" not in ciphertext
    response = StorageEndpointsService(db_session).get_endpoint(endpoint.id).model_dump_json()
    assert "CEPH-SK" not in response and "CEPH-AK" not in response
    audits = db_session.query(AuditLog).all()
    assert all("CEPH-SK" not in str(row.metadata_json) for row in audits)


@pytest.mark.parametrize("admin,system", [(False, False), (True, True)])
def test_invalid_flags_block_access_without_remote_mutation(identities, db_session, admin, system):
    service, endpoint, rgw = identities
    configure(db_session, endpoint, rgw, admin=admin, system=system)
    service.validate_ceph_admin(endpoint)
    identity = endpoint.service_identity("ceph_admin")
    assert identity.status == "error"
    assert identity.last_error == "Ceph Admin requires admin=true and system=false."
    assert not ceph_admin_identity_active(endpoint, ceph_admin_enabled=True) and not rgw.calls


@pytest.mark.parametrize("status,message", [(403, "denied"), (503, "connectivity")])
def test_signed_pair_failure_blocks_access_and_sanitizes_errors(identities, db_session, monkeypatch, status, message):
    service, endpoint, rgw = identities
    configure(db_session, endpoint, rgw)
    service.validate_ceph_admin(endpoint)
    identity = endpoint.service_identity("ceph_admin")
    if status == 403:
        identity.secret_key = "INCORRECT-SK"
    def rejected(**kwargs):
        assert kwargs["access_key"] == "CEPH-AK" and kwargs["secret_key"] == identity.secret_key
        raise RGWAdminError(f"do not expose {identity.secret_key}", status_code=status)
    monkeypatch.setattr("app.services.rgw_admin.get_rgw_admin_client", rejected)
    service.validate_ceph_admin(endpoint)
    assert identity.status == "error" and message in identity.last_error
    assert identity.secret_key not in identity.last_error and not rgw.calls


def test_manual_pair_replacement_and_empty_update_preservation(identities, db_session):
    service, endpoint, rgw = identities
    configure(db_session, endpoint, rgw)
    endpoints = StorageEndpointsService(db_session)
    with pytest.raises(ValueError, match="complete pair"):
        endpoints.update_endpoint(endpoint.id, StorageEndpointUpdate(ceph_admin_access_key="NEW-AK"))
    assert endpoint.service_identity("ceph_admin").access_key == "CEPH-AK"
    endpoints.update_endpoint(endpoint.id, StorageEndpointUpdate(ceph_admin_access_key="", ceph_admin_secret_key=""))
    assert endpoint.service_identity("ceph_admin").secret_key == "CEPH-SK"
    rgw.users["manual-admin"]["keys"].append({"access_key": "NEW-AK", "secret_key": "NEW-SK"})
    before = deepcopy(rgw.users)
    endpoints.update_endpoint(endpoint.id, StorageEndpointUpdate(ceph_admin_access_key="NEW-AK", ceph_admin_secret_key="NEW-SK"))
    identity = endpoint.service_identity("ceph_admin")
    assert identity.access_key == "NEW-AK" and identity.secret_key == "NEW-SK" and identity.status == "ready"
    assert rgw.users["manual-admin"] == before["manual-admin"]


def test_ceph_admin_rotation_uses_admin_ops_and_updates_external_pair(identities, db_session, monkeypatch):
    service, endpoint, rgw = identities
    configure(db_session, endpoint, rgw)
    endpoint.features_config = "features:\n  admin:\n    enabled: false\n"
    db_session.commit()
    service.validate_ceph_admin(endpoint)
    monkeypatch.setattr(
        "app.services.durable_key_rotation_service.get_rgw_admin_client",
        lambda **kwargs: rgw.signed(kwargs["access_key"]),
    )
    result = KeyRotationService(db_session).rotate_keys(
        KeyRotationRequest(endpoint_ids=[endpoint.id], key_types=["ceph_admin"])
    )
    identity = endpoint.service_identity("ceph_admin")
    assert result.summary.rotated == 1 and result.summary.skipped == 0
    assert identity.mode == "external" and identity.status == "ready"
    assert identity.access_key != "CEPH-AK"
    assert identity.secret_key != "CEPH-SK"
    assert "CEPH-AK" not in {key["access_key"] for key in rgw.users["manual-admin"]["keys"]}
    assert db_session.query(KeyRotationIntent).filter_by(
        endpoint_id=endpoint.id,
        key_type="ceph_admin",
        target_id=identity.id,
    ).first() is None
    with pytest.raises(ValueError, match="managed"):
        service.rotate(endpoint, "ceph_admin")


def test_startup_does_not_resume_ceph_admin_rotation(identities, db_session):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    configure(db_session, endpoint, rgw)
    service.validate_ceph_admin(endpoint)
    identity = endpoint.service_identity("ceph_admin")
    db_session.add(KeyRotationIntent(
        endpoint_id=endpoint.id, key_type="ceph_admin", target_id=identity.id,
        rgw_uid=identity.rgw_uid, rgw_endpoint=endpoint.endpoint_url,
        old_access_key=identity.access_key, new_access_key="PENDING-AK", new_secret_key="PENDING-SK",
        deactivate_only=False, phase="prepared", actor_email="system"))
    db_session.commit()
    rgw.calls.clear()
    StorageEndpointsService(db_session).reconcile_persisted_identities()
    assert not rgw.calls
    assert db_session.query(KeyRotationIntent).one().phase == "prepared"


def test_env_can_validate_manual_ceph_admin_without_admin_ops(identities, db_session, monkeypatch):
    _, endpoint, rgw = identities
    configure(db_session, endpoint, rgw)
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.env_storage_endpoints", json.dumps([{
        "name": endpoint.name, "endpoint_url": endpoint.endpoint_url, "provider": "ceph",
        "service_identity_mode": "managed", "ceph_admin_allowed": True,
        "ceph_admin_access_key": "CEPH-AK", "ceph_admin_secret_key": "CEPH-SK",
    }]))
    StorageEndpointsService(db_session).sync_env_endpoints()
    identity = endpoint.service_identity("ceph_admin")
    assert identity.mode == "external" and identity.status == "ready"
    assert identity.access_key == "CEPH-AK" and identity.secret_key == "CEPH-SK"
    assert not endpoint.admin_access_key and not endpoint.is_editable and not rgw.calls


def test_feature_detection_requires_complete_replacement_pair(identities, db_session, monkeypatch):
    _, endpoint, rgw = identities
    configure(db_session, endpoint, rgw)
    monkeypatch.setattr("app.services.storage_endpoints_service.get_rgw_admin_client", lambda **kwargs: rgw.signed(kwargs["access_key"]))
    result = StorageEndpointsService(db_session).detect_features(StorageEndpointFeatureDetectionRequest(
        endpoint_id=endpoint.id, endpoint_url=endpoint.endpoint_url, ceph_admin_access_key="CEPH-AK"))
    assert result.credential_checks.ceph_admin.status == "incomplete"
    result = StorageEndpointsService(db_session).detect_features(StorageEndpointFeatureDetectionRequest(
        endpoint_id=endpoint.id, endpoint_url=endpoint.endpoint_url))
    assert result.credential_checks.ceph_admin.status == "valid"
    assert not rgw.calls or all(call[0] in ("list", "usage") for call in rgw.calls)


@pytest.mark.parametrize("blocked", [None, "global", "allowed", "validation", "incomplete", "system"])
def test_browser_ceph_admin_requires_active_external_identity(identities, db_session, monkeypatch, blocked):
    from app.routers.dependencies_internal.ceph_admin_context import _resolve_ceph_admin_browser_context

    service, endpoint, rgw = identities
    configure(db_session, endpoint, rgw)
    service.validate_ceph_admin(endpoint)
    monkeypatch.setattr("app.routers.ceph_admin.dependencies.get_rgw_admin_client", lambda **kwargs: rgw.signed(kwargs["access_key"]))
    actor = User(email="ceph-browser@example.test", hashed_password="x", is_active=True,
                 role=UserRole.UI_SUPERADMIN.value, can_access_ceph_admin=True)
    db_session.add(actor)
    settings = AppSettings()
    settings.general.ceph_admin_enabled = blocked != "global"
    settings.general.browser_ceph_admin_enabled = True
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings", lambda: settings)
    if blocked == "allowed":
        endpoint.ceph_admin_allowed = False
    if blocked == "validation":
        endpoint.service_identity("ceph_admin").status = "error"
    if blocked == "incomplete":
        endpoint.service_identity("ceph_admin").secret_key = None
    if blocked == "system":
        rgw.users["manual-admin"]["system"] = True
    db_session.commit()
    if blocked:
        with pytest.raises(HTTPException) as error:
            _resolve_ceph_admin_browser_context(db_session, actor, endpoint.id, surface="browser")
        assert error.value.status_code == 403
    else:
        context = _resolve_ceph_admin_browser_context(db_session, actor, endpoint.id, surface="browser")
        assert context.access_key == "CEPH-AK" and context.secret_key == "CEPH-SK"
    assert not rgw.calls
