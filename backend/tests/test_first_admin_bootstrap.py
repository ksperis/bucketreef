# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings, get_settings
from app.db import AppSetting, AuditLog, Base, FirstAdminBootstrap, User
from app.core.domain_enums import UserRole
from app.models.app_settings import AppSettings
from app.routers import auth_common
from app.scripts import create_first_admin as create_first_admin_script
from app.services.app_settings_service import bootstrap_app_settings_for_db
from app.services.first_admin_bootstrap_service import (
    FIRST_ADMIN_BOOTSTRAP_ID,
    FirstAdminBootstrapService,
    FirstAdminBootstrapUnavailableError,
)
from app.utils.time import utcnow
from tests.auth_test_utils import trusted_origin_headers
from tests.db_transaction_test_utils import (
    fail_next_sqlite_statement_with_busy_snapshot,
    fail_next_transaction_commit,
)


PASSWORD = "correct horse battery staple"


def _payload(email: str = "first-admin@example.com") -> dict[str, str]:
    return {
        "email": email,
        "full_name": "First Administrator",
        "password": PASSWORD,
        "password_confirmation": PASSWORD,
    }


def test_issue_rotates_token_and_persists_only_sha256_digest(db_session):
    service = FirstAdminBootstrapService(db_session)
    first = service.issue_token()
    row = db_session.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)

    assert row is not None
    assert row.token_digest == hashlib.sha256(first.token.encode()).hexdigest()
    assert first.token not in row.token_digest
    assert service.is_available() is True

    second = service.issue_token()
    db_session.refresh(row)

    assert second.token != first.token
    assert row.token_digest == hashlib.sha256(second.token.encode()).hexdigest()
    with pytest.raises(FirstAdminBootstrapUnavailableError):
        service.create_with_token(
            token=first.token,
            email="old-token@example.com",
            full_name=None,
            password=PASSWORD,
        )


def test_issue_token_rolls_back_when_commit_fails(db_session):
    with fail_next_transaction_commit(db_session):
        with pytest.raises(RuntimeError, match="commit failed"):
            FirstAdminBootstrapService(db_session).issue_token()

    assert db_session.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID) is None


def test_issue_token_retries_sqlite_busy_snapshot_without_duplicate_audit(db_session):
    service = FirstAdminBootstrapService(db_session)
    first = service.issue_token()

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "UPDATE first_admin_bootstrap",
    ) as statements:
        second = service.issue_token()

    row = db_session.get(
        FirstAdminBootstrap,
        FIRST_ADMIN_BOOTSTRAP_ID,
        populate_existing=True,
    )
    audit_count = db_session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(AuditLog.action == "first_admin_bootstrap_issued")
    )
    assert len(statements) == 2
    assert second.token != first.token
    assert row is not None
    assert row.token_digest == hashlib.sha256(second.token.encode()).hexdigest()
    assert audit_count == 2


def test_expired_or_invalid_token_is_unavailable(db_session):
    service = FirstAdminBootstrapService(db_session)
    issued = service.issue_token()
    row = db_session.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
    assert row is not None
    row.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()

    assert service.is_available() is False
    for token in (issued.token, "invalid"):
        with pytest.raises(FirstAdminBootstrapUnavailableError):
            service.create_with_token(
                token=token,
                email="admin@example.com",
                full_name=None,
                password=PASSWORD,
            )
    assert db_session.scalar(select(func.count()).select_from(User)) == 0


def test_token_consumption_creates_one_superadmin_and_audits_without_secret(db_session):
    service = FirstAdminBootstrapService(db_session)
    issued = service.issue_token()

    created = service.create_with_token(
        token=issued.token,
        email="  ADMIN@Example.com ",
        full_name="  Platform Admin  ",
        password=PASSWORD,
        ip_address="192.0.2.10",
        user_agent="pytest",
        request_id="bootstrap-request",
    )

    user = db_session.get(User, created.user_id)
    row = db_session.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "first_admin_bootstrap_completed")
    ).one()
    assert user is not None
    assert user.email == "admin@example.com"
    assert user.full_name == "Platform Admin"
    assert user.role == UserRole.UI_SUPERADMIN.value
    assert row is not None and row.consumed_at is not None
    assert row.token_digest is None
    assert service.is_available() is False
    assert issued.token not in " ".join(
        filter(
            None,
            [
                audit.user_email,
                audit.message,
                str(audit.audit_metadata or {}),
                audit.request_id,
                audit.ip_address,
                audit.user_agent,
            ],
        )
    )
    assert audit.audit_metadata["method"] == "web"
    assert audit.audit_metadata["passkey_enrollment_required"] is False

    with pytest.raises(FirstAdminBootstrapUnavailableError):
        service.create_with_token(
            token=issued.token,
            email="second@example.com",
            full_name=None,
            password=PASSWORD,
        )


def test_token_consumption_normalizes_blank_full_name_to_none(db_session):
    service = FirstAdminBootstrapService(db_session)
    issued = service.issue_token()

    created = service.create_with_token(
        token=issued.token,
        email="blank-name@example.com",
        full_name="   ",
        password=PASSWORD,
    )

    user = db_session.get(User, created.user_id)
    assert user is not None
    assert user.full_name is None


def test_token_consumption_retries_sqlite_busy_snapshot_atomically(db_session):
    service = FirstAdminBootstrapService(db_session)
    issued = service.issue_token()

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "UPDATE first_admin_bootstrap",
    ) as statements:
        created = service.create_with_token(
            token=issued.token,
            email="busy-retry@example.com",
            full_name="Busy Retry",
            password=PASSWORD,
        )

    row = db_session.get(
        FirstAdminBootstrap,
        FIRST_ADMIN_BOOTSTRAP_ID,
        populate_existing=True,
    )
    assert len(statements) == 2
    assert db_session.scalar(select(func.count()).select_from(User)) == 1
    assert db_session.get(User, created.user_id) is not None
    assert row is not None and row.consumed_at is not None
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.action == "first_admin_bootstrap_completed")
        )
        == 1
    )


@pytest.mark.parametrize(
    "profile, extra_surface",
    [("full", None), ("full", "admin"), ("full", "storage_ops"), ("full", "manager"),
     ("full", "portal"), ("full", "browser"), ("user", None)],
)
def test_ceph_admin_only_bootstrap_grants_ceph_admin_access(db_session, profile, extra_surface):
    settings = Settings(
        _env_file=None,
        deployment_profile=profile,
        runtime_surfaces=["ceph_admin"] if profile == "full" else None,
        scheduled_jobs_enabled=False,
    )
    if extra_surface is not None:
        settings.runtime_surfaces.append(extra_surface)
    service = FirstAdminBootstrapService(db_session, settings=settings)
    issued = service.issue_token()
    created = service.create_with_token(
        token=issued.token,
        email="isolated-ceph-admin@example.com",
        full_name="Isolated Ceph Admin",
        password=PASSWORD,
    )

    user = db_session.get(User, created.user_id)
    assert user is not None
    assert user.role == UserRole.UI_SUPERADMIN.value
    assert user.can_access_ceph_admin is (profile == "full" and extra_surface is None)


def test_failed_user_insert_rolls_back_token_consumption(db_session):
    service = FirstAdminBootstrapService(db_session)
    issued = service.issue_token()
    failed = False

    def fail_once(
        _connection,
        _cursor,
        statement,
        _parameters,
        _context,
        _executemany,
    ):
        nonlocal failed
        if not failed and statement.startswith("INSERT INTO users"):
            failed = True
            raise IntegrityError("forced", {}, RuntimeError("forced"))

    bind = db_session.get_bind()
    event.listen(bind, "before_cursor_execute", fail_once)
    try:
        with pytest.raises(FirstAdminBootstrapUnavailableError):
            service.create_with_token(
                token=issued.token,
                email="rollback@example.com",
                full_name=None,
                password=PASSWORD,
            )
    finally:
        event.remove(bind, "before_cursor_execute", fail_once)

    assert db_session.scalar(select(func.count()).select_from(User)) == 0
    assert service.is_available() is True


def test_failed_admin_commit_rolls_back_token_consumption(db_session):
    service = FirstAdminBootstrapService(db_session)
    issued = service.issue_token()

    with fail_next_transaction_commit(db_session):
        with pytest.raises(RuntimeError, match="commit failed"):
            service.create_with_token(
                token=issued.token,
                email="commit-rollback@example.com",
                full_name=None,
                password=PASSWORD,
            )

    assert db_session.scalar(select(func.count()).select_from(User)) == 0
    assert service.is_available() is True


def test_failed_user_build_rolls_back_token_consumption(db_session, monkeypatch):
    service = FirstAdminBootstrapService(db_session)
    issued = service.issue_token()
    monkeypatch.setattr(
        "app.services.first_admin_bootstrap_service.get_password_hash",
        lambda _password: (_ for _ in ()).throw(RuntimeError("hash failed")),
    )

    with pytest.raises(RuntimeError, match="hash failed"):
        service.create_with_token(
            token=issued.token,
            email="hash-rollback@example.com",
            full_name=None,
            password=PASSWORD,
        )

    assert db_session.scalar(select(func.count()).select_from(User)) == 0
    assert service.is_available() is True


def test_concurrent_consumption_creates_exactly_one_user(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'bootstrap-race.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with session_factory() as db:
        bootstrap_app_settings_for_db(db)
        issued = FirstAdminBootstrapService(db).issue_token()

    def create(email: str) -> str:
        with session_factory() as db:
            try:
                FirstAdminBootstrapService(db).create_with_token(
                    token=issued.token,
                    email=email,
                    full_name=None,
                    password=PASSWORD,
                )
            except FirstAdminBootstrapUnavailableError:
                return "unavailable"
            return "created"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(create, ["race-one@example.com", "race-two@example.com"]))

    with session_factory() as db:
        assert sorted(results) == ["created", "unavailable"]
        assert db.scalar(select(func.count()).select_from(User)) == 1


def test_issue_refuses_non_empty_database(db_session):
    db_session.add(
        User(
            email="existing@example.com",
            hashed_password="hash",
            role=UserRole.UI_USER.value,
            is_active=True,
        )
    )
    db_session.commit()

    with pytest.raises(FirstAdminBootstrapUnavailableError):
        FirstAdminBootstrapService(db_session).issue_token()


def test_create_first_admin_cli_prints_after_session_close(monkeypatch, db_session, capsys):
    prompts = iter([PASSWORD, PASSWORD])
    monkeypatch.setattr(create_first_admin_script, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(create_first_admin_script.getpass, "getpass", lambda _prompt: next(prompts))
    monkeypatch.setattr(
        "builtins.input",
        lambda _prompt: "CREATE FIRST ADMIN cli-admin@example.com",
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "create_first_admin",
            "--email",
            "cli-admin@example.com",
            "--full-name",
            "CLI Admin",
        ],
    )

    create_first_admin_script.main()

    assert (
        capsys.readouterr().out
        == "Created cli-admin@example.com. Passkey enrollment is optional during onboarding; enroll one and enable "
        "'Require passkeys for administrators' before production.\n"
    )


def test_create_from_cli_records_bootstrap_provenance_and_operator_audit(db_session):
    created = FirstAdminBootstrapService(db_session).create_from_cli(
        email="  CLI-AUDIT@Example.com ",
        full_name=" CLI Audit ",
        password=PASSWORD,
        confirmation="CREATE FIRST ADMIN cli-audit@example.com",
    )

    user = db_session.get(User, created.user_id)
    row = db_session.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "operator_create_first_superadmin")
    ).one()

    assert user is not None
    assert user.email == "cli-audit@example.com"
    assert user.full_name == "CLI Audit"
    assert row is not None
    assert row.consumed_at is not None
    assert row.token_digest is None
    assert audit.entity_id == str(user.id)
    assert audit.audit_metadata == {
        "method": "cli",
        "passkey_enrollment_required": False,
    }


def test_bootstrap_api_authenticates_admin_without_passkey_by_default(client, db_session):
    settings = get_settings()
    issued = FirstAdminBootstrapService(db_session).issue_token()

    status_response = client.get("/api/auth/bootstrap/first-admin/status")
    assert status_response.status_code == 200
    assert status_response.json() == {"available": True}

    response = client.post(
        "/api/auth/bootstrap/first-admin",
        json=_payload(),
        headers={
            **trusted_origin_headers(),
            "X-BucketReef-Bootstrap-Token": issued.token,
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "authenticated"
    cookies = response.headers.get_list("set-cookie")
    assert any(value.startswith(f"{settings.access_token_cookie_name}=") for value in cookies)
    assert any(value.startswith(f"{settings.refresh_token_cookie_name}=") for value in cookies)
    assert not any(value.startswith(f"{settings.pre_auth_cookie_name}=") for value in cookies)
    assert client.get("/api/auth/bootstrap/first-admin/status").json() == {"available": False}


def test_bootstrap_api_requires_passkey_when_admin_policy_is_enabled(client, db_session):
    settings = AppSettings()
    settings.general.require_passkey_for_admins = True
    app_settings = db_session.get(AppSetting, "default")
    assert app_settings is not None
    app_settings.payload = settings.model_dump(mode="json")
    db_session.commit()
    runtime = get_settings()
    issued = FirstAdminBootstrapService(db_session).issue_token()

    response = client.post(
        "/api/auth/bootstrap/first-admin",
        json=_payload(),
        headers={
            **trusted_origin_headers(),
            "X-BucketReef-Bootstrap-Token": issued.token,
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "mfa_enrollment_required"
    pre_auth_cookie = next(
        value
        for value in response.headers.get_list("set-cookie")
        if value.startswith(f"{runtime.pre_auth_cookie_name}=")
    )
    assert "HttpOnly" in pre_auth_cookie
    assert "Max-Age=300" in pre_auth_cookie


def test_bootstrap_api_rejects_untrusted_origin_and_uses_generic_token_error(client, db_session):
    issued = FirstAdminBootstrapService(db_session).issue_token()
    wrong_origin = client.post(
        "/api/auth/bootstrap/first-admin",
        json=_payload(),
        headers={
            "Origin": "https://attacker.example",
            "X-BucketReef-Bootstrap-Token": issued.token,
        },
    )
    invalid_token = client.post(
        "/api/auth/bootstrap/first-admin",
        json=_payload(),
        headers={
            **trusted_origin_headers(),
            "X-BucketReef-Bootstrap-Token": "invalid",
        },
    )

    assert wrong_origin.status_code == 403
    assert invalid_token.status_code == 404
    assert invalid_token.json() == {"detail": "First administrator bootstrap is unavailable."}
    assert issued.token not in invalid_token.text


def test_bootstrap_api_rate_limits_invalid_attempts(monkeypatch, client, db_session):
    FirstAdminBootstrapService(db_session).issue_token()
    monkeypatch.setattr(auth_common.settings, "login_rate_limit_max_attempts", 1)
    monkeypatch.setattr(auth_common.settings, "login_rate_limit_window_seconds", 3600)
    headers = {
        **trusted_origin_headers(),
        "X-BucketReef-Bootstrap-Token": "invalid",
    }

    first = client.post("/api/auth/bootstrap/first-admin", json=_payload(), headers=headers)
    second = client.post("/api/auth/bootstrap/first-admin", json=_payload(), headers=headers)

    assert first.status_code == 404
    assert second.status_code == 429
