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
from app.db.openstack import OpenStackCloud, OpenStackConnection, OpenStackProjectContext, OpenStackProjectCredential, OpenStackSession
from app.models.openstack import OpenStackAuthenticate, OpenStackCloudWrite
from app.services.auth_session_service import AuthSessionService
from app.services.execution_context_catalog_service import ExecutionContextCatalogService
from app.services.effective_access_service import EffectiveAccessService
from app.services.keystone_client import KeystoneClient, KeystoneIdentity, OpenStackError
from app.services.openstack_service import OpenStackService
from app.services.user_associations_service import UserAssociationsService
from app.services.s3_execution_client import s3_execution_cache_key
from app.services.browser.sts import browser_sts_enabled
from app.utils.time import utcnow
from tests.auth_test_utils import authenticate_ui_client, trusted_origin_headers


@pytest.fixture
def setup_cloud(db_session, monkeypatch):
    user = User(email="cloud@example.test", full_name="Cloud User", hashed_password="x", role="ui_user", is_active=True)
    db_session.add(user); db_session.commit()
    cloud = OpenStackService(db_session).save_cloud(OpenStackCloudWrite(
        name="Cloud A", auth_url="https://identity.example.test/v3", enabled=True,
        default_domain="People",
    ))
    UserAssociationsService(db_session).set_openstack_cloud_links(user, [cloud.id])
    db_session.commit()
    target = {
        "target_id": "catalog-s3-region-a",
        "region_id": "region-a",
        "interface": "public",
        "service_type": "s3",
        "service_name": "S3",
        "endpoint_url": "https://s3.example.test",
    }
    monkeypatch.setattr(OpenStackService, "_probe_iam", lambda *args: False)
    monkeypatch.setattr(KeystoneClient, "authenticate", lambda self, payload, domain: KeystoneIdentity(
        "PRIVATE-KEYSTONE-TOKEN", "keystone-user", "Person", utcnow() + timedelta(minutes=30),
    ))
    monkeypatch.setattr(KeystoneClient, "projects", lambda self, token: [{"id": "project-a", "name": "Project A", "domain_id": "domain-a"}])
    monkeypatch.setattr(KeystoneClient, "project_access", lambda self, identity, project: {
        "targets": [target.copy()],
        "credentials": [{
            "access": "EC2-ACCESS", "secret": "PRIVATE-EC2-SECRET", "expires_at": identity.expires_at,
        }],
    })
    return user, target, cloud


def authenticated(db, user):
    result = AuthSessionService(db).create_for_user(user, auth_type="test", ip_address=None, user_agent=None, mfa_verified=True)
    return db.scalar(select(AuthSession).where(AuthSession.user_id == user.id).order_by(AuthSession.created_at.desc())), result


def connect(db, setup):
    user, target, cloud = setup
    auth, _ = authenticated(db, user)
    service = OpenStackService(db)
    connection = service.authenticate(user, auth.id, OpenStackAuthenticate(cloud_id=cloud.id, method="password", username="person", password="PRIVATE-PASSWORD"))
    ctx = service.activate(user, auth.id, connection.id, "project-a", target["target_id"], None)
    return service, user, auth, connection, ctx


def test_connected_projects_are_candidates_and_reuse_previously_activated_context(db_session, setup_cloud):
    user, target, cloud = setup_cloud
    auth, _ = authenticated(db_session, user)
    service = OpenStackService(db_session)
    connection = service.authenticate(
        user,
        auth.id,
        OpenStackAuthenticate(cloud_id=cloud.id, method="password", username="person", password="PRIVATE-PASSWORD"),
    )

    assert service.catalogue(user, auth.id) == []
    options = service.project_options(user, auth.id)
    assert options == [{
        "connection_id": connection.id,
        "cloud_id": cloud.id,
        "cloud_name": "Cloud A",
        "identity_name": "Person",
        "keystone_user_id": "keystone-user",
        "project_id": "project-a",
        "project_name": "Project A",
        "project_domain_id": "domain-a",
    }]
    access = ExecutionContextCatalogService(db_session, auth.id).workspace_access(user)
    assert access.manager.available and access.manager.context_count == 1
    assert access.browser.available and access.browser.context_count == 1

    first_context = service.activate(user, auth.id, connection.id, "project-a", target["target_id"], None)
    assert service.project_options(user, auth.id) == []
    catalogue = service.catalogue(user, auth.id)
    assert [row.id for row in catalogue] == [first_context]
    assert catalogue[0].display_name == "Project A"
    assert catalogue[0].openstack.model_dump() == {
        "connection_id": connection.id,
        "cloud_name": "Cloud A",
        "identity_name": "Person",
        "project_id": "project-a",
        "project_name": "Project A",
        "region_id": "region-a",
    }
    assert catalogue[0].endpoint_url == "https://s3.example.test"
    assert catalogue[0].endpoint_id is None
    project_access = service.project_access(user, auth.id, connection.id, "project-a")
    assert project_access["targets"][0]["allowed"] is True
    assert project_access["targets"][0]["storage_endpoint_id"] is None

    service.authenticate(
        user,
        auth.id,
        OpenStackAuthenticate(cloud_id=cloud.id, method="password", username="person", password="PRIVATE-PASSWORD"),
    )
    assert service.catalogue(user, auth.id) == []
    assert [item["project_id"] for item in service.project_options(user, auth.id)] == ["project-a"]
    second_context = service.activate(user, auth.id, connection.id, "project-a", target["target_id"], None)
    assert second_context == first_context
    assert db_session.query(OpenStackProjectContext).count() == 1


def test_managed_endpoint_is_associated_by_catalog_url_and_reused_by_execution(db_session, setup_cloud):
    endpoint = StorageEndpoint(
        name="Managed S3",
        endpoint_url="https://s3.example.test",
        region="managed-region",
        provider="ceph",
        features_config="features:\n  usage:\n    enabled: true\n  metrics:\n    enabled: true\n",
    )
    db_session.add(endpoint)
    db_session.commit()

    user, target, cloud = setup_cloud
    auth, _ = authenticated(db_session, user)
    service = OpenStackService(db_session)
    connection = service.authenticate(
        user,
        auth.id,
        OpenStackAuthenticate(cloud_id=cloud.id, method="password", username="person", password="PRIVATE-PASSWORD"),
    )
    access = service.project_access(user, auth.id, connection.id, "project-a")
    assert access["targets"][0]["storage_endpoint_id"] == endpoint.id
    assert access["targets"][0]["storage_endpoint_name"] == "Managed S3"
    assert access["targets"][0]["allowed"] is True

    context_id = service.activate(user, auth.id, connection.id, "project-a", target["target_id"], None)
    execution = service.resolve(user, auth.id, context_id)
    assert execution.storage_endpoint_id == endpoint.id
    assert execution.storage_endpoint is endpoint
    assert execution.session_endpoint == target["endpoint_url"]
    assert execution.session_region == target["region_id"]

    context = service.catalogue(user, auth.id)[0]
    assert context.endpoint_id == endpoint.id
    assert context.endpoint_name == "Managed S3"
    assert context.endpoint_provider == "ceph"
    assert context.endpoint_url == target["endpoint_url"]
    assert context.storage_endpoint_capabilities["usage"] is True
    assert context.storage_endpoint_capabilities["metrics"] is True
    assert context.capabilities.admin_api_capable is False


def test_managed_endpoint_association_is_dynamic_for_existing_openstack_context(db_session, setup_cloud):
    service, user, auth, _, context_id = connect(db_session, setup_cloud)
    assert service.resolve(user, auth.id, context_id).storage_endpoint is None

    endpoint = StorageEndpoint(
        name="Managed later",
        endpoint_url="https://s3.example.test",
        region="region-a",
        provider="ceph",
    )
    db_session.add(endpoint)
    db_session.commit()

    execution = service.resolve(user, auth.id, context_id)
    assert execution.storage_endpoint_id == endpoint.id
    assert service.catalogue(user, auth.id)[0].endpoint_id == endpoint.id


def test_managed_endpoints_only_keeps_unmanaged_target_visible_but_rejects_activation(db_session, setup_cloud):
    user, target, cloud = setup_cloud
    cloud.managed_endpoints_only = True
    db_session.commit()
    auth, _ = authenticated(db_session, user)
    service = OpenStackService(db_session)
    connection = service.authenticate(
        user,
        auth.id,
        OpenStackAuthenticate(cloud_id=cloud.id, method="password", username="person", password="PRIVATE-PASSWORD"),
    )

    access = service.project_access(user, auth.id, connection.id, "project-a")
    assert len(access["targets"]) == 1
    assert access["targets"][0]["allowed"] is False
    assert access["targets"][0]["storage_endpoint_id"] is None
    with pytest.raises(OpenStackError) as caught:
        service.activate(user, auth.id, connection.id, "project-a", target["target_id"], None)
    assert caught.value.code == "endpoint_not_allowed"


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
    endpoint = StorageEndpoint(
        name="Managed S3",
        endpoint_url="https://s3.example.test",
        region="region-a",
        provider="ceph",
    )
    db_session.add(endpoint)
    db_session.commit()
    execution = service.resolve(user, auth.id, ctx)
    assert execution.storage_endpoint_id == endpoint.id
    # Even unrelated endpoint identities or accidental RGW metadata must not
    # turn an associated OpenStack project into a managed Ceph identity.
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
        user, _, cloud = setup_cloud
        service.save_cloud(OpenStackCloudWrite(name=cloud.name, auth_url=cloud.auth_url, enabled=False), cloud.id)
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
    monkeypatch.setattr(KeystoneClient, "project_access", Mock(side_effect=OpenStackError("provider_unavailable", "Unavailable", 502)))
    with pytest.raises(OpenStackError) as caught: service.resolve(user, auth.id, ctx)
    assert caught.value.status == 502
    monkeypatch.setattr(KeystoneClient, "project_access", lambda *args: {
        "targets": [setup_cloud[1].copy()],
        "credentials": [{"access": "OTHER", "secret": "other", "expires_at": utcnow() + timedelta(minutes=10)}],
    })
    with pytest.raises(OpenStackError): service.resolve(user, auth.id, ctx)
    assert db_session.scalar(select(OpenStackProjectCredential.id)) is None


def test_key_selection_and_catalog_target_are_explicit(db_session, setup_cloud, monkeypatch):
    service, user, auth, connection, _ = connect(db_session, setup_cloud)
    monkeypatch.setattr(KeystoneClient, "project_access", lambda self, identity, project: {
        "targets": [setup_cloud[1].copy()],
        "credentials": [
            {"access": key, "secret": key, "expires_at": identity.expires_at} for key in ("A", "B")
        ],
    })
    with pytest.raises(OpenStackError) as caught: service.activate(user, auth.id, connection.id, "project-a", setup_cloud[1]["target_id"], None)
    assert caught.value.code == "credential_selection_required"
    with pytest.raises(OpenStackError): service.activate(user, auth.id, connection.id, "project-a", "missing-target", "A")
    with pytest.raises(OpenStackError): service.activate(user, auth.id, connection.id, "different-project", setup_cloud[1]["target_id"], "A")
    assert service.activate(user, auth.id, connection.id, "project-a", setup_cloud[1]["target_id"], "B").startswith("os-")


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
    user, _, cloud = setup_cloud
    auth, _ = authenticated(db_session, user)
    def authenticate(*args):
        OpenStackService(db_session).save_cloud(OpenStackCloudWrite(name=cloud.name, auth_url=cloud.auth_url, enabled=True), cloud.id)
        db_session.commit()
        return KeystoneIdentity("late-token", "ks-user", "Name", utcnow() + timedelta(minutes=10))
    monkeypatch.setattr(KeystoneClient, "authenticate", authenticate)
    with pytest.raises(OpenStackError) as caught:
        OpenStackService(db_session).authenticate(user, auth.id, OpenStackAuthenticate(cloud_id=cloud.id, method="token", token="supplied"))
    assert caught.value.code == "configuration_changed"
    assert db_session.scalar(select(OpenStackSession.id)) is None


def test_openstack_all_users_group_grants_implicit_access(db_session):
    cloud = OpenStackService(db_session).save_cloud(OpenStackCloudWrite(
        name="Global Cloud",
        auth_url="https://global-identity.example.test/v3",
        enabled=True,
    ))
    group = UiGroup(name="All users", system_key="all_users")
    eligible = User(
        email="implicit@example.test",
        hashed_password="x",
        role="ui_user",
        is_active=True,
    )
    inactive = User(
        email="inactive@example.test",
        hashed_password="x",
        role="ui_user",
        is_active=False,
    )
    ui_none = User(
        email="none@example.test",
        hashed_password="x",
        role="ui_none",
        is_active=True,
    )
    db_session.add_all([group, eligible, inactive, ui_none])
    db_session.flush()
    from app.db.openstack import cloud_groups

    db_session.execute(cloud_groups.insert().values(cloud_id=cloud.id, group_id=group.id))
    db_session.commit()

    service = EffectiveAccessService(db_session)
    assert service.can_connect_openstack_cloud(eligible, cloud) is True
    assert service.can_connect_openstack_cloud(inactive, cloud) is False
    assert service.can_connect_openstack_cloud(ui_none, cloud) is False
    assert db_session.scalar(
        select(UserUiGroup.id).where(
            UserUiGroup.user_id == eligible.id,
            UserUiGroup.group_id == group.id,
        )
    ) is None
    assert group.id in service.resolve_user(eligible).group_ids


def test_removing_direct_openstack_access_invalidates_session(db_session, setup_cloud):
    service, user, _, _, _ = connect(db_session, setup_cloud)
    session = db_session.scalar(select(OpenStackSession))
    assert session is not None and session.token is not None

    UserAssociationsService(db_session).set_openstack_cloud_links(user, [])
    db_session.commit()
    db_session.refresh(session)

    assert session.token is None


def test_catalog_target_change_requires_explicit_reactivation(db_session, setup_cloud, monkeypatch):
    service, user, auth, _, ctx = connect(db_session, setup_cloud)
    credential = db_session.scalar(select(OpenStackProjectCredential))
    credential.validated_at = utcnow() - timedelta(seconds=61)
    db_session.commit()
    changed = {**setup_cloud[1], "endpoint_url": "https://moved-s3.example.test"}
    monkeypatch.setattr(KeystoneClient, "project_access", lambda self, identity, project: {
        "targets": [changed],
        "credentials": [{
            "access": "EC2-ACCESS", "secret": "PRIVATE-EC2-SECRET", "expires_at": identity.expires_at,
        }],
    })
    with pytest.raises(OpenStackError) as caught:
        service.resolve(user, auth.id, ctx)
    assert caught.value.code == "reauthentication_required"
    assert db_session.scalar(select(OpenStackProjectCredential.id)) is None


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


@pytest.mark.parametrize("change", ["reconnect", "region"])
def test_running_executor_cannot_follow_reauthentication_or_region_changes(db_session, setup_cloud, monkeypatch, change):
    service, user, auth, connection, ctx = connect(db_session, setup_cloud)
    original = service.resolve(user, auth.id, ctx)
    original_fingerprint = s3_execution_cache_key(original)
    original.access_validator()
    if change == "reconnect":
        service.disconnect(user, auth.id, connection.id)
        connection = service.authenticate(user, auth.id, OpenStackAuthenticate(
            cloud_id=setup_cloud[2].id, method="token", token="new-authentication",
        ))
        next_ctx = service.activate(user, auth.id, connection.id, "project-a", setup_cloud[1]["target_id"], None)
        assert next_ctx == ctx
    else:
        region_b = {
            **setup_cloud[1],
            "target_id": "catalog-s3-region-b",
            "region_id": "region-b",
            "endpoint_url": "https://s3-b.example.test",
        }
        monkeypatch.setattr(KeystoneClient, "project_access", lambda self, identity, project: {
            "targets": [setup_cloud[1].copy(), region_b],
            "credentials": [{
                "access": "EC2-ACCESS", "secret": "PRIVATE-EC2-SECRET", "expires_at": identity.expires_at,
            }],
        })
        next_ctx = service.activate(user, auth.id, connection.id, "project-a", region_b["target_id"], None)
        assert next_ctx != ctx
    assert s3_execution_cache_key(service.resolve(user, auth.id, next_ctx)) != original_fingerprint
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
    user, target, cloud = setup_cloud
    credentials = authenticate_ui_client(client, db_session, user)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)
    response = client.post("/api/me/openstack/connections", json={"cloud_id": cloud.id, "method": "password", "username": "p", "password": "secret"}, headers=headers)
    assert response.status_code == 200, response.text
    connection_id = response.json()["id"]
    assert "PRIVATE-" not in response.text
    access = client.get(f"/api/me/openstack/connections/{connection_id}/projects/project-a/access")
    assert access.status_code == 200, access.text
    assert access.json() == {
        "targets": [{
            **target,
            "storage_endpoint_id": None,
            "storage_endpoint_name": None,
            "allowed": True,
        }],
        "access_keys": ["EC2-ACCESS"],
    }
    activation = client.post(f"/api/me/openstack/connections/{connection_id}/contexts", json={"project_id": "project-a", "target_id": target["target_id"]}, headers=headers)
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
    assert list_buckets.call_args.kwargs["endpoint"] == target["endpoint_url"]
    assert list_buckets.call_args.kwargs["region"] == target["region_id"]


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


def test_keystone_catalog_prefers_s3_and_public_per_region(monkeypatch):
    monkeypatch.setattr(
        "app.services.keystone_client.validate_openstack_catalog_s3_endpoint",
        lambda value: value.rstrip("/"),
    )
    catalog = [
        {
            "type": "object-store",
            "name": "Swift compatibility",
            "endpoints": [{
                "id": "object-region-c", "region_id": "region-c", "interface": "public",
                "url": "https://object.example.test",
            }],
        },
        {
            "type": "s3",
            "name": "S3 API",
            "endpoints": [
                {"id": "internal-a", "region_id": "region-a", "interface": "internal", "url": "https://internal-a.example.test"},
                {"id": "public-a", "region_id": "region-a", "interface": "public", "url": "https://public-a.example.test/"},
                {"id": "public-b", "region_id": "region-b", "interface": "public", "url": "https://public-b.example.test"},
            ],
        },
    ]

    assert KeystoneClient._catalog_targets(catalog) == [
        {
            "target_id": "public-a", "region_id": "region-a", "interface": "public",
            "service_type": "s3", "service_name": "S3 API", "endpoint_url": "https://public-a.example.test",
        },
        {
            "target_id": "public-b", "region_id": "region-b", "interface": "public",
            "service_type": "s3", "service_name": "S3 API", "endpoint_url": "https://public-b.example.test",
        },
    ]


def test_keystone_catalog_object_store_fallback_rejects_swift_paths(monkeypatch):
    monkeypatch.setattr(
        "app.services.keystone_client.validate_openstack_catalog_s3_endpoint",
        lambda value: value.rstrip("/"),
    )
    catalog = [{
        "type": "object-store",
        "name": "Object Storage",
        "endpoints": [
            {"id": "swift", "region_id": "swift-region", "interface": "public", "url": "https://object.example.test/v1/AUTH_project"},
            {"id": "direct", "region_id": "s3-region", "interface": "public", "url": "https://s3-compatible.example.test"},
        ],
    }]

    assert KeystoneClient._catalog_targets(catalog) == [{
        "target_id": "direct", "region_id": "s3-region", "interface": "public",
        "service_type": "object-store", "service_name": "Object Storage", "endpoint_url": "https://s3-compatible.example.test",
    }]


def test_keystone_catalog_trusts_admin_configured_private_s3_target():
    catalog = [{
        "type": "s3",
        "name": "Internal S3",
        "endpoints": [{
            "id": "internal-s3", "region_id": "private-region", "interface": "internal",
            "url": "https://10.42.0.15:9443/",
        }],
    }]

    assert KeystoneClient._catalog_targets(catalog) == [{
        "target_id": "internal-s3", "region_id": "private-region", "interface": "internal",
        "service_type": "s3", "service_name": "Internal S3", "endpoint_url": "https://10.42.0.15:9443",
    }]


def test_keystone_catalog_still_rejects_non_https_s3_target():
    catalog = [{
        "type": "s3",
        "name": "S3",
        "endpoints": [{
            "id": "insecure-s3", "region_id": "region-a", "interface": "public",
            "url": "http://s3.example.test",
        }],
    }]

    assert KeystoneClient._catalog_targets(catalog) == []


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
