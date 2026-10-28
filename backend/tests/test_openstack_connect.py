# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.db import AuthSession, StorageEndpoint, UiGroup, User, UserUiGroup
from app.db.openstack import OpenStackCloud, OpenStackConnection, OpenStackProjectCredential, OpenStackSession
from app.models.openstack import OpenStackAuthenticate, OpenStackCloudWrite
from app.services.auth_session_service import AuthSessionService
from app.services.execution_context_catalog_service import ExecutionContextCatalogService
from app.services.keystone_client import KeystoneClient, KeystoneIdentity, OpenStackError
from app.services.openstack_service import OpenStackService
from app.services.s3_execution_client import s3_execution_cache_key
from app.services.browser.sts import browser_sts_enabled
from app.utils.time import utcnow
from tests.auth_test_utils import authenticate_ui_client, trusted_origin_headers


@pytest.fixture
def setup_cloud(db_session, monkeypatch):
    user = User(email="cloud@example.test", full_name="Cloud User", hashed_password="x", role="ui_user", is_active=True)
    endpoint = StorageEndpoint(name="S3", endpoint_url="https://s3.example.test", provider="ceph", region="region-a", is_default=True)
    db_session.add_all([user, endpoint]); db_session.commit()
    cloud = OpenStackService(db_session).save_cloud(OpenStackCloudWrite(
        name="Cloud A", auth_url="https://identity.example.test/v3", enabled=True,
        default_domain="People", endpoint_ids=[endpoint.id], user_ids=[user.id],
    ))
    db_session.commit()
    monkeypatch.setattr(OpenStackService, "_probe_iam", lambda *args: False)
    monkeypatch.setattr(KeystoneClient, "authenticate", lambda self, payload, domain: KeystoneIdentity(
        "PRIVATE-KEYSTONE-TOKEN", "keystone-user", "Person", utcnow() + timedelta(minutes=30),
    ))
    monkeypatch.setattr(KeystoneClient, "projects", lambda self, token: [{"id": "project-a", "name": "Project A", "domain_id": "domain-a"}])
    monkeypatch.setattr(KeystoneClient, "credentials", lambda self, identity, project: [{
        "access": "EC2-ACCESS", "secret": "PRIVATE-EC2-SECRET", "expires_at": identity.expires_at,
    }])
    return user, endpoint, cloud


def authenticated(db, user):
    result = AuthSessionService(db).create_for_user(user, auth_type="test", ip_address=None, user_agent=None, mfa_verified=True)
    return db.scalar(select(AuthSession).where(AuthSession.user_id == user.id).order_by(AuthSession.created_at.desc())), result


def connect(db, setup):
    user, endpoint, cloud = setup
    auth, _ = authenticated(db, user)
    service = OpenStackService(db)
    connection = service.authenticate(user, auth.id, OpenStackAuthenticate(cloud_id=cloud.id, method="password", username="person", password="PRIVATE-PASSWORD"))
    ctx = service.activate(user, auth.id, connection.id, "project-a", endpoint.id, None)
    return service, user, auth, connection, ctx


def test_context_is_explicit_private_session_bound_and_secrets_are_encrypted(db_session, setup_cloud):
    service, user, auth, connection, ctx = connect(db_session, setup_cloud)
    execution = service.resolve(user, auth.id, ctx)
    assert execution.context_kind == "openstack_project"
    assert execution.source_account is execution.source_connection is None
    assert execution.rgw_account_id is execution.rgw_user_uid is execution.rgw_tenant is None
    assert execution.execution_auth_session_id == auth.id
    assert execution.access_key == "EC2-ACCESS"
    assert execution.secret_key == "PRIVATE-EC2-SECRET"
    assert not browser_sts_enabled(execution)
    catalog = ExecutionContextCatalogService(db_session, auth.id)
    for workspace in ("browser", "manager"):
        rows = catalog.list_contexts(user, workspace=workspace)
        assert [row.id for row in rows] == [ctx]
        serialized = json.dumps([row.model_dump() for row in rows])
        assert "PRIVATE-" not in serialized
        assert rows[0].capabilities.admin_api_capable is False
        assert rows[0].storage_endpoint_capabilities["sts"] is False
    assert catalog.workspace_access(user).browser.available
    assert catalog.workspace_access(user).manager.available
    assert not catalog.workspace_access(user).portal.available
    user.can_access_storage_ops = True
    db_session.commit()
    assert catalog.workspace_access(user).storage_ops.context_count == 0
    assert not catalog.workspace_access(user).storage_ops.available
    raw = db_session.execute(text("select secret_key from openstack_project_credentials")).scalar_one()
    assert "PRIVATE-EC2-SECRET" not in raw
    assert "PRIVATE-KEYSTONE-TOKEN" not in db_session.execute(text("select token from openstack_sessions")).scalar_one()


def test_credential_rotation_reencrypts_openstack_tokens_and_keys(db_session, setup_cloud, monkeypatch):
    from app.core.security import clear_credential_keys_override, decrypt_secret, set_credential_keys_override
    from app.scripts import rotate_credential_keys

    connect(db_session, setup_cloud)
    monkeypatch.setattr(rotate_credential_keys, "SessionLocal", sessionmaker(bind=db_session.bind))
    assert rotate_credential_keys.rotate_credentials(new_key="openstack-test-rotation") == 2
    set_credential_keys_override(["openstack-test-rotation"])
    try:
        token = db_session.execute(text("select token from openstack_sessions")).scalar_one()
        secret = db_session.execute(text("select secret_key from openstack_project_credentials")).scalar_one()
        assert decrypt_secret(token) == "PRIVATE-KEYSTONE-TOKEN"
        assert decrypt_secret(secret) == "PRIVATE-EC2-SECRET"
    finally:
        clear_credential_keys_override()


def test_other_session_other_user_and_bearer_catalog_cannot_reuse_credentials(db_session, setup_cloud):
    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    second, _ = authenticated(db_session, user)
    assert service.catalogue(user, None) == []
    assert service.catalogue(user, second.id) == []
    with pytest.raises(OpenStackError, match="Reconnect"):
        service.resolve(user, second.id, ctx)
    other = User(email="other@example.test", hashed_password="x", role="ui_user", is_active=True)
    db_session.add(other); db_session.commit()
    other_auth, _ = authenticated(db_session, other)
    with pytest.raises(OpenStackError) as caught:
        service.resolve(other, other_auth.id, ctx)
    assert caught.value.status == 404
    first = service.resolve(user, auth.id, ctx)
    first.execution_auth_session_id = second.id
    assert s3_execution_cache_key(first) != s3_execution_cache_key(service.resolve(user, auth.id, ctx))


def test_endpoint_service_identities_never_enrich_or_administer_openstack_contexts(db_session, setup_cloud, monkeypatch):
    from app.services.bucket_configuration_service import BucketConfigurationService
    from app.services.buckets_service import BucketsService
    from app.services.rgw_principal_scope import resolve_target_admin_uid
    from app.services.rgw_supervision import get_supervision_credentials

    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    execution = service.resolve(user, auth.id, ctx)
    # Even unrelated endpoint identities or accidental RGW metadata must not
    # turn an external project into a managed Ceph identity.
    execution.rgw_user_uid = "must-not-be-used"
    execution.rgw_account_id = "RGW99999999999999999"
    acquire = Mock(side_effect=AssertionError("Endpoint service credentials must not be acquired"))
    monkeypatch.setattr("app.services.buckets_service.get_endpoint_runtime_rgw_client", acquire)
    monkeypatch.setattr("app.services.bucket_configuration_service.get_endpoint_admin_rgw_client", acquire)
    monkeypatch.setattr("app.services.rgw_supervision._supervision_credentials_from_endpoint", acquire)
    assert resolve_target_admin_uid(execution) is None
    assert BucketsService()._admin_bucket_list(execution) == []
    assert get_supervision_credentials(execution) is None
    with pytest.raises(RuntimeError, match="OpenStack"):
        BucketsService()._rgw_runtime_for_context(execution)
    with pytest.raises(RuntimeError, match="OpenStack"):
        BucketConfigurationService()._rgw_bucket_quota_admin_for_context(execution)
    acquire.assert_not_called()


@pytest.mark.parametrize("revoke", ["one", "all", "family", "expired", "disconnect", "forget", "cloud"])
def test_every_revocation_path_erases_secrets(db_session, setup_cloud, revoke):
    service, user, auth, connection, ctx = connect(db_session, setup_cloud)
    sessions = AuthSessionService(db_session)
    if revoke == "one": sessions.revoke_session(auth.id, "test")
    elif revoke == "all": sessions.revoke_all_for_user(user, "test")
    elif revoke == "family":
        from app.db import RefreshToken
        family = db_session.scalar(select(RefreshToken.family_id).where(RefreshToken.auth_session_id == auth.id))
        sessions.revoke_family(family, "test")
    elif revoke == "expired":
        auth.idle_expires_at = utcnow() - timedelta(seconds=1); db_session.commit(); sessions.cleanup_expired()
    elif revoke == "disconnect": service.disconnect(user, auth.id, connection.id)
    elif revoke == "forget": service.disconnect(user, auth.id, connection.id, forget=True)
    else:
        user, endpoint, cloud = setup_cloud
        service.save_cloud(OpenStackCloudWrite(name=cloud.name, auth_url=cloud.auth_url, enabled=False, endpoint_ids=[endpoint.id]), cloud.id)
        db_session.commit()
    assert db_session.scalar(select(OpenStackProjectCredential.id)) is None
    assert not db_session.scalars(select(OpenStackSession.token)).all() or all(token is None for token in db_session.scalars(select(OpenStackSession.token)).all())
    assert service.catalogue(user, auth.id) == []


def test_group_admission_and_revocation_use_current_database(db_session, setup_cloud):
    service, user, auth, connection, ctx = connect(db_session, setup_cloud)
    cloud = setup_cloud[2]
    group = UiGroup(name="Team")
    db_session.add(group); db_session.flush()
    cloud.users = []; cloud.groups = [group]
    db_session.add(UserUiGroup(user_id=user.id, group_id=group.id)); db_session.commit()
    assert service.resolve(user, auth.id, ctx)
    db_session.delete(db_session.scalar(select(UserUiGroup))); db_session.commit()
    assert service.catalogue(user, auth.id) == []
    with pytest.raises(OpenStackError): service.resolve(user, auth.id, ctx)


def test_expired_revalidation_fails_closed_and_never_switches_key(db_session, setup_cloud, monkeypatch):
    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    credential = db_session.scalar(select(OpenStackProjectCredential))
    credential.validated_at = utcnow() - timedelta(seconds=61); db_session.commit()
    monkeypatch.setattr(KeystoneClient, "credentials", Mock(side_effect=OpenStackError("provider_unavailable", "Unavailable", 502)))
    with pytest.raises(OpenStackError) as caught: service.resolve(user, auth.id, ctx)
    assert caught.value.status == 502
    monkeypatch.setattr(KeystoneClient, "credentials", lambda *args: [{"access": "OTHER", "secret": "other", "expires_at": utcnow() + timedelta(minutes=10)}])
    with pytest.raises(OpenStackError): service.resolve(user, auth.id, ctx)
    assert db_session.scalar(select(OpenStackProjectCredential.id)) is None


def test_key_selection_and_endpoint_are_explicit(db_session, setup_cloud, monkeypatch):
    service, user, auth, connection, _ = connect(db_session, setup_cloud)
    monkeypatch.setattr(KeystoneClient, "credentials", lambda self, identity, project: [
        {"access": key, "secret": key, "expires_at": identity.expires_at} for key in ("A", "B")
    ])
    with pytest.raises(OpenStackError) as caught: service.activate(user, auth.id, connection.id, "project-a", setup_cloud[1].id, None)
    assert caught.value.code == "credential_selection_required"
    with pytest.raises(OpenStackError): service.activate(user, auth.id, connection.id, "project-a", -1, "A")
    with pytest.raises(OpenStackError): service.activate(user, auth.id, connection.id, "different-project", setup_cloud[1].id, "A")
    assert service.activate(user, auth.id, connection.id, "project-a", setup_cloud[1].id, "B").startswith("os-")


def test_logout_during_authentication_cannot_restore_token(db_session, setup_cloud, monkeypatch):
    user, _, cloud = setup_cloud
    auth, _ = authenticated(db_session, user)
    def authenticate(*args):
        AuthSessionService(db_session).revoke_session(auth.id, "test")
        return KeystoneIdentity("late-token", "ks-user", "Name", utcnow() + timedelta(minutes=10))
    monkeypatch.setattr(KeystoneClient, "authenticate", authenticate)
    with pytest.raises(OpenStackError):
        OpenStackService(db_session).authenticate(user, auth.id, OpenStackAuthenticate(cloud_id=cloud.id, method="token", token="supplied"))
    assert db_session.scalar(select(OpenStackSession.id)) is None


def test_cloud_configuration_change_during_authentication_cannot_restore_token(db_session, setup_cloud, monkeypatch):
    user, endpoint, cloud = setup_cloud
    auth, _ = authenticated(db_session, user)
    def authenticate(*args):
        OpenStackService(db_session).save_cloud(OpenStackCloudWrite(name=cloud.name, auth_url=cloud.auth_url, enabled=True, endpoint_ids=[endpoint.id], user_ids=[user.id]), cloud.id)
        db_session.commit()
        return KeystoneIdentity("late-token", "ks-user", "Name", utcnow() + timedelta(minutes=10))
    monkeypatch.setattr(KeystoneClient, "authenticate", authenticate)
    with pytest.raises(OpenStackError) as caught:
        OpenStackService(db_session).authenticate(user, auth.id, OpenStackAuthenticate(cloud_id=cloud.id, method="token", token="supplied"))
    assert caught.value.code == "configuration_changed"
    assert db_session.scalar(select(OpenStackSession.id)) is None


@pytest.mark.parametrize("change", ["url", "tls"])
def test_registered_endpoint_trust_changes_invalidate_associated_cloud_sessions(db_session, setup_cloud, change):
    from app.models.storage_endpoint import StorageEndpointUpdate
    from app.services.storage_endpoint_normalization import normalize_storage_endpoint_update
    from app.services.storage_endpoints_service import StorageEndpointsService

    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    endpoint, cloud = setup_cloud[1:]
    unrelated = service.save_cloud(OpenStackCloudWrite(name="Unrelated", auth_url="https://elsewhere.example.test/v3"))
    previous_version = cloud.config_version
    payload = StorageEndpointUpdate(endpoint_url="https://different.example.test") if change == "url" else StorageEndpointUpdate(verify_tls=False)
    state = normalize_storage_endpoint_update(endpoint, payload)
    StorageEndpointsService._apply_endpoint_state(endpoint, state)
    db_session.commit()
    assert cloud.config_version == previous_version + 1
    assert unrelated.config_version == 1
    assert db_session.scalar(select(OpenStackSession.token)) is None
    assert db_session.scalar(select(OpenStackProjectCredential.id)) is None
    with pytest.raises(OpenStackError, match="Reconnect"):
        service.resolve(user, auth.id, ctx)


@pytest.mark.parametrize("revoke", ["family", "one", "all"])
def test_ui_revocation_precedes_erasure_and_blocks_late_authentication(db_session, setup_cloud, monkeypatch, revoke):
    from app.db import RefreshToken
    from app.services.openstack_sessions import erase_openstack_sessions

    service, user, auth, _, _ = connect(db_session, setup_cloud)
    family = db_session.scalar(select(RefreshToken.family_id).where(RefreshToken.auth_session_id == auth.id))
    def erase_after_revocation(db, auth_ids):
        with pytest.raises(OpenStackError, match="no longer active"):
            service.authenticate(user, auth.id, OpenStackAuthenticate(
                cloud_id=setup_cloud[2].id, method="token", token="late-token",
            ))
        erase_openstack_sessions(db, auth_ids)
    monkeypatch.setattr("app.services.auth_session_service.erase_openstack_sessions", erase_after_revocation)
    sessions = AuthSessionService(db_session)
    if revoke == "family":
        sessions.revoke_family(family, "refresh_replay")
    elif revoke == "one":
        sessions.revoke_session(auth.id, "test")
    else:
        sessions.revoke_all_for_user(user, "test")
    assert db_session.scalar(select(OpenStackSession.token)) is None
    assert db_session.scalar(select(OpenStackProjectCredential.id)) is None


def test_long_running_guard_stops_after_logout_and_migration_resolves_same_session(db_session, setup_cloud):
    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    execution = service.resolve(user, auth.id, ctx)
    execution.access_validator()
    from app.services.bucket_migration_service import BucketMigrationService
    from app.services.effective_access_service import EffectiveAccessService
    assert ctx in EffectiveAccessService(db_session).build_bucket_migration_scope(user, auth_session_id=auth.id).allowed_context_ids
    migration = BucketMigrationService(db_session, execution_auth_session_id=auth.id)
    assert migration._context_to_execution_target(ctx).execution_auth_session_id == auth.id
    AuthSessionService(db_session).revoke_session(auth.id, "test")
    with pytest.raises(OpenStackError): execution.access_validator()
    with pytest.raises(OpenStackError): migration._context_to_execution_target(ctx)
    assert ctx not in EffectiveAccessService(db_session).build_bucket_migration_scope(user, auth_session_id=auth.id).allowed_context_ids


@pytest.mark.parametrize("change", ["reconnect", "endpoint"])
def test_running_executor_cannot_follow_reauthentication_or_endpoint_changes(db_session, setup_cloud, change):
    service, user, auth, connection, ctx = connect(db_session, setup_cloud)
    original = service.resolve(user, auth.id, ctx)
    original_fingerprint = s3_execution_cache_key(original)
    original.access_validator()
    if change == "reconnect":
        service.disconnect(user, auth.id, connection.id)
        connection = service.authenticate(user, auth.id, OpenStackAuthenticate(
            cloud_id=setup_cloud[2].id, method="token", token="new-authentication",
        ))
        assert service.activate(user, auth.id, connection.id, "project-a", setup_cloud[1].id, None) == ctx
    else:
        setup_cloud[1].endpoint_url = "https://different-s3.example.test"
        db_session.commit()
    assert s3_execution_cache_key(service.resolve(user, auth.id, ctx)) != original_fingerprint
    with pytest.raises(OpenStackError, match="restart"):
        original.access_validator()


def test_cloud_expiration_erases_secrets_on_access(db_session, setup_cloud):
    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    session = db_session.scalar(select(OpenStackSession))
    session.expires_at = utcnow() - timedelta(seconds=1); db_session.commit()
    with pytest.raises(OpenStackError): service.resolve(user, auth.id, ctx)
    assert db_session.scalar(select(OpenStackProjectCredential.id)) is None
    assert db_session.scalar(select(OpenStackSession.token)) is None


@pytest.mark.parametrize("cleanup", ["access", "scheduled"])
def test_project_credential_expiration_erases_secret_without_ending_ui_session(db_session, setup_cloud, cleanup):
    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    credential = db_session.scalar(select(OpenStackProjectCredential))
    credential.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    if cleanup == "scheduled":
        AuthSessionService(db_session).cleanup_expired()
    else:
        with pytest.raises(OpenStackError, match="Reconnect"):
            service.resolve(user, auth.id, ctx)
    assert db_session.scalar(select(OpenStackProjectCredential.id)) is None
    assert db_session.get(AuthSession, auth.id).revoked_at is None
    assert db_session.scalar(select(OpenStackSession.token)) is not None


@pytest.mark.parametrize("multipart", [True, False])
def test_presigned_urls_are_bounded_and_rejected_after_logout_or_expiration(db_session, setup_cloud, monkeypatch, multipart):
    from app.models.browser import PresignRequest, PresignPartRequest
    from app.services.browser_service import BrowserService

    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    execution = service.resolve(user, auth.id, ctx)
    execution.credential_expires_at = utcnow() + timedelta(seconds=40)
    browser = BrowserService()
    client = Mock()
    client.generate_presigned_url.return_value = "https://s3.example.test/fixture"
    monkeypatch.setattr(browser, "_client", lambda *args, **kwargs: client)
    def presign():
        if multipart:
            return browser.presign_part("bucket", execution, PresignPartRequest(key="fixture", upload_id="upload", part_number=1))
        return browser.presign("bucket", execution, PresignRequest(key="fixture", operation="get_object"))
    assert 0 < presign().expires_in <= 40
    assert client.generate_presigned_url.call_args.kwargs["ExpiresIn"] <= 40
    client.generate_presigned_url.reset_mock()
    AuthSessionService(db_session).revoke_session(auth.id, "test")
    with pytest.raises(OpenStackError):
        presign()
    client.generate_presigned_url.assert_not_called()
    execution.credential_expires_at = utcnow() - timedelta(seconds=1)
    with pytest.raises(OpenStackError) as caught:
        presign()
    assert caught.value.code == "reauthentication_required"


def test_routes_return_metadata_only_and_resolve_both_workspaces(client, db_session, setup_cloud, monkeypatch):
    user, endpoint, cloud = setup_cloud
    credentials = authenticate_ui_client(client, db_session, user)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)
    response = client.post("/api/me/openstack/connections", json={"cloud_id": cloud.id, "method": "password", "username": "p", "password": "secret"}, headers=headers)
    assert response.status_code == 200, response.text
    connection_id = response.json()["id"]
    assert "PRIVATE-" not in response.text
    keys = client.get(f"/api/me/openstack/connections/{connection_id}/projects/project-a/credentials")
    assert keys.json() == ["EC2-ACCESS"]
    activation = client.post(f"/api/me/openstack/connections/{connection_id}/contexts", json={"project_id": "project-a", "endpoint_id": endpoint.id}, headers=headers)
    assert activation.status_code == 200, activation.text
    ctx = activation.json()["context_id"]
    for workspace in ("manager", "browser"):
        response = client.get("/api/me/execution-contexts", params={"workspace": workspace})
        assert response.status_code == 200, response.text
        assert response.json()[0]["id"] == ctx
        assert "PRIVATE-" not in response.text
    response = client.get("/api/manager/context", params={"context_id": ctx})
    assert response.status_code == 200, response.text
    assert response.json()["context_kind"] == "openstack_project"
    assert not response.json()["manager_private_access_enabled"]
    assert not response.json()["manager_stats_enabled"]
    assert not response.json()["manager_bucket_quota_enabled"]
    assert not response.json()["manager_ceph_keys_enabled"]
    list_buckets = Mock(return_value=[{"name": "project-fixture"}])
    monkeypatch.setattr("app.services.buckets_service.s3_client.list_buckets", list_buckets)
    response = client.get("/api/manager/buckets", params={"context_id": ctx})
    assert response.status_code == 200, response.text
    assert "project-fixture" in response.text
    assert list_buckets.call_args.kwargs["access_key"] == "EC2-ACCESS"
    assert list_buckets.call_args.kwargs["secret_key"] == "PRIVATE-EC2-SECRET"
    assert list_buckets.call_args.kwargs["endpoint"] == endpoint.endpoint_url


class FakeResponse:
    def __init__(self, payload, status=200, token=None):
        self.payload, self.status_code = payload, status
        self.headers = {"X-Subject-Token": token} if token else {}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, chunk_size): yield json.dumps(self.payload).encode()


def test_keystone_http_refuses_redirects_and_never_leaks_upstream_error(monkeypatch):
    monkeypatch.setattr("app.services.keystone_client.validate_outbound_url", lambda *args, **kwargs: None)
    request = Mock(return_value=FakeResponse({"error": "PRIVATE-ERROR"}, 302))
    monkeypatch.setattr("app.services.keystone_client.requests.request", request)
    with pytest.raises(OpenStackError) as caught: KeystoneClient("https://identity/v3").projects("PRIVATE-TOKEN")
    assert "PRIVATE" not in str(caught.value)
    assert request.call_args.kwargs["allow_redirects"] is False
    assert request.call_args.kwargs["verify"] is not False


@pytest.mark.parametrize("method", ["password", "token"])
def test_keystone_http_authenticates_primary_users_without_extending_source_lifetime(monkeypatch, method):
    monkeypatch.setattr("app.services.keystone_client.validate_outbound_url", lambda *args, **kwargs: None)
    source_end = utcnow() + timedelta(minutes=5)
    response_end = utcnow() + timedelta(minutes=30)
    def payload(end):
        return {"token": {"methods": ["password"], "user": {"id": "user", "name": "Person"}, "expires_at": end.isoformat()}}
    responses = [FakeResponse(payload(source_end)), FakeResponse(payload(response_end), 201, "derived-token")] if method == "token" else [FakeResponse(payload(response_end), 201, "derived-token")]
    request = Mock(side_effect=responses)
    monkeypatch.setattr("app.services.keystone_client.requests.request", request)
    result = KeystoneClient("https://identity/v3").authenticate(OpenStackAuthenticate(cloud_id=1, method=method, username="person", password="password", token="source-token", domain="People"), None)
    assert result.user_id == "user"
    assert result.expires_at == (source_end if method == "token" else response_end)
    body = request.call_args.kwargs["json"]
    assert body["auth"]["scope"] == "unscoped"
    if method == "password":
        assert body["auth"]["identity"]["password"]["user"]["domain"] == {"name": "People"}
    else:
        assert request.call_args_list[0].kwargs["headers"]["X-Subject-Token"] == "source-token"


@pytest.mark.parametrize("domain_is_id", [True, False])
def test_keystone_password_supports_distinct_domains_and_rejects_wrong_explicit_user(monkeypatch, domain_is_id):
    payload = {"token": {"methods": ["password"], "user": {"id": "returned-user"}, "expires_at": (utcnow() + timedelta(minutes=5)).isoformat()}}
    request = Mock(return_value=(payload, "provider-token"))
    monkeypatch.setattr(KeystoneClient, "_request", request)
    client = KeystoneClient("https://identity/v3")
    client.authenticate(OpenStackAuthenticate(cloud_id=1, method="password", username="person", password="secret", domain="other-domain", domain_is_id=domain_is_id), "People")
    assert request.call_args.kwargs["body"]["auth"]["identity"]["password"]["user"]["domain"] == {"id" if domain_is_id else "name": "other-domain"}
    with pytest.raises(OpenStackError) as caught:
        client.authenticate(OpenStackAuthenticate(cloud_id=1, method="password", user_id="requested-user", password="secret"), None)
    assert caught.value.code == "identity_mismatch"


def test_validation_never_echoes_submitted_authentication_material(client, db_session, setup_cloud):
    user, _, cloud = setup_cloud
    credentials = authenticate_ui_client(client, db_session, user)
    response = client.post("/api/me/openstack/connections", json={"cloud_id": cloud.id, "method": "password", "password": "DO-NOT-ECHO-SECRET"}, headers=trusted_origin_headers(csrf_token=credentials.csrf_token))
    assert response.status_code == 422
    assert "DO-NOT-ECHO-SECRET" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_bearer_tokens_cannot_use_cloud_routes_or_session_contexts(client, db_session, setup_cloud):
    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    user.role = "ui_superadmin"; db_session.commit()
    from app.services.api_token_service import ApiTokenService
    token, _ = ApiTokenService(db_session).create_for_user(user, name="test", scopes=["profile:read", "manager:read"])
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/me/openstack/clouds", headers=headers).status_code == 403
    assert client.get("/api/manager/context", params={"context_id": ctx}, headers=headers).status_code == 403


@pytest.mark.parametrize("path,headers", [
    ("/api/storage-ops/buckets", []), ("/api/ceph-admin/buckets", []),
    ("/api/portal/buckets", []), ("/api/admin/buckets", []),
    ("/api/browser/buckets", [(b"x-s3-workspace", b"portal")]),
])
def test_external_project_context_cannot_cross_workspace_authority(db_session, setup_cloud, path, headers):
    from fastapi import HTTPException
    from starlette.requests import Request
    from app.routers.dependencies_internal.execution_context import resolve_s3_execution_context

    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    assert service.resolve(user, auth.id, ctx)
    request = Request({"type": "http", "method": "GET", "path": path, "headers": headers})
    with pytest.raises(HTTPException) as caught:
        resolve_s3_execution_context(request, ctx, user, db_session)
    assert caught.value.status_code == 403


def test_keystone_rejects_foreign_identity_credentials_and_pagination(monkeypatch):
    client = KeystoneClient("https://identity/v3")
    identity = KeystoneIdentity("token", "user", "Name", utcnow() + timedelta(minutes=10))
    monkeypatch.setattr(KeystoneClient, "scoped", lambda *args: identity)
    monkeypatch.setattr(KeystoneClient, "_request", lambda *args, **kwargs: ({"credentials": [{"user_id": "foreign", "tenant_id": "project", "access": "x", "secret": "secret"}]}, None))
    with pytest.raises(OpenStackError) as caught: client.credentials(identity, "project")
    assert caught.value.code == "identity_mismatch"
    monkeypatch.setattr(KeystoneClient, "_request", lambda *args, **kwargs: ({"projects": [], "links": {"next": "https://evil.test/v3/auth/projects"}}, None))
    with pytest.raises(OpenStackError): client.projects("token")


@pytest.mark.parametrize("methods", [["application_credential"], ["ec2credential"], [], ["password", "site-custom"]])
def test_delegated_or_unknown_authentication_tokens_are_not_promoted(methods):
    with pytest.raises(OpenStackError) as caught:
        KeystoneClient._identity({"token": {"methods": methods, "user": {"id": "user"}, "expires_at": (utcnow() + timedelta(minutes=10)).isoformat()}}, "token")
    assert caught.value.code == "unsupported_token"
