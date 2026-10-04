# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from copy import deepcopy

import pytest
from sqlalchemy import text

from app.db import EndpointServiceIdentity, StorageEndpoint
from app.services import endpoint_service_identities as module
from app.services.endpoint_service_identities import EndpointServiceIdentityService, SERVICE_CAPS
from app.services.operation_lease_service import OperationLeaseService
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client
from app.services.storage_endpoints_service import StorageEndpointsService
from tests.service_identity_helpers import service_identity, set_service_identity_credentials


class FakeRGW:
    def __init__(self):
        self.users = {"operator": {"user_id": "operator", "caps": "users=read,write;accounts=read;usage=read", "keys": [{"access_key": "ADMIN", "secret_key": "ADMIN-SECRET"}]}}
        self.calls = []
        self.fail_delete = False
        self.fail_create = False
        self.leak_keys = False

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

    def create_access_key(self, uid):
        self.calls.append(("key_create", uid))
        self.users[uid]["keys"].append({"access_key": "NEW-KEY", "secret_key": "NEW-SECRET"})
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
                return None
            def get_all_buckets(self, **kwargs):
                rgw.calls.append(("list", access, kwargs))
                return []
            def get_usage(self, **kwargs):
                return {"entries": [], "summary": []}
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
    stored = db_session.execute(text("SELECT secret_key FROM endpoint_service_identities")).scalar_one()
    assert identity.secret_key not in stored
    response = StorageEndpointsService(db_session).get_endpoint(endpoint.id, include_admin_ops_permissions=False).model_dump_json()
    assert identity.secret_key not in response and "secret_key" not in response
    first_key = identity.access_key
    service.reconcile(endpoint)
    assert identity.access_key == first_key
    assert len([call for call in rgw.calls if call[0] == "create"]) == 1
    assert endpoint.service_identity("supervision") is None


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
    assert len(rgw.calls) == before
    assert not service.revoke(endpoint, "runtime")
    assert rgw.users[identity.rgw_uid] == foreign


def test_minimal_admin_and_external_runtime_need_no_write_caps(identities, db_session):
    service, endpoint, rgw = identities
    rgw.users["operator"]["caps"] = "users=read;accounts=read"
    endpoint.service_identities.append(
        service_identity("runtime", "EXTERNAL", "EXTERNAL-SECRET")
    )
    rgw.users["external"] = {"user_id": "external", "caps": SERVICE_CAPS["runtime"], "keys": [{"access_key": "EXTERNAL", "secret_key": "EXTERNAL-SECRET"}]}
    endpoint.features_config = "features:\n  usage:\n    enabled: true\n"
    db_session.commit()
    service.reconcile(endpoint)
    assert endpoint.service_identity("runtime").status == "ready"
    assert not json.loads(StorageEndpointsService(db_session).get_endpoint(endpoint.id, include_admin_ops_permissions=False).model_dump_json())["features"]["usage"]["enabled"]
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
    with pytest.raises(ValueError, match="retirement"):
        service.rotate(endpoint, "runtime")
    db_session.expire_all()
    assert identity.status == "ready" and identity.access_key == "NEW-KEY" and identity.previous_access_key == previous
    rgw.fail_delete = False
    service.rotate(endpoint, "runtime")
    assert identity.previous_access_key is None
    assert len([call for call in rgw.calls if call[0] == "key_create"]) == 1
    assert rgw.users[identity.rgw_uid]["keys"] == [{"access_key": "NEW-KEY", "secret_key": "NEW-SECRET"}]


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
    result = StorageEndpointsService(db_session).create_endpoint(StorageEndpointCreate(
        name="Read-only operator", endpoint_url="https://second.example.test", provider="ceph",
        admin_access_key="ADMIN", admin_secret_key="ADMIN-SECRET", service_identity_mode="external",
        runtime_access_key="EXTERNAL", runtime_secret_key="EXTERNAL-SECRET",
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
        "name": endpoint.name, "endpoint_url": endpoint.endpoint_url, "provider": "ceph",
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
