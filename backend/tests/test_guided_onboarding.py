# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.db import (
    AppSetting,
    AuditLog,
    OnboardingJourney,
    S3Account,
    S3Connection,
    StorageEndpoint,
    User,
    UserRole,
    UserS3Account,
)
from app.models.app_settings import AppSettings, GeneralFeatureLock, GeneralFeatureLocks
from app.models.onboarding import OnboardingApply, OnboardingDraft, OnboardingSave
from app.models.storage_endpoint import (
    StorageEndpointCredentialCheck,
    StorageEndpointCredentialChecks,
    StorageEndpointFeatureDetectionResult,
)
from app.services import app_settings_service as settings_service
from app.services import onboarding_service as progress_module
from app.services import onboarding_setup_service as setup_service
from app.services import users_service as users_module
from app.services.onboarding_service import OnboardingError, OnboardingService, REQUIRED_FEATURES
from app.services.s3_connections_service import S3ConnectionsService
from app.services.storage_endpoints_service import StorageEndpointsService
from app.utils.time import utcnow
from tests.s3_account_factory import make_s3_account


@pytest.fixture
def guided(db_session, monkeypatch):
    db_session.add(AppSetting(key="default", payload_json=AppSettings().model_dump_json()))
    db_session.commit()
    monkeypatch.setattr(
        settings_service,
        "_open_settings_session",
        sessionmaker(bind=db_session.get_bind()),
    )
    return OnboardingService(db_session)


def actor(db, *, role=UserRole.UI_SUPERADMIN.value, **values):
    user = User(
        email=f"{uuid4().hex}@example.test",
        full_name="Pilot",
        hashed_password="test-only",
        role=role,
        is_active=True,
        **values,
    )
    db.add(user)
    db.commit()
    return user


def endpoint(db, **values):
    row = StorageEndpoint(
        name=f"Endpoint {uuid4().hex[:8]}",
        endpoint_url=f"https://{uuid4().hex[:8]}.example.test",
        provider="ceph",
        verify_tls=True,
        is_editable=True,
        **values,
    )
    db.add(row)
    db.commit()
    return row


def detection(*, admin=True, account=True, ceph_admin="valid"):
    return StorageEndpointFeatureDetectionResult(
        admin=admin,
        account=account,
        usage=True,
        metrics=True,
        credential_checks=StorageEndpointCredentialChecks(
            admin=StorageEndpointCredentialCheck(
                status="valid" if admin else "denied"
            ),
            ceph_admin=StorageEndpointCredentialCheck(status=ceph_admin),
        ),
    )


def save(service, user, **values):
    return service.save(
        user,
        uuid4(),
        OnboardingSave(draft=OnboardingDraft(**values)),
    )


def apply(service, user, journey, **credentials):
    return service.apply(
        user,
        journey.id,
        OnboardingApply(
            revision=journey.revision,
            confirmed=True,
            review_token=journey.preview.review_token,
            **credentials,
        ),
    )


def lock_feature(monkeypatch, field):
    locks = GeneralFeatureLocks()
    setattr(
        locks,
        field,
        GeneralFeatureLock(
            forced=True,
            value=False,
            source=f"FEATURE_{field.upper()}",
        ),
    )
    monkeypatch.setattr(settings_service, "get_general_feature_locks", lambda: locks)
    monkeypatch.setattr(progress_module, "get_general_feature_locks", lambda: locks)


def account_feature_config(*, iam=True):
    return (
        "features:\n"
        "  admin:\n    enabled: true\n"
        "  account:\n    enabled: true\n"
        f"  iam:\n    enabled: {'true' if iam else 'false'}\n"
    )


def test_status_is_per_user_and_legacy_configured_journey_counts_until_v2_starts(guided, db_session):
    user = actor(db_session)
    other = actor(db_session)
    legacy = OnboardingJourney(
        id=str(uuid4()),
        user_id=user.id,
        draft_json=json.dumps({"workspace": "manager"}),
        resources_json="{}",
        configured_at=utcnow(),
    )
    db_session.add(legacy)
    db_session.commit()

    assert guided.status(user).complete is True
    assert guided.status(user).journeys == []
    assert guided.status(other).complete is False

    draft = save(
        guided,
        user,
        endpoint_url="https://new.example.test",
        private_connection=True,
    )
    assert guided.status(user).complete is False
    assert guided.status(user).journeys[0].id == draft.id
    assert guided.dismiss(user).dismissed is True
    assert guided.status(other).dismissed is False
    assert guided.dismiss(user, False).dismissed is False


def test_preview_is_secret_free_and_does_not_mutate_storage(guided, db_session):
    preview = guided.preview_draft(
        actor(db_session),
        OnboardingDraft(
            endpoint_url="https://storage.example.test",
            private_connection=True,
        ),
    )

    assert "create_ceph_endpoint" in preview.changes
    assert "create_private_connection" in preview.changes
    assert preview.blockers == []
    assert len(preview.review_token) == 64
    assert db_session.query(OnboardingJourney).count() == 0
    assert db_session.query(StorageEndpoint).count() == 0
    assert db_session.query(S3Connection).count() == 0
    assert db_session.query(AuditLog).count() == 0
    assert "secret" not in preview.model_dump_json().lower()


def test_preview_requires_a_selected_setup_option(guided, db_session):
    result = guided.preview_draft(
        actor(db_session),
        OnboardingDraft(endpoint_url="https://storage.example.test"),
    )
    assert result.blockers == ["selection_required"]


def test_environment_lock_blocks_before_setup_runs(guided, db_session, monkeypatch):
    user = actor(db_session)
    lock_feature(monkeypatch, "browser_enabled")
    journey = save(
        guided,
        user,
        endpoint_url="https://storage.example.test",
        private_connection=True,
    )
    monkeypatch.setattr(
        setup_service.OnboardingSetupService,
        "configure",
        lambda *_args, **_kwargs: pytest.fail("blocked setup ran"),
    )

    with pytest.raises(OnboardingError, match="env_locked"):
        apply(
            guided,
            user,
            journey,
            private_access_key="private-ak",
            private_secret_key="private-sk",
        )
    assert db_session.query(StorageEndpoint).count() == 0


def test_private_only_new_endpoint_discards_invalid_optional_admin_credentials(
    guided, db_session, monkeypatch
):
    user = actor(db_session)
    monkeypatch.setattr(
        guided.endpoints,
        "detect_features",
        lambda *_args, **_kwargs: detection(
            admin=False, account=False, ceph_admin="not_configured"
        ),
    )
    monkeypatch.setattr(S3ConnectionsService, "_refresh_detected_capabilities", lambda *_: None)
    original_serialize = StorageEndpointsService._serialize
    monkeypatch.setattr(
        StorageEndpointsService,
        "_serialize",
        lambda self, row, **_kwargs: original_serialize(
            self, row, include_admin_ops_permissions=False
        ),
    )
    journey = save(
        guided,
        user,
        endpoint_url="https://private-only.example.test",
        private_connection=True,
    )

    result = apply(
        guided,
        user,
        journey,
        endpoint_access_key="bad-admin-ak",
        endpoint_secret_key="bad-admin-sk",
        private_access_key="private-ak",
        private_secret_key="private-sk",
    )

    assert result.configured
    ep = db_session.get(StorageEndpoint, result.resources["endpoint_id"])
    assert ep.admin_access_key is None and ep.admin_secret_key is None
    connection = db_session.get(S3Connection, result.resources["connection_id"])
    assert connection.created_by_user_id == user.id
    assert connection.is_shared is False
    assert connection.access_browser and connection.access_manager
    assert user.can_create_manual_private_connections

    progress = db_session.get(OnboardingJourney, journey.id)
    serialized = " ".join(
        [
            result.model_dump_json(),
            progress.draft_json,
            progress.resources_json,
            progress.evidence_json,
            progress.readiness_json,
            *[row.metadata_json or "" for row in db_session.query(AuditLog).all()],
        ]
    )
    for secret in ("bad-admin-ak", "bad-admin-sk", "private-ak", "private-sk"):
        assert secret not in serialized


def test_manager_and_portal_share_one_sample_account_with_independent_roles(
    guided, db_session, monkeypatch
):
    user = actor(db_session)
    ep = endpoint(
        db_session,
        admin_access_key="admin-ak",
        admin_secret_key="admin-sk",
        features_config=account_feature_config(iam=True),
    )
    monkeypatch.setattr(guided.endpoints, "detect_features", lambda *_args, **_kwargs: detection())
    monkeypatch.setattr(users_module, "sync_portal_role_downgrades", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(users_module, "sync_portal_role_promotions", lambda *_args, **_kwargs: None)

    def ensure_account(payload, rgw_account_id):
        row = make_s3_account(
            db_session,
            name=payload.name,
            storage_endpoint_id=payload.storage_endpoint_id,
            rgw_account_id=rgw_account_id,
            rgw_access_key="root-ak",
            rgw_secret_key="root-sk",
        )
        db_session.add(row)
        db_session.commit()
        return SimpleNamespace(id=row.id)

    monkeypatch.setattr(
        setup_service,
        "get_s3_accounts_service",
        lambda _db: SimpleNamespace(ensure_provisioned_account=ensure_account),
    )
    monkeypatch.setattr(
        setup_service,
        "get_portal_service",
        lambda _db: SimpleNamespace(
            get_portal_credentials=lambda *_args, **_kwargs: ("portal-ak", "portal-sk")
        ),
    )

    result = apply(
        guided,
        user,
        save(guided, user, endpoint_id=ep.id, manager=True, portal=True),
    )

    assert result.configured
    assert db_session.query(S3Account).count() == 1
    account = db_session.get(S3Account, result.resources["account_id"])
    link = (
        db_session.query(UserS3Account)
        .filter_by(user_id=user.id, account_id=account.id)
        .one()
    )
    assert link.manager_role == "account_administrator"
    assert link.portal_role == "portal_manager"
    assert link.allow_manager_browser_data_access is True
    assert result.links["manager"] == f"/manager/buckets?ctx={account.id}"
    assert result.links["portal"] == f"/portal/storage-spaces?project={account.id}"


@pytest.mark.parametrize(
    "manager,portal,expected_manager,expected_portal",
    [
        (True, False, "account_administrator", None),
        (False, True, None, "portal_manager"),
    ],
)
def test_manager_and_portal_role_axes_remain_independent(
    guided,
    db_session,
    monkeypatch,
    manager,
    portal,
    expected_manager,
    expected_portal,
):
    user = actor(db_session)
    ep = endpoint(
        db_session,
        admin_access_key="admin-ak",
        admin_secret_key="admin-sk",
        features_config=account_feature_config(iam=True),
    )
    monkeypatch.setattr(guided.endpoints, "detect_features", lambda *_args, **_kwargs: detection())
    monkeypatch.setattr(users_module, "sync_portal_role_downgrades", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(users_module, "sync_portal_role_promotions", lambda *_args, **_kwargs: None)

    def ensure_account(payload, rgw_account_id):
        row = make_s3_account(
            db_session,
            name=payload.name,
            storage_endpoint_id=payload.storage_endpoint_id,
            rgw_account_id=rgw_account_id,
            rgw_access_key="root-ak",
            rgw_secret_key="root-sk",
        )
        db_session.add(row)
        db_session.commit()
        return SimpleNamespace(id=row.id)

    monkeypatch.setattr(
        setup_service,
        "get_s3_accounts_service",
        lambda _db: SimpleNamespace(ensure_provisioned_account=ensure_account),
    )
    monkeypatch.setattr(
        setup_service,
        "get_portal_service",
        lambda _db: SimpleNamespace(
            get_portal_credentials=lambda *_args, **_kwargs: ("portal-ak", "portal-sk")
        ),
    )

    result = apply(
        guided,
        user,
        save(guided, user, endpoint_id=ep.id, manager=manager, portal=portal),
    )
    link = (
        db_session.query(UserS3Account)
        .filter_by(user_id=user.id, account_id=result.resources["account_id"])
        .one()
    )
    assert link.manager_role == expected_manager
    assert link.portal_role == expected_portal
    assert link.allow_manager_browser_data_access is manager


def test_ceph_admin_requires_valid_dedicated_identity_and_grants_access(
    guided, db_session, monkeypatch
):
    user = actor(db_session)
    ep = endpoint(
        db_session,
        ceph_admin_access_key="ceph-ak",
        ceph_admin_secret_key="ceph-sk",
    )
    monkeypatch.setattr(guided.endpoints, "detect_features", lambda *_args, **_kwargs: detection())
    result = apply(guided, user, save(guided, user, endpoint_id=ep.id, ceph_admin=True))
    db_session.refresh(user)
    assert result.configured
    assert user.can_access_ceph_admin is True
    assert result.links["ceph_admin"] == f"/ceph-admin?ep={ep.id}"

    denied_user = actor(db_session)
    denied_endpoint = endpoint(
        db_session,
        ceph_admin_access_key="denied-ak",
        ceph_admin_secret_key="denied-sk",
    )
    denied = save(guided, denied_user, endpoint_id=denied_endpoint.id, ceph_admin=True)
    monkeypatch.setattr(
        guided.endpoints,
        "detect_features",
        lambda *_args, **_kwargs: detection(ceph_admin="denied"),
    )
    with pytest.raises(OnboardingError, match="ceph_identity_denied"):
        apply(guided, denied_user, denied)
    db_session.refresh(denied_user)
    assert denied_user.can_access_ceph_admin is False


def test_review_token_and_revision_prevent_stale_apply(guided, db_session, monkeypatch):
    user = actor(db_session)
    ep = endpoint(db_session)
    monkeypatch.setattr(guided.endpoints, "detect_features", lambda *_args, **_kwargs: detection())
    journey = save(guided, user, endpoint_id=ep.id, private_connection=True)

    with pytest.raises(OnboardingError, match="review_changed"):
        guided.apply(
            user,
            journey.id,
            OnboardingApply(
                revision=journey.revision,
                confirmed=True,
                review_token="0" * 64,
                private_access_key="private-ak",
                private_secret_key="private-sk",
            ),
        )

    edited = guided.save(
        user,
        journey.id,
        OnboardingSave(
            revision=journey.revision,
            draft=journey.draft.model_copy(update={"force_path_style": False}),
        ),
    )
    assert edited.revision == journey.revision + 1
    with pytest.raises(OnboardingError, match="stale_revision"):
        apply(
            guided,
            user,
            journey,
            private_access_key="private-ak",
            private_secret_key="private-sk",
        )


def test_configured_apply_is_idempotent_and_does_not_duplicate_private_connection(
    guided, db_session, monkeypatch
):
    user = actor(db_session)
    ep = endpoint(db_session)
    monkeypatch.setattr(guided.endpoints, "detect_features", lambda *_args, **_kwargs: detection())
    monkeypatch.setattr(S3ConnectionsService, "_refresh_detected_capabilities", lambda *_: None)
    journey = save(guided, user, endpoint_id=ep.id, private_connection=True)
    first = apply(
        guided,
        user,
        journey,
        private_access_key="private-ak",
        private_secret_key="private-sk",
    )
    second = guided.apply(
        user,
        first.id,
        OnboardingApply(
            revision=first.revision,
            confirmed=True,
            review_token="0" * 64,
            private_access_key="private-ak",
            private_secret_key="private-sk",
        ),
    )
    assert second.resources == first.resources
    assert db_session.query(S3Connection).count() == 1


def test_cross_admin_journeys_are_isolated(guided, db_session):
    user = actor(db_session)
    other = actor(db_session)
    journey = save(
        guided,
        user,
        endpoint_url="https://storage.example.test",
        private_connection=True,
    )
    with pytest.raises(OnboardingError, match="journey_not_found"):
        guided.get(other, journey.id)
    assert guided.status(other).journeys == []


def test_required_features_are_minimal_and_supported(guided, db_session):
    all_fields = set().union(*REQUIRED_FEATURES.values())
    assert all_fields == {
        "manager_enabled",
        "portal_enabled",
        "ceph_admin_enabled",
        "browser_enabled",
        "browser_root_enabled",
        "browser_portal_enabled",
    }
    with pytest.raises(ValueError, match="Unsupported"):
        settings_service.enable_onboarding_features(
            db_session, ("require_passkey_for_admins",)
        )
