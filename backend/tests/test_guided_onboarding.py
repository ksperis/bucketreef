# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError
from sqlalchemy.orm import sessionmaker

from app.db import (
    AccountIAMUser, AppSetting, AuditLog, OnboardingJourney, S3Account, S3Connection,
    StorageEndpoint, User, UserRole, UserS3Account, PortalStorageSpaceMetadata,
)
from app.models.app_settings import AppSettings, GeneralFeatureLock, GeneralFeatureLocks
from app.models.onboarding import OnboardingApply, OnboardingAttestation, OnboardingDraft, OnboardingSave
from app.services import app_settings_service as settings_service
from app.services import onboarding_service as progress_module
from app.services import onboarding_setup_service as setup_service
from app.services.onboarding_service import OnboardingError, OnboardingService, ORGANIZATION_CHECKS, REQUIRED_FEATURES
from app.services.portal_service import PortalService
from app.services.s3_connections_service import S3ConnectionsService
from app.utils.time import utcnow
from tests.s3_account_factory import make_s3_account


@pytest.fixture
def guided(db_session, monkeypatch):
    settings = AppSettings()
    db_session.add(AppSetting(key="default", payload_json=settings.model_dump_json()))
    db_session.commit()
    monkeypatch.setattr(settings_service, "_open_settings_session", sessionmaker(bind=db_session.get_bind()))
    return OnboardingService(db_session)


def actor(db, *, role=UserRole.UI_SUPERADMIN.value, **values):
    user = User(email=f"{uuid4().hex}@example.test", full_name="Pilot", hashed_password="test-only",
                role=role, is_active=True, **values)
    db.add(user)
    db.commit()
    return user


def endpoint(db, **values):
    row = StorageEndpoint(name=f"Endpoint {uuid4().hex[:8]}", endpoint_url="https://storage.example.test",
                          provider="ceph", verify_tls=True, **values)
    db.add(row)
    db.commit()
    return row


def connection(db, user, *, workspace="browser", **values):
    ep = endpoint(db)
    row = S3Connection(name="Private storage", created_by_user_id=user.id, storage_endpoint_id=ep.id,
                       access_key_id="test-access", secret_access_key="test-secret", is_active=True,
                       access_browser=workspace == "browser", access_manager=workspace == "manager", **values)
    db.add(row)
    db.commit()
    return row


def save(service, user, **values):
    return service.save(user, uuid4(), OnboardingSave(draft=OnboardingDraft(**values)))


def apply(service, user, journey, **credentials):
    return service.apply(user, journey.id, OnboardingApply(
        revision=journey.revision, confirmed=True, review_token=journey.preview.review_token, **credentials,
    ))


def configure_existing(service, user, **draft):
    return apply(service, user, save(service, user, **draft))


def locks(monkeypatch, field, value):
    result = GeneralFeatureLocks()
    setattr(result, field, GeneralFeatureLock(forced=True, value=value, source=f"FEATURE_{field.upper()}"))
    monkeypatch.setattr(settings_service, "get_general_feature_locks", lambda: result)
    monkeypatch.setattr(progress_module, "get_general_feature_locks", lambda: result)


def test_configuration_is_not_usage_and_dismissal_is_individual(guided, db_session):
    user, other = actor(db_session), actor(db_session)
    conn = connection(db_session, user)
    assert guided.status(user).complete is False
    journey = configure_existing(guided, user, connection_id=conn.id)
    assert journey.configured and not journey.usage_validated and not journey.ready
    assert guided.dismiss(user).dismissed
    assert not guided.status(other).dismissed
    assert guided.dismiss(user, False).journeys[0].id == journey.id


def test_preview_and_status_do_not_probe_storage_or_create_journeys(guided, db_session, monkeypatch):
    user = actor(db_session)
    monkeypatch.setattr(setup_service, "get_s3_client", lambda **_: pytest.fail("unexpected network check"))
    preview = guided.preview_draft(user, OnboardingDraft(endpoint_url="https://storage.example.test"))
    assert "create_private_connection" in preview.changes
    assert len(preview.review_token) == 64
    assert not guided.status(user).complete
    assert db_session.query(OnboardingJourney).count() == 0
    assert db_session.query(S3Connection).count() == 0
    assert db_session.query(AuditLog).count() == 0


@pytest.mark.parametrize("workspace,field", [(workspace, field) for workspace, fields in REQUIRED_FEATURES.items()
                                           for field in fields if field not in {"browser_root_enabled", "browser_portal_enabled"}])
def test_env_false_blocks_before_any_configuration(guided, db_session, monkeypatch, workspace, field):
    user = actor(db_session)
    locks(monkeypatch, field, False)
    kind = "account" if workspace == "portal" else "endpoint" if workspace == "ceph-admin" else "connection"
    journey = save(guided, user, workspace=workspace, resource_kind=kind,
                   endpoint_url="https://storage.example.test", grant_access=True)
    monkeypatch.setattr(setup_service.OnboardingSetupService, "configure", lambda *_: pytest.fail("blocked operation ran"))
    with pytest.raises(OnboardingError, match="env_locked"):
        apply(guided, user, journey)
    assert db_session.query(StorageEndpoint).count() == 0


def test_forced_true_is_not_written_to_persisted_settings(guided, db_session, monkeypatch):
    row = db_session.get(AppSetting, "default")
    settings = AppSettings.model_validate_json(row.payload_json)
    settings.general.portal_enabled = False
    row.payload_json = settings.model_dump_json()
    db_session.commit()
    locks(monkeypatch, "portal_enabled", True)
    assert settings_service.enable_onboarding_features(db_session, ("portal_enabled",)) == []
    assert settings_service.load_app_settings_for_db(db_session).general.portal_enabled
    assert not AppSettings.model_validate_json(row.payload_json).general.portal_enabled


@pytest.mark.parametrize("workspace", ["browser", "manager", "portal", "ceph-admin"])
def test_only_minimal_features_are_enabled(guided, db_session, workspace):
    row = db_session.get(AppSetting, "default")
    settings = AppSettings.model_validate_json(row.payload_json)
    all_fields = set().union(*REQUIRED_FEATURES.values())
    for field in all_fields:
        setattr(settings.general, field, False)
    before = settings.model_dump()
    row.payload_json = settings.model_dump_json()
    db_session.commit()
    changed = settings_service.enable_onboarding_features(db_session, REQUIRED_FEATURES[workspace])
    after = settings_service.load_app_settings_for_db(db_session).model_dump()
    assert set(changed) == set(REQUIRED_FEATURES[workspace])
    for field in REQUIRED_FEATURES[workspace]:
        before["general"][field] = True
    assert before == after
    with pytest.raises(ValueError, match="Unsupported"):
        settings_service.enable_onboarding_features(db_session, ("require_passkey_for_admins",))


def test_new_private_connection_is_checkpointed_and_retry_does_not_duplicate(guided, db_session, monkeypatch):
    user = actor(db_session, can_create_manual_private_connections=True)
    ep = endpoint(db_session)
    monkeypatch.setattr(S3ConnectionsService, "_refresh_detected_capabilities", lambda *_: None)
    journey = save(guided, user, endpoint_id=ep.id)
    created = apply(guided, user, journey, access_key="supplied-access", secret_key="supplied-secret")
    assert created.configured and not created.usage_validated
    retried = apply(guided, user, journey, access_key="supplied-access", secret_key="supplied-secret")
    assert retried.resources == created.resources
    assert db_session.query(S3Connection).count() == 1
    row = db_session.get(S3Connection, created.resources["connection_id"])
    assert not row.is_shared and row.created_by_user_id == user.id
    assert row.access_browser and not row.access_manager
    progress = db_session.get(OnboardingJourney, journey.id)
    serialized = created.model_dump_json() + progress.draft_json + progress.resources_json + progress.evidence_json
    assert "supplied-access" not in serialized and "supplied-secret" not in serialized


@pytest.mark.parametrize("source,workspace", [("browser", "manager"), ("manager", "browser")])
def test_existing_private_connection_workspace_activation_requires_reviewed_consent(guided, db_session, monkeypatch, source, workspace):
    user = actor(db_session)
    conn = connection(db_session, user, workspace=source)
    monkeypatch.setattr(S3ConnectionsService, "_refresh_detected_capabilities", lambda *_: None)
    journey = save(guided, user, workspace=workspace, connection_id=conn.id,
                   endpoint_id=conn.storage_endpoint_id)
    # The UI renders consent from proposed changes, before consent is granted.
    assert "enable_connection_workspace" in journey.preview.changes
    assert "explicit_access_required" in journey.preview.blockers
    with pytest.raises(OnboardingError, match="explicit_access_required"):
        apply(guided, user, journey)
    db_session.refresh(conn)
    assert not getattr(conn, f"access_{workspace}")

    reviewed = guided.save(user, journey.id, OnboardingSave(
        revision=journey.revision,
        draft=journey.draft.model_copy(update={"grant_access": True}),
    ))
    assert not reviewed.preview.blockers
    result = apply(guided, user, reviewed)
    db_session.refresh(conn)
    assert result.configured and result.draft.connection_id == conn.id
    assert conn.access_browser and conn.access_manager
    assert not conn.is_shared and conn.created_by_user_id == user.id
    assert db_session.query(S3Connection).count() == 1


def test_restricted_bucket_prefix_verification_uses_exact_private_identity(guided, db_session, monkeypatch):
    user = actor(db_session)
    conn = connection(db_session, user)
    calls = []
    def client(**kwargs):
        assert kwargs["access_key"] == "test-access"
        assert kwargs["secret_key"] == "test-secret"
        return SimpleNamespace(list_objects_v2=lambda **kw: calls.append(kw))
    monkeypatch.setattr(setup_service, "get_s3_client", client)
    prefix = " +/reserved%2F/ /"
    journey = configure_existing(guided, user, connection_id=conn.id, bucket="limited-bucket", prefix=prefix)
    result = guided.verify(user, journey.id, journey.revision)
    assert calls == [{"Bucket": "limited-bucket", "Prefix": prefix, "MaxKeys": 1}]
    assert result.usage_validated and result.evidence["source"] == "automatic"
    assert not result.ready
    assert "fingerprint" not in result.evidence


def test_browser_folder_prefix_is_never_silently_normalized(guided, db_session):
    user = actor(db_session)
    conn = connection(db_session, user)
    draft = OnboardingDraft(connection_id=conn.id, bucket="limited-bucket", prefix=" +/reserved%2F/ ")
    preview = guided.preview_draft(user, draft)
    assert "browser_folder_prefix_required" in preview.blockers
    assert draft.prefix == " +/reserved%2F/ "
    folder = draft.model_copy(update={"prefix": " +/reserved%2F/ /"})
    assert not guided.preview_draft(user, folder).blockers
    from urllib.parse import parse_qs, urlsplit
    assert parse_qs(urlsplit(guided.open_url(folder)).query)["prefix"] == [folder.prefix]


def test_workspace_visit_preserves_validation_but_key_rotation_invalidates_it(guided, db_session, monkeypatch):
    user = actor(db_session)
    conn = connection(db_session, user)
    monkeypatch.setattr(setup_service, "get_s3_client", lambda **kwargs: SimpleNamespace(list_buckets=lambda: {}))
    journey = configure_existing(guided, user, connection_id=conn.id)
    assert guided.verify(user, journey.id, journey.revision).usage_validated

    setup_service.S3ConnectionsService(db_session).touch_usage(conn)
    db_session.expire_all()
    assert guided.status(user).journeys[0].usage_validated

    conn.secret_access_key = "rotated-test-secret"
    db_session.commit()
    result = guided.status(user).journeys[0]
    assert not result.usage_validated
    assert "rotated-test-secret" not in result.model_dump_json()
    assert "rotated-test-secret" not in db_session.get(OnboardingJourney, journey.id).evidence_json


def test_failed_recheck_clears_success_and_does_not_treat_access_denied_as_success(guided, db_session, monkeypatch):
    user = actor(db_session)
    conn = connection(db_session, user)
    client = SimpleNamespace(list_buckets=lambda: {})
    monkeypatch.setattr(setup_service, "get_s3_client", lambda **_: client)
    journey = configure_existing(guided, user, connection_id=conn.id)
    assert guided.verify(user, journey.id, journey.revision).usage_validated
    def denied():
        raise ClientError({"Error": {"Code": "AccessDenied", "Message": "Denied"}}, "ListBuckets")
    client.list_buckets = denied
    with pytest.raises(ClientError):
        guided.verify(user, journey.id, journey.revision)
    assert not guided.status(user).complete


def test_verification_audits_workflow_transitions_without_probe_details(guided, db_session, monkeypatch):
    user = actor(db_session)
    conn = connection(db_session, user)
    client = SimpleNamespace(list_objects_v2=lambda **_: {})
    monkeypatch.setattr(setup_service, "get_s3_client", lambda **_: client)
    journey = configure_existing(
        guided, user, connection_id=conn.id, bucket="private-bucket-canary",
        prefix="private-object-canary/",
    )
    assert guided.verify(user, journey.id, journey.revision).usage_validated

    def denied(**_kwargs):
        raise ClientError({"Error": {"Code": "AccessDenied", "Message": "secret_key=probe-secret-canary"}}, "ListObjectsV2")

    client.list_objects_v2 = denied
    with pytest.raises(ClientError):
        guided.verify(user, journey.id, journey.revision)
    assert not guided.status(user).complete

    rows = db_session.query(AuditLog).filter(
        AuditLog.action.in_([
            "onboarding.verification_started", "onboarding.verified", "onboarding.verification_failed",
        ])
    ).order_by(AuditLog.id).all()
    assert [(row.action, row.status) for row in rows] == [
        ("onboarding.verification_started", "success"),
        ("onboarding.verified", "success"),
        ("onboarding.verification_started", "success"),
        ("onboarding.verification_failed", "error"),
    ]
    for row in rows:
        assert row.user_id == user.id and row.scope == "admin"
        assert row.entity_type == "onboarding" and row.entity_id == journey.id
        assert row.account_id is None and row.message is None
        assert json.loads(row.metadata_json) == {
            "workflow_id": journey.id, "workspace": "browser", "account_id": None,
        }


def test_onboarding_audit_keeps_account_context(guided, db_session):
    user = actor(db_session)
    account = make_s3_account(db_session, name="Audit account")
    db_session.add(account)
    db_session.commit()
    identifier = str(uuid4())
    guided.audit(user, "verified", identifier, account_id=account.id, workspace="manager")
    row = db_session.query(AuditLog).filter_by(action="onboarding.verified").one()
    assert row.account_id == account.id
    assert json.loads(row.metadata_json)["account_id"] == account.id


def test_cross_admin_isolation_and_no_private_connection_impersonation(guided, db_session):
    user, other = actor(db_session), actor(db_session)
    conn = connection(db_session, user)
    journey = save(guided, user, connection_id=conn.id)
    with pytest.raises(OnboardingError, match="journey_not_found"):
        guided.get(other, journey.id)
    assert not guided.status(other).journeys
    assert conn.id not in [option.id for option in guided.status(other).connections]
    foreign = save(guided, other, connection_id=conn.id, grant_access=True)
    with pytest.raises(OnboardingError, match="connection_unavailable"):
        apply(guided, other, foreign)
    assert conn.created_by_user_id == user.id and not conn.is_shared


def test_preview_does_not_disclose_foreign_private_connection_state(guided, db_session):
    owner, other = actor(db_session), actor(db_session)
    conn = connection(db_session, owner)
    draft = OnboardingDraft(connection_id=conn.id, endpoint_id=conn.storage_endpoint_id, grant_access=True)
    before = guided.preview_draft(other, draft)
    assert before.blockers == ["connection_unavailable"]
    conn.secret_access_key = "rotated-private-test-key"
    conn.is_active = False
    db_session.commit()
    after = guided.preview_draft(other, draft)
    assert after == before


def test_read_only_admin_preview_does_not_inspect_another_profile(guided, db_session, monkeypatch):
    user = actor(db_session, role=UserRole.UI_ADMIN.value)
    monkeypatch.setattr(guided, "target", lambda *_: pytest.fail("Unauthorized profile inspection"))
    result = guided.preview_draft(user, OnboardingDraft(beneficiary_user_id=123))
    assert result.blockers == ["superadmin_required"]
    assert result.changes == []


@pytest.mark.parametrize("role", [UserRole.UI_ADMIN.value, UserRole.UI_USER.value])
def test_only_superadmin_can_configure(guided, db_session, role):
    user = actor(db_session, role=role)
    with pytest.raises(OnboardingError, match="admin_required"):
        save(guided, user)


def test_expiration_and_revocation_invalidate_existing_evidence(guided, db_session, monkeypatch):
    user = actor(db_session)
    conn = connection(db_session, user)
    monkeypatch.setattr(setup_service, "get_s3_client", lambda **_: SimpleNamespace(list_buckets=lambda: {}))
    journey = configure_existing(guided, user, connection_id=conn.id)
    assert guided.verify(user, journey.id, journey.revision).usage_validated
    conn.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    output = guided.status(user).journeys[0]
    assert not output.configured and not output.usage_validated and output.open_url is None
    assert "connection_unavailable" in output.preview.blockers


def test_changed_review_or_revision_cannot_silently_apply(guided, db_session):
    user = actor(db_session)
    conn = connection(db_session, user)
    journey = save(guided, user, connection_id=conn.id)
    conn.name = "Renamed scope"
    db_session.commit()
    with pytest.raises(OnboardingError, match="review_changed"):
        apply(guided, user, journey)
    fresh = guided.output(user, guided.get(user, journey.id))
    result = guided.save(user, journey.id, OnboardingSave(revision=fresh.revision,
                       draft=OnboardingDraft(**{**fresh.draft.model_dump(), "intent": "organization"})))
    with pytest.raises(OnboardingError, match="stale_revision"):
        apply(guided, user, fresh)
    assert result.revision > fresh.revision


def test_objective_changes_keep_resources_and_readiness_is_explicit(guided, db_session):
    user = actor(db_session)
    conn = connection(db_session, user)
    journey = configure_existing(guided, user, connection_id=conn.id, intent="organization")
    for check in ORGANIZATION_CHECKS:
        journey = guided.attest(user, journey.id, OnboardingAttestation(revision=journey.revision, check=check,
                               checked=True, note="Pilot A allowed; pilot B denied; isolation reviewed."))
    assert not journey.ready and not journey.usage_validated
    journey = guided.attest(user, journey.id, OnboardingAttestation(revision=journey.revision, check="usage",
                           checked=True, note="Pilot read an object in its assigned bucket."))
    assert journey.ready and journey.evidence["source"] == "operator"
    changed = guided.save(user, journey.id, OnboardingSave(revision=journey.revision,
                         draft=OnboardingDraft(**{**journey.draft.model_dump(), "intent": "personal"})))
    assert changed.configured and changed.usage_validated
    assert db_session.get(S3Connection, conn.id) is not None
    scoped = guided.save(user, changed.id, OnboardingSave(revision=changed.revision,
                        draft=OnboardingDraft(**{**changed.draft.model_dump(), "bucket": "another-scope"})))
    assert not scoped.usage_validated and not scoped.ready and not scoped.readiness
    assert db_session.get(S3Connection, conn.id) is not None


def test_ceph_admin_does_not_promote_a_standard_user(guided, db_session):
    user, pilot = actor(db_session), actor(db_session, role=UserRole.UI_USER.value)
    ep = endpoint(db_session, ceph_admin_access_key="operator", ceph_admin_secret_key="operator-secret")
    journey = save(guided, user, workspace="ceph-admin", resource_kind="endpoint", endpoint_id=ep.id,
                   beneficiary_user_id=pilot.id, grant_access=True)
    with pytest.raises(OnboardingError, match="ceph_admin_role_required"):
        apply(guided, user, journey)
    assert pilot.role == UserRole.UI_USER.value and not pilot.can_access_ceph_admin


@pytest.mark.parametrize("revocation", ["archive", "credential", "storage_denial", "space_owner"])
def test_portal_check_uses_personal_keys_and_archive_invalidates_evidence(guided, db_session, monkeypatch, revocation):
    from app.services.portal import objects as portal_objects

    user = actor(db_session)
    ep = endpoint(db_session, features_config=json.dumps({"features": {"iam": {"enabled": True}}}))
    account = S3Account(name="Project", rgw_account_id="RGW12345678901234567", storage_endpoint_id=ep.id,
                        rgw_access_key="account-root", rgw_secret_key="root-secret", rgw_user_uid="project-root")
    db_session.add(account)
    db_session.flush()
    db_session.add(UserS3Account(user_id=user.id, account_id=account.id, portal_role="portal_user"))
    db_session.add(AccountIAMUser(user_id=user.id, account_id=account.id, iam_user_id="pilot",
                                 active_access_key="pilot-key", active_secret_key="pilot-secret"))
    space = PortalStorageSpaceMetadata(account_id=account.id, bucket_name="private-files", owner_user_id=user.id,
                                      visibility="private", share_scope="restricted")
    db_session.add(space)
    db_session.commit()
    monkeypatch.setattr(PortalService, "get_portal_credentials", lambda *_: ("pilot-key", "pilot-secret"))
    calls = []
    def client(access_key, secret_key, **kwargs):
        assert access_key == "pilot-key" and secret_key == "pilot-secret"
        return SimpleNamespace(list_objects_v2=lambda **kw: calls.append(kw))
    monkeypatch.setattr(portal_objects, "get_s3_client", client)
    journey = configure_existing(guided, user, workspace="portal", resource_kind="account", account_id=account.id, space_id=space.bucket_name)
    assert journey.configured and not journey.usage_validated
    monkeypatch.setattr(PortalService, "get_portal_credentials", lambda *_: pytest.fail("Read check must not provision or synchronize IAM"))
    monkeypatch.setattr(PortalService, "get_storage_space", lambda *_: pytest.fail("Read check must not fetch privileged bucket statistics"))
    assert guided.verify(user, journey.id, journey.revision).usage_validated
    assert calls == [{"Bucket": "private-files", "MaxKeys": 1}]
    assert guided.status(user).spaces[0].id == "private-files"
    if revocation == "archive":
        space.archived_at = utcnow()
    elif revocation == "space_owner":
        space.owner_user_id = actor(db_session, role=UserRole.UI_USER.value).id
    elif revocation == "credential":
        db_session.query(AccountIAMUser).filter_by(user_id=user.id, account_id=account.id).one().active_secret_key = None
    else:
        def denied(**_kwargs):
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "ListObjectsV2")
        monkeypatch.setattr(portal_objects, "get_s3_client", lambda *_args, **_kwargs: SimpleNamespace(list_objects_v2=denied))
    db_session.commit()
    with pytest.raises((OnboardingError, RuntimeError, ClientError)):
        guided.verify(user, journey.id, journey.revision)
    assert not guided.status(user).journeys[0].usage_validated
    if revocation in {"archive", "space_owner"}:
        assert not guided.status(user).spaces


def test_workspace_links_use_existing_url_contracts():
    assert OnboardingService.open_url(OnboardingDraft(workspace="ceph-admin", resource_kind="endpoint", endpoint_id=8)) == "/ceph-admin?ep=8"
    assert OnboardingService.open_url(OnboardingDraft(workspace="portal", resource_kind="account", account_id=9, space_id="files")) == "/portal/storage-spaces/files?project=9"
    assert OnboardingService.open_url(OnboardingDraft(workspace="manager", resource_kind="account", account_id=9)) == "/manager/buckets?ctx=9"
    assert OnboardingService.open_url(OnboardingDraft(workspace="manager", connection_id=4, bucket="limited-bucket")) == "/manager/buckets/limited-bucket?ctx=conn-4"


def test_ceph_verification_uses_dedicated_identity_without_enabling_provisioning(guided, db_session, monkeypatch):
    user = actor(db_session, can_access_ceph_admin=True)
    ep = endpoint(db_session, ceph_admin_access_key="ceph-operator", ceph_admin_secret_key="operator-secret")
    calls = []
    def rgw(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(get_user_by_access_key=lambda *_args, **_kwargs: {"admin": True})
    monkeypatch.setattr(setup_service, "get_rgw_admin_client", rgw)
    journey = configure_existing(guided, user, workspace="ceph-admin", resource_kind="endpoint", endpoint_id=ep.id)
    result = guided.verify(user, journey.id, journey.revision)
    assert result.usage_validated
    assert calls[0]["access_key"] == "ceph-operator" and calls[0]["endpoint"] == ep.endpoint_url
    assert ep.admin_access_key is None


@pytest.mark.parametrize("workspace,manager,portal", [
    ("manager", None, "portal_user"), ("portal", "account_administrator", None),
])
def test_assignments_preserve_the_other_membership_axis(guided, db_session, monkeypatch, workspace, manager, portal):
    from app.services import users_service

    user, pilot = actor(db_session), actor(db_session, role=UserRole.UI_USER.value)
    ep = endpoint(db_session, features_config=json.dumps({"features": {"iam": {"enabled": True}}}))
    account = S3Account(name="Assigned project", rgw_account_id="RGW12345678901234567", storage_endpoint_id=ep.id,
                       rgw_user_uid="project-root", rgw_access_key="root", rgw_secret_key="root-secret")
    db_session.add(account)
    db_session.flush()
    link = UserS3Account(user_id=pilot.id, account_id=account.id, manager_role=manager, portal_role=portal)
    db_session.add(link)
    db_session.commit()
    # The existing Portal synchronizer is exercised by its own storage tests;
    # keep this orchestration test focused on independent application roles.
    monkeypatch.setattr(users_service, "sync_portal_role_promotions", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(PortalService, "get_portal_credentials", lambda *_: ("pilot-key", "pilot-secret"))
    journey = save(guided, user, workspace=workspace, resource_kind="account", account_id=account.id,
                   beneficiary_user_id=pilot.id, grant_access=True)
    apply(guided, user, journey)
    db_session.refresh(link)
    assert link.manager_role == "account_administrator"
    assert link.portal_role == ("portal_manager" if workspace == "portal" else "portal_user")
    assert pilot.role == UserRole.UI_USER.value and not pilot.can_access_ceph_admin


def test_portal_member_can_prepare_a_private_space_without_becoming_project_manager(guided, db_session):
    user = actor(db_session)
    ep = endpoint(db_session, features_config='features:\n  iam:\n    enabled: true')
    account = S3Account(name="Member project", rgw_account_id="RGW12345678901234567", storage_endpoint_id=ep.id,
                       rgw_user_uid="project-root", rgw_access_key="root", rgw_secret_key="root-secret")
    db_session.add(account)
    db_session.flush()
    db_session.add(UserS3Account(user_id=user.id, account_id=account.id, portal_role="portal_user"))
    db_session.commit()
    result = guided.preview_draft(user, OnboardingDraft(workspace="portal", resource_kind="account",
                                  account_id=account.id, space_name="My files", space_visibility="private"))
    assert "create_storage_space" in result.changes
    assert "grant_portal_access" not in result.changes
    assert "explicit_access_required" not in result.blockers


def test_new_ceph_endpoint_uses_canonical_feature_format(guided, db_session, monkeypatch):
    from app.services.storage_endpoints_service import StorageEndpointsService
    from app.utils.storage_endpoint_features import resolve_feature_flags

    user = actor(db_session, can_access_ceph_admin=True)
    # Serialization permissions are an independent RGW probe, not creation.
    serialize = StorageEndpointsService._serialize
    monkeypatch.setattr(StorageEndpointsService, "_serialize", lambda self, row, **_: serialize(self, row, include_admin_ops_permissions=False))
    journey = save(guided, user, workspace="ceph-admin", resource_kind="endpoint", endpoint_url="https://rgw.example.test")
    result = apply(guided, user, journey, access_key="operator", secret_key="operator-secret")
    assert result.configured
    ep = db_session.get(StorageEndpoint, result.resources["endpoint_id"])
    assert ep.ceph_admin_access_key == "operator"
    assert not resolve_feature_flags(ep).admin_enabled
    assert not resolve_feature_flags(ep).account_enabled


@pytest.mark.parametrize("failure_point", ["after_remote_creation", "after_local_import"])
def test_interrupted_account_creation_resumes_the_same_durable_account(guided, db_session, monkeypatch, failure_point):
    from app.services.s3_accounts_service import S3AccountsService

    user = actor(db_session)
    ep = endpoint(db_session, admin_access_key="provisioner", admin_secret_key="provisioner-secret",
                  features_config='features:\n  admin:\n    enabled: true\n  account:\n    enabled: true')
    remote_accounts = {}
    creations = []
    should_fail = [True]

    def create_remote(*, account_id, account_name):
        creations.append(account_id)
        remote_accounts[account_id] = {"name": account_name}

    remote = SimpleNamespace(
        get_account=lambda account_id, **_: remote_accounts.get(account_id),
        create_account=create_remote,
    )
    monkeypatch.setattr(S3AccountsService, "_admin_for_endpoint", lambda *_args, **_kwargs: remote)

    def import_account(service, imports):
        if failure_point == "after_remote_creation" and should_fail[0]:
            should_fail[0] = False
            raise RuntimeError("simulated interrupted import")
        item = imports[0]
        account = S3Account(name=item.name, rgw_account_id=item.rgw_account_id, storage_endpoint_id=ep.id,
                           rgw_user_uid=f"{item.rgw_account_id}-root", rgw_access_key="root", rgw_secret_key="root-secret")
        service.db.add(account)
        service.db.commit()

    def detail(service, account_id, **_):
        if failure_point == "after_local_import" and should_fail[0]:
            should_fail[0] = False
            raise RuntimeError("simulated interrupted response")
        return SimpleNamespace(id=account_id)

    monkeypatch.setattr(S3AccountsService, "import_accounts", import_account)
    monkeypatch.setattr(S3AccountsService, "get_account_detail", detail)
    journey = save(guided, user, workspace="manager", resource_kind="account", endpoint_id=ep.id,
                   name="Resumable project", grant_access=True)
    with pytest.raises(RuntimeError, match="simulated interrupted"):
        apply(guided, user, journey)
    pending = guided.output(user, guided.get(user, journey.id))
    assert pending.pending_step == "account"
    assert pending.resources["rgw_account_id"] == creations[0]
    assert not pending.preview.blockers
    assert "resume_rgw_account" in guided.preview_draft(user, pending.draft, pending.id).changes
    completed = apply(guided, user, pending)
    assert completed.configured and completed.pending_step is None
    assert creations == [pending.resources["rgw_account_id"]]
    assert db_session.query(S3Account).count() == 1
    assert db_session.get(S3Account, completed.draft.account_id).rgw_account_id == creations[0]
