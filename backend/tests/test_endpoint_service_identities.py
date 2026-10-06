# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from copy import deepcopy

import pytest
from sqlalchemy import text

from app.db import AuditLog, EndpointServiceIdentity, KeyRotationIntent, StorageEndpoint
from app.services import endpoint_service_identities as module
from app.services.endpoint_service_identities import EndpointServiceIdentityService, SERVICE_CAPS
from app.services.operation_lease_service import OperationLeaseService
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client
from app.services.storage_endpoints_service import StorageEndpointsService
from tests.service_identity_helpers import service_identity, set_service_identity_credentials


class FakeRGW:
    def __init__(self):
        self.users = {"operator": {"user_id": "operator", "caps": "users=read,write;accounts=read", "keys": [{"access_key": "ADMIN", "secret_key": "ADMIN-SECRET"}]}}
        self.calls = []
        self.fail_delete = False
        self.fail_create = False
        self.leak_keys = False
        self.usage_payload = {"entries": [], "summary": []}

    def get_user_by_access_key(self, access_key, **kwargs):
        return next((deepcopy(user) for user in self.users.values() if any(key["access_key"] == access_key for key in user["keys"])), None)

    def get_user(self, uid, **kwargs):
        return deepcopy(self.users.get(uid))

    def create_user(self, uid, **kwargs):
        self.calls.append(("create", uid, kwargs))
        if self.fail_create:
            raise RGWAdminError("request failed")
        params = kwargs["extra_params"]
        self.users[uid] = {"user_id": uid, "caps": "", "keys": [{"access_key": params["access-key"], "secret_key": params["secret-key"]}]}
        return deepcopy(self.users[uid])

    def set_user_caps(self, uid, caps):
        self.calls.append(("caps", uid, caps))
        self.users[uid]["caps"] = caps

    def update_user(self, uid, **kwargs):
        self.users[uid].update(kwargs)

    def delete_user(self, uid, **kwargs):
        assert not kwargs.get("purge_data")
        self.calls.append(("delete", uid))
        if self.fail_delete:
            raise RGWAdminError("request failed")
        self.users.pop(uid, None)

    def create_access_key(self, uid, *, access_key, secret_key):
        self.calls.append(("key_create", uid))
        self.users[uid]["keys"].append({"access_key": access_key, "secret_key": secret_key})
        return deepcopy(self.users[uid])

    @staticmethod
    def extract_keys(payload):
        return payload["keys"]

    def delete_access_key(self, uid, access):
        self.calls.append(("key_delete", uid, access))
        if self.fail_delete:
            raise RGWAdminError("request failed")
        self.users[uid]["keys"] = [key for key in self.users[uid]["keys"] if key["access_key"] != access]

    def signed(self, access):
        rgw = self
        class Signed:
            def get_user_by_access_key(self, key, **kwargs):
                payload = rgw.get_user_by_access_key(key)
                if payload and "user-info-without-keys" in payload["caps"] and not rgw.leak_keys:
                    payload.pop("keys")
                return payload
            def get_account(self, account_id, **kwargs):
                self.account_api_supported = True
                return None
            def get_all_buckets(self, **kwargs):
                rgw.calls.append(("list", access, kwargs))
                return []
            def get_usage(self, **kwargs):
                rgw.calls.append(("usage", access, kwargs))
                return deepcopy(rgw.usage_payload)
        return Signed()


@pytest.fixture
def identities(db_session, monkeypatch):
    rgw = FakeRGW()
    monkeypatch.setattr(module, "get_endpoint_bootstrap_rgw_client", lambda endpoint: rgw)
    monkeypatch.setattr("app.services.rgw_admin.get_rgw_admin_client", lambda **kwargs: rgw.signed(kwargs["access_key"]))
    monkeypatch.setattr("app.services.storage_endpoints_service.get_rgw_admin_client", lambda **kwargs: rgw)
    endpoint = StorageEndpoint(name="Ceph", endpoint_url="https://rgw.example.test", provider="ceph", admin_access_key="ADMIN", admin_secret_key="ADMIN-SECRET", features_config="features:\n  admin:\n    enabled: true\n")
    db_session.add(endpoint); db_session.commit()
    return EndpointServiceIdentityService(db_session), endpoint, rgw


def test_managed_runtime_is_idempotent_encrypted_and_scoped(identities, db_session):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    assert identity.status == "ready" and identity.mode == "managed"
    assert rgw.users[identity.rgw_uid]["caps"] == SERVICE_CAPS["runtime"]
    assert ("list", identity.access_key, {"uid": identity.rgw_uid, "with_stats": True}) in rgw.calls
    stored = db_session.execute(text("SELECT secret_key FROM endpoint_service_identities WHERE kind = 'runtime'")).scalar_one()
    assert identity.secret_key not in stored
    response = StorageEndpointsService(db_session).get_endpoint(endpoint.id, include_admin_ops_permissions=False).model_dump_json()
    assert identity.secret_key not in response and "secret_key" not in response
    first_key = identity.access_key
    service.reconcile(endpoint)
    assert identity.access_key == first_key
    assert len([call for call in rgw.calls if call[0] == "create"]) == 2
    supervision = endpoint.service_identity("supervision")
    assert supervision.status == "ready"
    assert rgw.users[supervision.rgw_uid]["caps"] == SERVICE_CAPS["supervision"]


def test_partial_remote_failure_resumes_persisted_key(identities):
    service, endpoint, rgw = identities
    rgw.fail_create = True
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    assert identity.status == "error"
    access = identity.access_key
    rgw.fail_create = False
    service.reconcile(endpoint)
    assert identity.status == "ready" and identity.access_key == access


def test_admin_failure_preserves_ready_runtime_and_supervision(identities, db_session):
    service, endpoint, rgw = identities
    endpoint.features_config = "features:\n  metrics:\n    enabled: true\n"
    db_session.commit()
    service.reconcile(endpoint)
    runtime = endpoint.service_identity("runtime")
    supervision = endpoint.service_identity("supervision")
    assert runtime.status == "ready"
    assert supervision.status == "ready"

    rgw.users.pop("operator")
    result = service.reconcile(endpoint)

    assert result == [{"kind": "admin", "status": "error"}]
    assert runtime.status == "ready" and runtime.last_error is None
    assert supervision.status == "ready" and supervision.last_error is None
    assert get_endpoint_runtime_rgw_client(endpoint) is not None


def test_admin_failure_marks_unfinished_identity_error(identities):
    service, endpoint, rgw = identities
    rgw.fail_create = True
    service.reconcile(endpoint)
    runtime = endpoint.service_identity("runtime")
    assert runtime.status == "error"

    rgw.users.pop("operator")
    service.reconcile(endpoint)

    assert runtime.status == "error"
    assert runtime.last_error == "Admin Ops validation failed; check its required read permissions and RGW connectivity."


def test_uid_collision_never_adopts_or_mutates_foreign_user(identities):
    service, endpoint, rgw = identities
    rgw.fail_create = True
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    foreign = {"user_id": identity.rgw_uid, "keys": [{"access_key": "FOREIGN"}], "caps": "users=*"}
    rgw.users[identity.rgw_uid] = deepcopy(foreign)
    rgw.fail_create = False
    before = len(rgw.calls)
    service.reconcile(endpoint)
    assert identity.status == "error" and rgw.users[identity.rgw_uid] == foreign
    assert not any(call[1] == identity.rgw_uid for call in rgw.calls[before:])
    assert endpoint.service_identity("supervision").status == "ready"
    assert not service.revoke(endpoint, "runtime")
    assert rgw.users[identity.rgw_uid] == foreign


def test_minimal_admin_and_external_identities_preserve_usage_without_write_caps(identities, db_session):
    service, endpoint, rgw = identities
    rgw.users["operator"]["caps"] = "users=read;accounts=read"
    endpoint.service_identities.append(
        service_identity("runtime", "EXTERNAL", "EXTERNAL-SECRET")
    )
    rgw.users["external"] = {"user_id": "external", "caps": SERVICE_CAPS["runtime"], "keys": [{"access_key": "EXTERNAL", "secret_key": "EXTERNAL-SECRET"}]}
    endpoint.service_identities.append(service_identity("supervision", "SUPERVISION", "SUPERVISION-SECRET"))
    rgw.users["supervision"] = {"user_id": "supervision", "caps": SERVICE_CAPS["supervision"], "keys": [{"access_key": "SUPERVISION", "secret_key": "SUPERVISION-SECRET"}]}
    endpoint.features_config = "features:\n  usage:\n    enabled: true\n"
    db_session.commit()
    service.reconcile(endpoint)
    assert endpoint.service_identity("runtime").status == "ready"
    assert endpoint.service_identity("supervision").status == "ready"
    assert json.loads(StorageEndpointsService(db_session).get_endpoint(endpoint.id, include_admin_ops_permissions=False).model_dump_json())["features"]["usage"]["enabled"]
    assert not any(call[0] in ("create", "caps", "delete") for call in rgw.calls)
    assert service.revoke(endpoint, "runtime")
    assert "external" in rgw.users


def test_runtime_response_containing_keys_fails_closed(identities):
    service, endpoint, rgw = identities
    rgw.leak_keys = True
    service.reconcile(endpoint)
    assert endpoint.service_identity("runtime").status == "error"
    with pytest.raises(ValueError, match="not ready"):
        get_endpoint_runtime_rgw_client(endpoint)


@pytest.mark.parametrize("caps", ["users=read;buckets=read;accounts=read", SERVICE_CAPS["runtime"] + ";buckets=write", SERVICE_CAPS["runtime"] + ";usage=read"])
def test_runtime_excessive_permissions_are_rejected(caps):
    with pytest.raises(ValueError):
        EndpointServiceIdentityService.validate_payload("runtime", {"user_id": "runtime", "caps": caps})


def test_lease_prevents_parallel_reconciliation(identities, db_session):
    service, endpoint, rgw = identities
    leases = OperationLeaseService(db_session)
    handle = leases.acquire(f"endpoint-identities:{endpoint.id}", ttl_seconds=1800)
    with pytest.raises(ValueError, match="already running"):
        service.reconcile(endpoint)
    assert not rgw.calls
    leases.release(handle)


def test_rotation_persists_validated_new_key_before_retirement_and_retries(identities, db_session):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    previous = identity.access_key
    rgw.fail_delete = True
    with pytest.raises((ValueError, RGWAdminError), match="retirement|request failed"):
        service.rotate(endpoint, "runtime")
    db_session.expire_all()
    assert identity.status == "ready" and identity.access_key != previous and service.db.query(KeyRotationIntent).one().old_access_key == previous
    rgw.fail_delete = False
    service.rotate(endpoint, "runtime")
    assert service.db.query(KeyRotationIntent).count() == 0
    assert len([call for call in rgw.calls if call[0] == "key_create"]) == 1
    assert rgw.users[identity.rgw_uid]["keys"] == [{"access_key": identity.access_key, "secret_key": identity.secret_key}]


def test_ceph_admin_creation_and_pending_revocation_preserve_allowed(identities, db_session):
    service, endpoint, rgw = identities
    endpoint.ceph_admin_allowed = True; db_session.commit()
    service.reconcile(endpoint, ceph_admin_enabled=True)
    identity = endpoint.service_identity("ceph_admin")
    assert identity.status == "ready" and rgw.users[identity.rgw_uid]["admin"] is True
    uid = identity.rgw_uid
    rgw.fail_delete = True
    service.reconcile(endpoint, ceph_admin_enabled=False)
    assert identity.status == "revocation_pending" and endpoint.ceph_admin_allowed
    rgw.fail_delete = False
    service.reconcile(endpoint, ceph_admin_enabled=False)
    assert identity.status == "disabled" and identity.secret_key is None and uid not in rgw.users


def test_explicit_conversion_preserves_external_user(identities, db_session):
    from app.models.storage_endpoint import StorageEndpointUpdate
    service, endpoint, rgw = identities
    endpoint.service_identities.append(
        service_identity("runtime", "FOREIGN", "FOREIGN-SECRET")
    )
    rgw.users["external"] = {"user_id": "external", "caps": SERVICE_CAPS["runtime"], "keys": [{"access_key": "FOREIGN", "secret_key": "FOREIGN-SECRET"}]}
    original = deepcopy(rgw.users["external"])
    db_session.commit()
    StorageEndpointsService(db_session).update_endpoint(
        endpoint.id,
        StorageEndpointUpdate(service_identity_mode="managed"),
    )
    assert endpoint.service_identity("runtime").mode == "managed"
    assert rgw.users["external"] == original


def test_read_only_admin_registration_and_external_mode(identities, db_session):
    from app.models.storage_endpoint import StorageEndpointCreate
    service, endpoint, rgw = identities
    rgw.users["operator"]["caps"] = "users=read;accounts=read"
    rgw.users["external"] = {"user_id": "external", "caps": SERVICE_CAPS["runtime"], "keys": [{"access_key": "EXTERNAL", "secret_key": "EXTERNAL-SECRET"}]}
    rgw.users["supervision"] = {"user_id": "supervision", "caps": SERVICE_CAPS["supervision"], "keys": [{"access_key": "SUPERVISION", "secret_key": "SUPERVISION-SECRET"}]}
    result = StorageEndpointsService(db_session).create_endpoint(StorageEndpointCreate(
        name="Read-only operator", endpoint_url="https://second.example.test", provider="ceph",
        admin_access_key="ADMIN", admin_secret_key="ADMIN-SECRET", service_identity_mode="external",
        runtime_access_key="EXTERNAL", runtime_secret_key="EXTERNAL-SECRET",
        supervision_access_key="SUPERVISION", supervision_secret_key="SUPERVISION-SECRET",
        features_config="features:\n  admin:\n    enabled: true\n",
    ))
    assert result.service_identities[0].status == "ready"
    assert not result.admin_ops_permissions.users_write and not result.admin_ops_permissions.accounts_write
    assert not any(call[0] in ("create", "caps", "delete") for call in rgw.calls)


def test_ceph_activation_selects_endpoints_and_optional_grant(identities, db_session):
    from app.db import User, UserRole
    from app.services.ceph_admin_activation_service import CephAdminActivationService
    from app.services.app_settings_service import load_app_settings_for_db_readonly
    _, endpoint, rgw = identities
    actor = User(email="operator@example.test", hashed_password="x", role=UserRole.UI_SUPERADMIN.value, can_access_ceph_admin=False)
    db_session.add(actor); db_session.commit()
    activation = CephAdminActivationService(db_session, actor)
    response = activation.apply(enabled=True, endpoint_ids=[endpoint.id])
    assert response["endpoints"][0]["active"] and actor.can_access_ceph_admin is False
    activation.apply(enabled=True, endpoint_ids=[endpoint.id], grant_current_user=True)
    assert actor.can_access_ceph_admin is True
    rgw.fail_delete = True
    response = activation.apply(enabled=False, endpoint_ids=[])
    assert not response["endpoints"][0]["active"] and response["endpoints"][0]["status"] == "revocation_pending"
    assert not load_app_settings_for_db_readonly(db_session).general.ceph_admin_enabled and endpoint.ceph_admin_allowed
    rgw.fail_delete = False
    assert activation.apply(enabled=False, endpoint_ids=[])["endpoints"][0]["status"] == "disabled"


def test_ceph_activation_denies_endpoint_without_users_write(identities, db_session):
    from app.services.ceph_admin_activation_service import CephAdminActivationService
    _, endpoint, rgw = identities
    rgw.users["operator"]["caps"] = "users=read;accounts=read"
    with pytest.raises(ValueError, match="users=write"):
        CephAdminActivationService(db_session, None).apply(enabled=True, endpoint_ids=[endpoint.id])
    assert not endpoint.ceph_admin_allowed and not rgw.calls


def test_revocation_requires_confirmed_remote_deletion(identities):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    rgw.delete_user = lambda uid: None
    assert not service.revoke(endpoint, "runtime")
    assert endpoint.service_identity("runtime").status == "revocation_pending"


def test_env_sync_preserves_generated_keys_mode_namespace_and_allowed(identities, db_session, monkeypatch):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    endpoint.ceph_admin_allowed = True
    db_session.commit()
    original = (identity.access_key, identity.secret_key, endpoint.identity_namespace)
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.env_storage_endpoints", json.dumps([{
        "name": endpoint.name, "endpoint_url": endpoint.endpoint_url, "provider": "ceph", "service_identity_mode": "managed",
        "admin_access_key": "ADMIN", "admin_secret_key": "ADMIN-SECRET", "features": {"admin": {"enabled": True}},
    }]))
    StorageEndpointsService(db_session).sync_env_endpoints()
    assert endpoint.ceph_admin_allowed and identity.mode == "managed"
    assert original == (identity.access_key, identity.secret_key, endpoint.identity_namespace)
    assert identity.status == "ready" and not endpoint.is_editable


def test_external_conversion_requires_replacement_before_revocation(identities, db_session):
    from app.models.storage_endpoint import StorageEndpointUpdate
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    old = endpoint.service_identity("runtime").access_key
    with pytest.raises(ValueError, match="replacement Runtime"):
        StorageEndpointsService(db_session).update_endpoint(endpoint.id, StorageEndpointUpdate(service_identity_mode="external"))
    assert endpoint.service_identity("runtime").access_key == old and not any(call[0] == "delete" for call in rgw.calls)


def test_rotation_requires_installation_provenance(identities, db_session):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    endpoint.service_identity("runtime").provenance = "foreign-installation"
    db_session.commit()
    with pytest.raises(ValueError, match="ownership proof"):
        service.rotate(endpoint, "runtime")
    assert not any(call[0] == "key_create" for call in rgw.calls)


def test_managed_ceph_admin_identity_can_rotate(identities, db_session):
    service, endpoint, rgw = identities
    endpoint.ceph_admin_allowed = True
    db_session.commit()
    service.reconcile(endpoint, ceph_admin_enabled=True)
    identity = endpoint.service_identity("ceph_admin")
    assert identity is not None and identity.status == "ready"
    old_access = identity.access_key

    old, new, retired = service.rotate(endpoint, "ceph_admin")

    assert old == old_access
    assert new == identity.access_key and new != old_access
    assert retired == "deleted"
    assert old_access not in {
        key["access_key"] for key in rgw.users[identity.rgw_uid]["keys"]
    }


@pytest.mark.parametrize("invalid_field", ["missing_uid", "temp_url_keys"])
def test_read_only_runtime_detection_never_lists_without_scope_or_accepts_keys(identities, db_session, invalid_field):
    from app.models.storage_endpoint import StorageEndpointFeatureDetectionRequest
    from app.services.storage_endpoint_feature_detection import StorageEndpointFeatureDetector
    _, _, rgw = identities
    user = {"user_id": "runtime", "caps": SERVICE_CAPS["runtime"], "keys": [{"access_key": "RUNTIME", "secret_key": "RUNTIME-SECRET"}]}
    if invalid_field == "missing_uid":
        user.pop("user_id")
    else:
        user["temp_url_keys"] = {"0": "must-not-be-returned"}
    rgw.users["runtime"] = user
    result = StorageEndpointFeatureDetector(db_session, lambda **kwargs: rgw.signed(kwargs["access_key"])).detect(
        StorageEndpointFeatureDetectionRequest(endpoint_url="https://rgw.example.test", runtime_access_key="RUNTIME", runtime_secret_key="RUNTIME-SECRET")
    )
    assert result.credential_checks.runtime.status == "denied"
    assert not any(call[0] == "list" for call in rgw.calls)
    assert db_session.query(EndpointServiceIdentity).count() == 0


def test_env_provider_change_revokes_owned_identities_before_clearing_admin_ops(identities, db_session, monkeypatch):
    service, endpoint, rgw = identities
    endpoint.ceph_admin_allowed = True
    db_session.commit()
    service.reconcile(endpoint, ceph_admin_enabled=True)
    managed_uids = {identity.rgw_uid for identity in endpoint.service_identities}
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.env_storage_endpoints", json.dumps([{
        "name": endpoint.name, "endpoint_url": endpoint.endpoint_url, "provider": "other",
    }]))
    StorageEndpointsService(db_session).sync_env_endpoints()
    assert not managed_uids.intersection(rgw.users)
    assert all(identity.status == "disabled" for identity in endpoint.service_identities)
    assert endpoint.admin_secret_key is None and endpoint.provider == "other"


@pytest.mark.parametrize("kind", ["runtime", "supervision", "ceph_admin"])
@pytest.mark.parametrize("key_type", ["keys", "disabled_keys", "swift_keys", "temp_url_keys"])
def test_managed_key_drift_blocks_reconciliation_without_mutating_remote_user(identities, db_session, kind, key_type):
    service, endpoint, rgw = identities
    endpoint.features_config = "features:\n  metrics:\n    enabled: true\n"
    endpoint.ceph_admin_allowed = True
    db_session.commit()
    service.reconcile(endpoint, ceph_admin_enabled=True)
    identity = endpoint.service_identity(kind)
    user = rgw.users[identity.rgw_uid]
    unknown = {"access_key": "UNEXPECTED-KEY", "secret_key": "UNEXPECTED-SECRET"}
    if key_type in ("keys", "disabled_keys"):
        if key_type == "disabled_keys":
            unknown["active"] = False
        user["keys"].append(unknown)
    elif key_type == "swift_keys":
        user["swift_keys"] = [{"user": "foreign", "secret_key": "UNEXPECTED-SECRET"}]
    else:
        user["temp_url_keys"] = {"0": "UNEXPECTED-SECRET"}
    original = deepcopy(user)
    rgw.calls.clear()

    results = service.reconcile(endpoint, ceph_admin_enabled=True)

    assert {"kind": kind, "status": "error"} in results
    assert identity.status == "error" and "key drift" in identity.last_error
    assert rgw.users[identity.rgw_uid] == original
    assert not any(call[0] in ("create", "caps", "delete", "key_create", "key_delete") and call[1] == identity.rgw_uid for call in rgw.calls)
    serialized = StorageEndpointsService(db_session).get_endpoint(endpoint.id, include_admin_ops_permissions=False).model_dump_json()
    audits = db_session.query(AuditLog).filter(AuditLog.action == "endpoint_service_identity.key_drift_detected").all()
    assert len(audits) == 1
    assert "UNEXPECTED" not in serialized + (audits[0].metadata_json or "")
    assert identity.secret_key not in serialized + (audits[0].metadata_json or "")


@pytest.mark.parametrize("users_write", [True, False])
def test_managed_key_drift_recovers_only_after_operator_removes_unknown_key(identities, db_session, users_write):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    if not users_write:
        rgw.users["operator"]["caps"] = "users=read;accounts=read"
    user = rgw.users[identity.rgw_uid]
    user["keys"].append({"access_key": "UNKNOWN", "secret_key": "UNKNOWN-SECRET"})
    service.reconcile(endpoint)
    assert identity.status == "error"
    with pytest.raises(ValueError, match="not ready"):
        get_endpoint_runtime_rgw_client(endpoint)
    service.reconcile(endpoint)
    assert identity.status == "error" and len(user["keys"]) == 2
    assert db_session.query(AuditLog).filter(AuditLog.action == "endpoint_service_identity.key_drift_detected").count() == 1

    user["keys"].pop()
    service.reconcile(endpoint)
    assert identity.status == "ready" and identity.last_error is None


@pytest.mark.parametrize("operation", ["rotate", "revoke"])
@pytest.mark.parametrize("kind", ["runtime", "supervision", "ceph_admin"])
def test_managed_key_drift_blocks_rotation_and_revocation(identities, db_session, operation, kind):
    service, endpoint, rgw = identities
    endpoint.features_config = "features:\n  metrics:\n    enabled: true\n"
    endpoint.ceph_admin_allowed = True
    db_session.commit()
    service.reconcile(endpoint, ceph_admin_enabled=True)
    identity = endpoint.service_identity(kind)
    user = rgw.users[identity.rgw_uid]
    user["keys"].append({"access_key": "UNKNOWN", "secret_key": "UNKNOWN-SECRET"})
    original = deepcopy(user)
    rgw.calls.clear()
    if operation == "rotate":
        with pytest.raises(ValueError, match="key drift"):
            service.rotate(endpoint, kind)
        assert identity.status == "error"
    else:
        assert not service.revoke(endpoint, kind)
        assert identity.status == "revocation_pending"
    assert "key drift" in identity.last_error
    assert rgw.users[identity.rgw_uid] == original and not rgw.calls
    if operation == "revoke":
        user["keys"].pop()
        assert service.revoke(endpoint, kind)
        assert identity.status == "disabled" and identity.rgw_uid not in rgw.users


def test_pending_rotation_keys_are_nominal_during_reconciliation(identities):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    rgw.fail_delete = True
    with pytest.raises((ValueError, RGWAdminError), match="retirement|request failed"):
        service.rotate(endpoint, "runtime")
    service.reconcile(endpoint)
    assert identity.status == "ready" and service.db.query(KeyRotationIntent).one().old_access_key
    rgw.fail_delete = False
    service.rotate(endpoint, "runtime")
    assert service.db.query(KeyRotationIntent).count() == 0
    assert len([call for call in rgw.calls if call[0] == "key_create"]) == 1


def test_rotation_requires_confirmed_key_retirement(identities):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    old = identity.access_key
    rgw.delete_access_key = lambda *_args: None
    with pytest.raises((ValueError, RGWAdminError), match="retirement|request failed"):
        service.rotate(endpoint, "runtime")
    assert identity.status == "ready" and service.db.query(KeyRotationIntent).one().old_access_key == old
    assert len(rgw.users[identity.rgw_uid]["keys"]) == 2


def test_managed_rotation_rejects_deactivation_without_creating_an_untracked_key(identities):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    old = identity.access_key
    rgw.calls.clear()
    with pytest.raises(ValueError, match="require deleting previous keys"):
        service.rotate(endpoint, "runtime", deactivate_only=True)
    assert identity.status == "ready" and identity.access_key == old and not rgw.calls


def test_external_users_may_have_other_keys_without_managed_drift_rules(identities, db_session):
    service, endpoint, rgw = identities
    endpoint.service_identities.append(service_identity("runtime", "EXTERNAL", "EXTERNAL-SECRET"))
    rgw.users["external"] = {
        "user_id": "external", "caps": SERVICE_CAPS["runtime"],
        "keys": [{"access_key": "EXTERNAL", "secret_key": "EXTERNAL-SECRET"}, {"access_key": "OTHER", "secret_key": "OTHER-SECRET"}],
    }
    original = deepcopy(rgw.users["external"])
    db_session.commit()
    service.reconcile(endpoint)
    assert endpoint.service_identity("runtime").status == "ready"
    assert rgw.users["external"] == original


def test_endpoint_creation_commits_before_provisioning_and_returns_retryable_failure(identities, db_session):
    from app.models.storage_endpoint import StorageEndpointCreate

    _, _, rgw = identities
    rgw.fail_create = True
    response = StorageEndpointsService(db_session).create_endpoint(StorageEndpointCreate(
        name="Partial registration", endpoint_url="https://partial.example.test", provider="ceph",
        admin_access_key="ADMIN", admin_secret_key="ADMIN-SECRET",
        features_config="features:\n  admin:\n    enabled: true\n",
    ))
    db_session.rollback()
    endpoint = db_session.get(StorageEndpoint, response.id)
    identity = endpoint.service_identity("runtime")
    assert identity.status == "error" and identity.access_key and identity.provenance
    key, uid = identity.access_key, identity.rgw_uid
    rgw.fail_create = False
    StorageEndpointsService(db_session).reconcile_identities(endpoint.id)
    assert identity.status == "ready" and (identity.access_key, identity.rgw_uid) == (key, uid)


def test_key_added_concurrently_during_rotation_is_never_adopted_or_deleted(identities, monkeypatch):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    original = identity.access_key
    create = rgw.create_access_key

    def create_with_foreign_key(uid, **kwargs):
        rgw.users[uid]["keys"].append({"access_key": "FOREIGN", "secret_key": "FOREIGN-SECRET"})
        return create(uid, **kwargs)

    monkeypatch.setattr(rgw, "create_access_key", create_with_foreign_key)
    rgw.calls.clear()
    with pytest.raises(ValueError, match="key drift"):
        service.rotate(endpoint, "runtime")
    assert identity.status == "error" and identity.access_key == original
    assert {key["access_key"] for key in rgw.users[identity.rgw_uid]["keys"]} == {original, "FOREIGN", service.db.query(KeyRotationIntent).one().new_access_key}
    assert not any(call[0] == "key_delete" for call in rgw.calls)


@pytest.mark.parametrize("monitoring", [False, True])
def test_external_env_with_complete_keys_is_validated_without_provisioning(identities, db_session, monkeypatch, monitoring):
    _, endpoint, rgw = identities
    rgw.users["operator"]["caps"] = "users=read;accounts=read"
    credentials = {}
    for kind in ("runtime", "supervision"):
        access, secret = kind.upper(), f"{kind.upper()}-SECRET"
        credentials.update({f"{kind}_access_key": access, f"{kind}_secret_key": secret})
        rgw.users[kind] = {"user_id": kind, "caps": SERVICE_CAPS[kind], "keys": [{"access_key": access, "secret_key": secret}]}
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.env_storage_endpoints", json.dumps([{
        "name": endpoint.name, "endpoint_url": endpoint.endpoint_url, "provider": "ceph",
        "admin_access_key": "ADMIN", "admin_secret_key": "ADMIN-SECRET", "service_identity_mode": "external",
        "features": {"admin": {"enabled": True}, "metrics": {"enabled": monitoring}}, **credentials,
    }]))
    StorageEndpointsService(db_session).sync_env_endpoints()
    assert endpoint.service_identity("runtime").status == "ready" and not endpoint.is_editable
    assert endpoint.service_identity("runtime").mode == "external"
    assert endpoint.service_identity("supervision").status == "ready"
    assert not any(call[0] in ("create", "caps", "delete") for call in rgw.calls)


@pytest.mark.parametrize("kind", ["runtime", "supervision"])
@pytest.mark.parametrize("denied", [False, True])
def test_revalidation_distinguishes_transient_failure_from_denied_key(identities, db_session, monkeypatch, kind, denied):
    service, endpoint, rgw = identities
    endpoint.features_config = "features:\n  metrics:\n    enabled: true\n"
    db_session.commit()
    service.reconcile(endpoint)
    identity = endpoint.service_identity(kind)
    functional = service._functional_check
    def check(ep, row):
        if row.kind == kind:
            raise RGWAdminError("temporary or denied", status_code=403 if denied else 503)
        return functional(ep, row)
    monkeypatch.setattr(service, "_functional_check", check)
    service.reconcile(endpoint)
    assert identity.status == ("error" if denied else "ready")
    assert identity.last_error


@pytest.mark.parametrize("kind", ["runtime", "supervision"])
def test_invalid_external_revalidation_stops_using_ready_identity(identities, db_session, kind):
    service, endpoint, rgw = identities
    endpoint.features_config = "features:\n  metrics:\n    enabled: true\n"
    for usage in ("runtime", "supervision"):
        access, secret = usage.upper(), usage.upper() + "-SECRET"
        endpoint.service_identities.append(service_identity(usage, access, secret))
        rgw.users[usage] = {"user_id": usage, "caps": SERVICE_CAPS[usage], "keys": [{"access_key": access, "secret_key": secret}]}
    db_session.commit()
    service.reconcile(endpoint)
    rgw.users[kind]["admin"] = True
    service.reconcile(endpoint)
    identity = endpoint.service_identity(kind)
    assert identity.status == "error" and identity.last_error
    assert not any(call[0] in ("create", "delete", "caps") for call in rgw.calls)


@pytest.mark.parametrize("status", ["missing", "disabled"])
def test_empty_or_finished_revocation_never_contacts_rgw(identities, db_session, monkeypatch, status):
    service, endpoint, rgw = identities
    endpoint.service_identities.append(EndpointServiceIdentity(kind="runtime", mode="managed", status=status))
    endpoint.admin_access_key = None
    db_session.commit()
    monkeypatch.setattr(service, "admin_permissions", lambda *_: pytest.fail("unnecessary bootstrap"))
    assert service.revoke(endpoint, "runtime")
    assert endpoint.service_identity("runtime").status == "disabled"


def test_absent_remote_principal_can_be_revoked_without_users_write(identities):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    uid = endpoint.service_identity("runtime").rgw_uid
    rgw.users.pop(uid)
    rgw.users["operator"]["caps"] = "users=read;accounts=read"
    assert service.revoke(endpoint, "runtime")
    assert not any(call[0] == "delete" for call in rgw.calls)


def test_unchanged_external_env_preserves_ready_state_on_user_instance(identities, db_session, monkeypatch):
    _, endpoint, rgw = identities
    row = service_identity("runtime", "EXTERNAL", "EXTERNAL-SECRET")
    row.status = "ready"
    endpoint.service_identities.append(row)
    db_session.commit()
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.feature_admin_enabled", False)
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.feature_manager_enabled", True)
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.env_storage_endpoints", json.dumps([{
        "name": "Renamed", "endpoint_url": endpoint.endpoint_url, "provider": "ceph", "service_identity_mode": "external",
        "admin_access_key": "ADMIN", "admin_secret_key": "ADMIN-SECRET",
        "runtime_access_key": "EXTERNAL", "runtime_secret_key": "EXTERNAL-SECRET",
        "supervision_access_key": "SUPERVISION", "supervision_secret_key": "SUPERVISION-SECRET",
    }]))
    StorageEndpointsService(db_session).sync_env_endpoints()
    assert row.status == "ready" and row.last_error is None and not rgw.calls


def test_ready_managed_identity_survives_removing_write_permissions_and_rename(identities, db_session):
    from app.models.storage_endpoint import StorageEndpointUpdate
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    row = endpoint.service_identity("runtime")
    old = row.access_key
    rgw.users["operator"]["caps"] = "users=read;accounts=read"
    rgw.calls.clear()
    StorageEndpointsService(db_session).update_endpoint(endpoint.id, StorageEndpointUpdate(name="Renamed"))
    assert row.mode == "managed" and row.status == "ready" and row.access_key == old
    assert not any(call[0] in ("create", "delete", "caps") for call in rgw.calls)


def test_supervision_survives_disabling_all_collectors(identities, db_session):
    service, endpoint, rgw = identities
    endpoint.features_config = "features:\n  healthcheck:\n    enabled: true\n    mode: s3\n"
    db_session.commit()
    service.reconcile(endpoint)
    supervision = endpoint.service_identity("supervision")
    assert supervision.status == "ready"
    uid = supervision.rgw_uid
    service.reconcile(endpoint)
    assert uid in rgw.users and supervision.status == "ready"
    endpoint.features_config = "features:\n  healthcheck:\n    enabled: true\n    mode: http\n"
    db_session.commit()
    service.reconcile(endpoint)
    assert supervision.status == "ready" and uid in rgw.users


@pytest.mark.parametrize("failure", ["lost_response", "activation_commit", "retirement"])
def test_durable_rotation_resumes_exact_pair_after_partial_failure(identities, db_session, monkeypatch, failure):
    from sqlalchemy.exc import OperationalError
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    old = identity.access_key
    create, commit = rgw.create_access_key, db_session.commit
    def fail_creation(uid, **kwargs):
        # Intent and encrypted secret exist before any remote write.
        pending = db_session.query(KeyRotationIntent).one()
        assert pending.phase == "prepared" and pending.new_access_key == kwargs["access_key"]
        assert pending.new_secret_key == kwargs["secret_key"]
        assert pending.new_secret_key not in db_session.execute(text("SELECT new_secret_key FROM key_rotation_intents")).scalar_one()
        result = create(uid, **kwargs)
        if failure == "lost_response":
            raise RGWAdminError("response lost", status_code=503)
        return result
    def fail_commit():
        if failure == "activation_commit" and any(isinstance(row, KeyRotationIntent) and row.phase == "activated" for row in db_session.dirty):
            raise OperationalError("commit", {}, Exception("injected"))
        return commit()
    monkeypatch.setattr(rgw, "create_access_key", fail_creation)
    monkeypatch.setattr(db_session, "commit", fail_commit)
    rgw.fail_delete = failure == "retirement"
    with pytest.raises((ValueError, RGWAdminError)):
        service.rotate(endpoint, "runtime")
    intent = db_session.query(KeyRotationIntent).one()
    candidate = intent.new_access_key, intent.new_secret_key
    assert intent.phase == ("activated" if failure == "retirement" else "prepared")
    assert old in {key["access_key"] for key in rgw.users[identity.rgw_uid]["keys"]}
    assert identity.access_key == (candidate[0] if failure == "retirement" else old)
    monkeypatch.setattr(rgw, "create_access_key", create)
    monkeypatch.setattr(db_session, "commit", commit)
    rgw.fail_delete = False
    service.rotate(endpoint, "runtime")
    assert (identity.access_key, identity.secret_key) == candidate
    assert db_session.query(KeyRotationIntent).count() == 0
    assert len([call for call in rgw.calls if call[0] == "key_create"]) == 1
    assert old not in {key["access_key"] for key in rgw.users[identity.rgw_uid]["keys"]}


def test_resume_revalidates_candidate_before_retiring_old_key(identities):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    old = identity.access_key
    rgw.fail_delete = True
    with pytest.raises(RGWAdminError):
        service.rotate(endpoint, "runtime")
    rgw.fail_delete = False
    candidate = next(key for key in rgw.users[identity.rgw_uid]["keys"] if key["access_key"] == identity.access_key)
    candidate["active"] = False
    rgw.calls.clear()
    with pytest.raises(ValueError, match="active replacement"):
        service.rotate(endpoint, "runtime")
    assert not any(call[0] == "key_delete" for call in rgw.calls)
    assert old in {key["access_key"] for key in rgw.users[identity.rgw_uid]["keys"]}


def test_pending_rotation_api_metadata_never_exposes_candidate_credentials(identities, db_session):
    from app.models.key_rotation import KeyRotationRequest
    from app.services.key_rotation_service import KeyRotationService

    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    identity = endpoint.service_identity("runtime")
    old_secret = identity.secret_key
    rgw.fail_delete = True
    result = KeyRotationService(db_session).rotate_keys(KeyRotationRequest(
        endpoint_ids=[endpoint.id], key_types=["endpoint_runtime"],
    ))
    intent = db_session.query(KeyRotationIntent).one()
    assert result.summary.failed == 1
    assert result.results[0].rotation_pending
    assert result.results[0].rotation_phase == "activated"
    endpoint_response = StorageEndpointsService(db_session).get_endpoint(
        endpoint.id, include_admin_ops_permissions=False,
    )
    status = next(row for row in endpoint_response.service_identities if row.kind == "runtime")
    assert status.rotation_pending and status.rotation_phase == "activated"
    for response in (result.model_dump_json(), endpoint_response.model_dump_json()):
        assert old_secret not in response
        assert intent.new_secret_key not in response
        assert intent.new_access_key not in response


def test_delete_keeps_lease_until_commit_and_stale_reconciliation_cannot_recreate(identities, db_session, monkeypatch):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    endpoint_id = endpoint.id
    release = OperationLeaseService.release
    def inspect_release(lease, handle):
        if handle.operation_name == f"endpoint-identities:{endpoint_id}":
            assert db_session.query(StorageEndpoint).filter_by(id=endpoint_id).first() is None
        return release(lease, handle)
    monkeypatch.setattr(OperationLeaseService, "release", inspect_release)
    StorageEndpointsService(db_session).delete_endpoint(endpoint_id)
    monkeypatch.setattr(OperationLeaseService, "release", release)
    creates = sum(call[0] == "create" for call in rgw.calls)
    with pytest.raises(ValueError, match="no longer exists"):
        service.reconcile(endpoint)
    assert sum(call[0] == "create" for call in rgw.calls) == creates


def test_startup_reconciles_persisted_endpoints_only_on_controller_instances(identities, db_session, monkeypatch):
    _, endpoint, rgw = identities
    service = StorageEndpointsService(db_session)
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.feature_admin_enabled", False)
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.feature_manager_enabled", True)
    service.reconcile_persisted_identities()
    assert endpoint.service_identity("runtime") is None and not rgw.calls
    monkeypatch.setattr("app.services.storage_endpoints_service.settings.feature_admin_enabled", True)
    service.reconcile_persisted_identities()
    assert endpoint.service_identity("runtime").status == "ready"
    calls_after_initial_reconciliation = list(rgw.calls)
    service.reconcile_persisted_identities()
    assert rgw.calls == calls_after_initial_reconciliation


def test_startup_reconciles_when_service_identity_rotation_is_pending(identities, db_session):
    identity_service, endpoint, rgw = identities
    identity_service.reconcile(endpoint)
    runtime = endpoint.service_identity("runtime")
    db_session.add(
        KeyRotationIntent(
            endpoint_id=endpoint.id,
            key_type="endpoint_runtime",
            target_id=runtime.id,
            rgw_uid=runtime.rgw_uid,
            rgw_endpoint=endpoint.endpoint_url,
            old_access_key=runtime.access_key,
            new_access_key="PENDING-ACCESS",
            new_secret_key="PENDING-SECRET",
            deactivate_only=False,
            phase="prepared",
            actor_email="system",
        )
    )
    db_session.commit()
    rgw.calls.clear()

    StorageEndpointsService(db_session).reconcile_persisted_identities()

    assert rgw.calls


def test_managed_to_external_conversion_requires_supervision_before_revoking(identities, db_session):
    from app.models.storage_endpoint import StorageEndpointUpdate
    service, endpoint, rgw = identities
    endpoint.features_config = "features:\n  metrics:\n    enabled: true\n"
    db_session.commit()
    service.reconcile(endpoint)
    rgw.users["external"] = {"user_id": "external", "caps": SERVICE_CAPS["runtime"], "keys": [{"access_key": "EXTERNAL", "secret_key": "EXTERNAL-SECRET"}]}
    runtime = endpoint.service_identity("runtime")
    supervision = endpoint.service_identity("supervision")
    before = len(rgw.calls)
    with pytest.raises(ValueError, match="replacement Supervision credentials"):
        StorageEndpointsService(db_session).update_endpoint(endpoint.id, StorageEndpointUpdate(
            service_identity_mode="external", runtime_access_key="EXTERNAL", runtime_secret_key="EXTERNAL-SECRET",
            features_config="features:\n  metrics:\n    enabled: false\n"))
    assert runtime.mode == supervision.mode == "managed"
    assert runtime.status == supervision.status == "ready"
    assert len(rgw.calls) == before

    rgw.users["external-supervision"] = {"user_id": "external-supervision", "caps": SERVICE_CAPS["supervision"], "keys": [{"access_key": "SUPERVISION", "secret_key": "SUPERVISION-SECRET"}]}
    StorageEndpointsService(db_session).update_endpoint(endpoint.id, StorageEndpointUpdate(
        service_identity_mode="external", runtime_access_key="EXTERNAL", runtime_secret_key="EXTERNAL-SECRET",
        supervision_access_key="SUPERVISION", supervision_secret_key="SUPERVISION-SECRET",
        features_config="features:\n  metrics:\n    enabled: false\n"))
    assert runtime.mode == supervision.mode == "external"
    assert runtime.status == supervision.status == "ready"
    assert supervision.access_key == "SUPERVISION"


def test_conversion_without_write_keeps_external_credentials(identities, db_session):
    from app.models.storage_endpoint import StorageEndpointUpdate
    _, endpoint, rgw = identities
    endpoint.service_identities.append(service_identity("runtime", "EXTERNAL", "EXTERNAL-SECRET"))
    db_session.commit()
    rgw.users["operator"]["caps"] = "users=read;accounts=read"
    with pytest.raises(ValueError, match="users=write"):
        StorageEndpointsService(db_session).update_endpoint(endpoint.id, StorageEndpointUpdate(service_identity_mode="managed"))
    row = endpoint.service_identity("runtime")
    assert row.mode == "external" and row.access_key == "EXTERNAL" and row.secret_key == "EXTERNAL-SECRET"
    assert not rgw.calls


def test_reconcile_retries_pending_revocation_without_reactivating_identity(identities):
    service, endpoint, rgw = identities
    service.reconcile(endpoint)
    row = endpoint.service_identity("runtime")
    rgw.fail_delete = True
    assert not service.revoke(endpoint, "runtime")
    service.reconcile(endpoint)
    assert row.status == "revocation_pending"
    rgw.fail_delete = False
    service.reconcile(endpoint)
    assert row.status == "disabled" and row.rgw_uid not in rgw.users
