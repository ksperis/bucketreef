# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import logging

from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.core.security import get_password_hash, verify_password
from app.db import User
from app.core.domain_enums import is_admin_ui_role
from app.models.user import (
    ManagerToolAccess,
    UserProfilePreferencesUpdate,
    UserSelfUpdate,
    UserUpdate,
    validate_password_policy,
)
from app.services.manager_tool_access import MANAGER_TOOL_ROLES, manager_tool_column_values
from app.services.portal_role_sync import (
    acquire_portal_role_write_transaction,
    capture_effective_portal_roles,
    commit_portal_role_changes,
    effective_portal_account_ids,
)
from app.services.user_associations_service import UserAssociationsService
from app.services.user_avatar_service import UserAvatarService
from app.services.user_query_service import UserQueryService

logger = logging.getLogger(__name__)


MANAGER_ROLE_SCOPED_FIELDS = (
    "can_access_storage_ops",
    "can_create_manual_private_connections",
    "can_provision_managed_private_connections",
    "allow_multisite_endpoint_switching",
)


class UserUpdateService:
    """Apply UI-user and self-profile mutations with their security side effects."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.query = UserQueryService(db)
        self.associations = UserAssociationsService(db)

    def _apply_identity_updates(
        self,
        user: User,
        payload: UserUpdate,
        *,
        password_hash: str | None = None,
    ) -> bool:
        security_changed = False
        if payload.email and payload.email != user.email:
            existing = self.query.get_by_email(payload.email)
            if existing and existing.id != user.id:
                raise ValueError("Email already in use")
            user.email = payload.email
            security_changed = True
        if "full_name" in payload.model_fields_set:
            normalized_name = (payload.full_name or "").strip()
            user.full_name = normalized_name or None
        if payload.password:
            if password_hash is None:
                validate_password_policy(payload.password)
                password_hash = get_password_hash(payload.password)
            user.hashed_password = password_hash
            security_changed = True
        return security_changed

    @staticmethod
    def _apply_role_updates(user: User, payload: UserUpdate) -> tuple[str, bool]:
        security_changed = False
        next_role = payload.role or user.role
        if payload.role:
            security_changed = payload.role != user.role
            user.role = payload.role
        if payload.is_active is not None:
            security_changed = security_changed or payload.is_active != user.is_active
            user.is_active = payload.is_active
        return next_role, security_changed

    @staticmethod
    def _apply_access_updates(user: User, payload: UserUpdate, *, role: str) -> None:
        admin_role = is_admin_ui_role(role)
        if payload.can_access_ceph_admin is not None or not admin_role:
            user.can_access_ceph_admin = payload.can_access_ceph_admin if admin_role else False

        manager_role = role in MANAGER_TOOL_ROLES
        for field in MANAGER_ROLE_SCOPED_FIELDS:
            requested = getattr(payload, field)
            if requested is not None or not manager_role:
                setattr(user, field, requested if manager_role else False)

        if payload.manager_tool_access is not None or not manager_role:
            values = manager_tool_column_values(
                payload.manager_tool_access or ManagerToolAccess(),
                enabled=manager_role,
            )
            for column, value in values.items():
                setattr(user, column, value)

        if payload.browser_advanced_features_enabled is not None:
            user.browser_advanced_features_enabled = payload.browser_advanced_features_enabled
        if not admin_role:
            user.quota_alerts_global_watch = False

    def _apply_update_mutations(
        self,
        user: User,
        payload: UserUpdate,
        *,
        password_hash: str | None = None,
    ) -> bool:
        security_changed = self._apply_identity_updates(
            user,
            payload,
            password_hash=password_hash,
        )
        next_role, role_security_changed = self._apply_role_updates(user, payload)
        security_changed = security_changed or role_security_changed
        self._apply_access_updates(user, payload, role=next_role)
        self._apply_profile_preferences(user, payload)
        self.associations.apply_updates(user, payload)
        if security_changed:
            user.auth_version += 1
        return security_changed

    @staticmethod
    def _can_retry_without_portal_side_effects(
        payload: UserUpdate,
        portal_roles_before,
    ) -> bool:
        retryable_fields = {
            "email",
            "full_name",
            "password",
            "role",
            "can_access_ceph_admin",
            "can_access_storage_ops",
            "can_create_manual_private_connections",
            "can_provision_managed_private_connections",
            "allow_multisite_endpoint_switching",
            "manager_tool_access",
            "browser_advanced_features_enabled",
            "ui_language",
            "quota_alerts_enabled",
            "quota_alerts_global_watch",
            "avatar_preference",
            "account_links",
        }
        if not payload.model_fields_set <= retryable_fields:
            return False
        if any(role is not None for role in portal_roles_before.values()):
            return False
        if payload.account_links is not None and any(
            link.portal_role is not None for link in payload.account_links
        ):
            return False
        return True

    def _persist_retryable_update(
        self,
        user_id: int,
        payload: UserUpdate,
    ) -> tuple[User, bool]:
        staged_password_hash: str | None = None
        if self.db.get_bind().dialect.name == "sqlite" and payload.password:
            validate_password_policy(payload.password)
            staged_password_hash = get_password_hash(payload.password)

        def update_once(write_db: Session) -> tuple[int, bool]:
            write_service = UserUpdateService(write_db)
            current = write_service.query.require_by_id(user_id)
            security_changed = write_service._apply_update_mutations(
                current,
                payload,
                password_hash=staged_password_hash,
            )
            write_db.flush()
            return int(current.id), security_changed

        persisted_user_id, security_changed = run_replayable_db_unit(
            self.db,
            update_once,
        )
        user = self.query.require_by_id(persisted_user_id)
        self.db.refresh(user)
        return user, security_changed

    def update_user(self, user_id: int, payload: UserUpdate) -> User:
        user = self.query.require_by_id(user_id)
        was_active = user.is_active
        affected_portal_account_ids = set(
            self.associations.affected_portal_account_ids(
                user,
                payload,
            )
        )
        restore_existing_access = payload.is_active is True and not was_active and not affected_portal_account_ids
        if payload.is_active is not None and payload.is_active != was_active:
            affected_portal_account_ids.update(
                effective_portal_account_ids(self.db, user)
            )
        affected_portal_account_ids = sorted(affected_portal_account_ids)
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=affected_portal_account_ids,
        )
        if self._can_retry_without_portal_side_effects(payload, portal_roles_before):
            user, security_changed = self._persist_retryable_update(user_id, payload)
        else:
            acquire_portal_role_write_transaction(self.db)
            security_changed = self._apply_update_mutations(user, payload)
            self.db.add(user)
            self.db.flush()
            commit_portal_role_changes(
                self.db,
                before=portal_roles_before,
                user_ids=[user.id],
                account_ids=affected_portal_account_ids,
                restore_existing_access=restore_existing_access,
            )
            self.db.refresh(user)
        if security_changed:
            from app.services.auth_session_service import AuthSessionService

            AuthSessionService(self.db).revoke_all_for_user(
                user,
                "user_security_changed",
                increment_version=False,
            )
        logger.debug("Updated user id=%s email=%s", user.id, user.email)
        return user

    def _apply_profile_preferences(self, user: User, payload: UserProfilePreferencesUpdate) -> None:
        fields = payload.model_fields_set
        if "ui_language" in fields:
            user.ui_language = payload.ui_language or None
        if payload.quota_alerts_enabled is not None:
            user.quota_alerts_enabled = payload.quota_alerts_enabled
        if payload.quota_alerts_global_watch is not None:
            if not is_admin_ui_role(user.role) and payload.quota_alerts_global_watch:
                raise ValueError("Global quota watch requires admin role")
            user.quota_alerts_global_watch = (
                payload.quota_alerts_global_watch
                if is_admin_ui_role(user.role)
                else False
            )
        if payload.avatar_preference is not None:
            UserAvatarService(self.db).set_preference(
                user,
                payload.avatar_preference,
            )

    @staticmethod
    def _apply_current_user_password(
        user: User,
        payload: UserSelfUpdate,
        *,
        password_hash: str | None = None,
    ) -> bool:
        current_password = payload.current_password
        new_password = payload.new_password
        if current_password is None and new_password is None:
            return False
        if not current_password or not new_password:
            raise ValueError("Both current_password and new_password are required")
        if not user.hashed_password:
            raise ValueError("Password change is unavailable for this account")
        if not verify_password(current_password, user.hashed_password):
            raise ValueError("Current password is incorrect")
        if password_hash is None:
            validate_password_policy(new_password)
            password_hash = get_password_hash(new_password)
        user.hashed_password = password_hash
        user.auth_version += 1
        return True

    def update_current_user(self, user: User, payload: UserSelfUpdate) -> User:
        user_id = int(user.id)
        staged_password_hash: str | None = None
        current_password = payload.current_password
        new_password = payload.new_password
        if current_password is not None or new_password is not None:
            if not current_password or not new_password:
                raise ValueError("Both current_password and new_password are required")
            if not user.hashed_password:
                raise ValueError("Password change is unavailable for this account")
            if not verify_password(current_password, user.hashed_password):
                raise ValueError("Current password is incorrect")
            validate_password_policy(new_password)
            staged_password_hash = get_password_hash(new_password)

        def update_once(write_db: Session) -> tuple[int, bool]:
            write_service = UserUpdateService(write_db)
            current = write_service.query.require_by_id(user_id)
            update_fields = payload.model_fields_set
            if "full_name" in update_fields:
                normalized_name = (payload.full_name or "").strip()
                current.full_name = normalized_name or None
            write_service._apply_profile_preferences(current, payload)
            if payload.ui_preferences is not None:
                current.ui_preferences = payload.ui_preferences.model_dump(exclude_none=True)
            password_changed = write_service._apply_current_user_password(
                current,
                payload,
                password_hash=staged_password_hash,
            )
            return int(current.id), password_changed

        persisted_user_id, password_changed = run_replayable_db_unit(
            self.db,
            update_once,
        )
        user = self.db.get(User, persisted_user_id, populate_existing=True)
        if user is None:
            raise ValueError("User does not exist")
        if password_changed:
            from app.services.auth_session_service import AuthSessionService

            AuthSessionService(self.db).revoke_all_for_user(
                user,
                "password_changed",
                increment_version=False,
            )
        logger.debug("Updated profile for user id=%s", user.id)
        return user
