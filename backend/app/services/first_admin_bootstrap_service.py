# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import exists, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db_transactions import run_replayable_db_unit
from app.core.runtime_surfaces import ceph_admin_only_runtime
from app.core.sensitive_data import sanitized_error_log_detail
from app.core.security import get_password_hash
from app.db import FirstAdminBootstrap, User
from app.core.domain_enums import UserRole
from app.models.user import validate_password_policy
from app.services.app_settings_service import load_app_settings_for_db
from app.services.audit_service import AuditService
from app.utils.normalize import normalize_optional_string
from app.utils.time import utcnow


FIRST_ADMIN_BOOTSTRAP_ID = 1
_EMAIL_ADAPTER = TypeAdapter(EmailStr)
DEFAULT_BOOTSTRAP_TTL_MINUTES = 15


class FirstAdminBootstrapError(ValueError):
    pass


class FirstAdminBootstrapUnavailableError(FirstAdminBootstrapError):
    pass


@dataclass(frozen=True)
class IssuedFirstAdminBootstrap:
    token: str
    expires_at: datetime


@dataclass(frozen=True)
class CreatedFirstAdmin:
    user_id: int
    email: str


class FirstAdminBootstrapService:
    def __init__(self, db: Session, settings: Optional[Settings] = None) -> None:
        self.db = db
        self.settings = settings or get_settings()

    @staticmethod
    def _digest(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _normalize_email(email: str) -> str:
        try:
            validated = _EMAIL_ADAPTER.validate_python(str(email or "").strip())
        except ValidationError as exc:
            raise FirstAdminBootstrapError(
                "Email must be a valid email address"
            ) from exc
        return str(validated).lower()

    @staticmethod
    def _validate_password(password: str) -> None:
        try:
            validate_password_policy(password)
        except ValueError as exc:
            raise FirstAdminBootstrapError(sanitized_error_log_detail(exc)) from exc

    @staticmethod
    def _empty_users_predicate():
        return ~exists(select(User.id))

    def _has_users(self) -> bool:
        return int(self.db.scalar(select(func.count(User.id))) or 0) != 0

    def _passkey_enrollment_required(self) -> bool:
        return bool(
            load_app_settings_for_db(
                self.db
            ).general.require_passkey_for_admins
        )

    def is_available(self) -> bool:
        now = utcnow()
        if self._has_users():
            return False
        row = self.db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
        return bool(
            row
            and row.token_digest
            and row.consumed_at is None
            and row.expires_at is not None
            and row.expires_at > now
        )

    def issue_token(
        self,
        *,
        ttl_minutes: int = DEFAULT_BOOTSTRAP_TTL_MINUTES,
    ) -> IssuedFirstAdminBootstrap:
        if not 1 <= ttl_minutes <= 60:
            raise FirstAdminBootstrapError(
                "Bootstrap token lifetime must be between 1 and 60 minutes"
            )
        now = utcnow()
        expires_at = now + timedelta(minutes=ttl_minutes)
        token = secrets.token_urlsafe(32)
        digest = self._digest(token)

        def persist_once(write_db: Session) -> None:
            if int(write_db.scalar(select(func.count(User.id))) or 0) != 0:
                raise FirstAdminBootstrapUnavailableError(
                    "The database already contains users"
                )
            row = write_db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
            if row is None:
                write_db.add(
                    FirstAdminBootstrap(
                        id=FIRST_ADMIN_BOOTSTRAP_ID,
                        token_digest=digest,
                        expires_at=expires_at,
                    )
                )
                write_db.flush()
                return
            changed = write_db.execute(
                update(FirstAdminBootstrap)
                .where(
                    FirstAdminBootstrap.id == FIRST_ADMIN_BOOTSTRAP_ID,
                    FirstAdminBootstrap.consumed_at.is_(None),
                    self._empty_users_predicate(),
                )
                .values(
                    token_digest=digest,
                    expires_at=expires_at,
                )
            )
            if changed.rowcount != 1:
                raise FirstAdminBootstrapUnavailableError(
                    "First administrator bootstrap is unavailable"
                )

        try:
            run_replayable_db_unit(self.db, persist_once)
        except IntegrityError as exc:
            raise FirstAdminBootstrapUnavailableError(
                "First administrator bootstrap is unavailable"
            ) from exc

        AuditService(self.db).record_action(
            user=None,
            scope="security",
            action="first_admin_bootstrap_issued",
            entity_type="first_admin_bootstrap",
            entity_id=str(FIRST_ADMIN_BOOTSTRAP_ID),
            metadata={"expires_at": expires_at.isoformat()},
        )
        return IssuedFirstAdminBootstrap(token=token, expires_at=expires_at)

    def create_with_token(
        self,
        *,
        token: str,
        email: str,
        full_name: Optional[str],
        password: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> CreatedFirstAdmin:
        normalized_email = self._normalize_email(email)
        self._validate_password(password)
        now = utcnow()
        actual_digest = self._digest(token)
        passkey_enrollment_required = self._passkey_enrollment_required()
        normalized_name = normalize_optional_string(full_name)
        password_hash = get_password_hash(password)

        def persist_once(write_db: Session) -> int:
            row = write_db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
            expected_digest = row.token_digest if row and row.token_digest else "0" * 64
            if (
                not secrets.compare_digest(actual_digest, expected_digest)
                or row is None
                or row.consumed_at is not None
                or row.expires_at is None
                or row.expires_at <= now
            ):
                raise FirstAdminBootstrapUnavailableError(
                    "First administrator bootstrap is unavailable"
                )
            changed = write_db.execute(
                update(FirstAdminBootstrap)
                .where(
                    FirstAdminBootstrap.id == FIRST_ADMIN_BOOTSTRAP_ID,
                    FirstAdminBootstrap.token_digest == actual_digest,
                    FirstAdminBootstrap.consumed_at.is_(None),
                    FirstAdminBootstrap.expires_at > now,
                    self._empty_users_predicate(),
                )
                .values(token_digest=None, consumed_at=now)
            )
            if changed.rowcount != 1:
                raise FirstAdminBootstrapUnavailableError(
                    "First administrator bootstrap is unavailable"
                )
            user = self._new_user(
                normalized_email,
                normalized_name,
                password_hash=password_hash,
            )
            write_db.add(user)
            write_db.flush()
            return int(user.id)

        try:
            user_id = run_replayable_db_unit(self.db, persist_once)
        except IntegrityError as exc:
            raise FirstAdminBootstrapUnavailableError(
                "First administrator bootstrap is unavailable"
            ) from exc

        self._record_created_admin(
            user_id=user_id,
            action="first_admin_bootstrap_completed",
            method="web",
            passkey_enrollment_required=passkey_enrollment_required,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        return CreatedFirstAdmin(user_id=user_id, email=normalized_email)

    def create_from_cli(
        self,
        *,
        email: str,
        full_name: Optional[str],
        password: str,
        confirmation: str,
    ) -> CreatedFirstAdmin:
        normalized_email = self._normalize_email(email)
        expected = f"CREATE FIRST ADMIN {normalized_email}"
        if confirmation != expected:
            raise FirstAdminBootstrapError(
                f"Confirmation must exactly match: {expected}"
            )
        self._validate_password(password)
        if self._has_users():
            raise FirstAdminBootstrapUnavailableError(
                "The database already contains users; "
                "create administrators through the UI"
            )
        passkey_enrollment_required = self._passkey_enrollment_required()

        now = utcnow()
        normalized_name = normalize_optional_string(full_name)
        password_hash = get_password_hash(password)

        def persist_once(write_db: Session) -> int:
            if int(write_db.scalar(select(func.count(User.id))) or 0) != 0:
                raise FirstAdminBootstrapUnavailableError(
                    "The database already contains users; "
                    "create administrators through the UI"
                )
            row = write_db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
            if row is None:
                write_db.add(
                    FirstAdminBootstrap(
                        id=FIRST_ADMIN_BOOTSTRAP_ID,
                        consumed_at=now,
                    )
                )
                write_db.flush()
            else:
                changed = write_db.execute(
                    update(FirstAdminBootstrap)
                    .where(
                        FirstAdminBootstrap.id == FIRST_ADMIN_BOOTSTRAP_ID,
                        FirstAdminBootstrap.consumed_at.is_(None),
                        self._empty_users_predicate(),
                    )
                    .values(token_digest=None, consumed_at=now)
                )
                if changed.rowcount != 1:
                    raise FirstAdminBootstrapUnavailableError(
                        "First administrator bootstrap is unavailable"
                    )
            user = self._new_user(
                normalized_email,
                normalized_name,
                password_hash=password_hash,
            )
            write_db.add(user)
            write_db.flush()
            return int(user.id)

        try:
            user_id = run_replayable_db_unit(self.db, persist_once)
        except IntegrityError as exc:
            raise FirstAdminBootstrapUnavailableError(
                "First administrator bootstrap is unavailable"
            ) from exc

        self._record_created_admin(
            user_id=user_id,
            action="operator_create_first_superadmin",
            method="cli",
            passkey_enrollment_required=passkey_enrollment_required,
        )
        return CreatedFirstAdmin(user_id=user_id, email=normalized_email)

    def _record_created_admin(
        self,
        *,
        user_id: int,
        action: str,
        method: str,
        passkey_enrollment_required: bool,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> None:
        user = self.db.get(User, user_id, populate_existing=True)
        AuditService(self.db).record_action(
            user=user,
            scope="security",
            action=action,
            entity_type="user",
            entity_id=str(user_id),
            metadata={
                "method": method,
                "passkey_enrollment_required": passkey_enrollment_required,
            },
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )

    def _new_user(
        self,
        email: str,
        full_name: Optional[str],
        *,
        password_hash: str,
    ) -> User:
        return User(
            email=email,
            full_name=full_name,
            hashed_password=password_hash,
            role=UserRole.UI_SUPERADMIN.value,
            is_active=True,
            auth_version=1,
            can_access_ceph_admin=ceph_admin_only_runtime(self.settings),
        )
