# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import UiUserNotFoundError
from app.core.security import get_password_hash, verify_password
from app.db import AccountIAMUser, S3Account, User
from app.core.domain_enums import is_admin_ui_role
from app.models.user import (
    ManagerToolAccess,
    UiPreferences,
    UserProfilePreferencesUpdate,
    UserSelfUpdate,
    UserUpdate,
    validate_password_policy,
)
from app.services.manager_tool_access import MANAGER_TOOL_ROLES, manager_tool_column_values
from app.services.portal_role_sync import (
    capture_effective_portal_roles,
    sync_portal_role_downgrades,
    sync_portal_role_promotions,
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

    def _apply_identity_updates(self, user: User, payload: UserUpdate) -> bool:
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
            validate_password_policy(payload.password)
            user.hashed_password = get_password_hash(payload.password)
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
            user.can_access_ceph_admin = bool(payload.can_access_ceph_admin) if admin_role else False

        manager_role = role in MANAGER_TOOL_ROLES
        for field in MANAGER_ROLE_SCOPED_FIELDS:
            requested = getattr(payload, field)
            if requested is not None or not manager_role:
                setattr(user, field, bool(requested) if manager_role else False)

        if payload.manager_tool_access is not None or not manager_role:
            values = manager_tool_column_values(
                payload.manager_tool_access or ManagerToolAccess(),
                enabled=manager_role,
            )
            for column, value in values.items():
                setattr(user, column, value)

        if payload.browser_advanced_features_enabled is not None:
            user.browser_advanced_features_enabled = bool(payload.browser_advanced_features_enabled)
        if not admin_role:
            user.quota_alerts_global_watch = False

    def _revoke_portal_iam_for_deactivated_user(
        self,
        user: User,
        *,
        was_active: bool,
    ) -> None:
        if not was_active or user.is_active:
            return

        from app.services.portal_service import PortalService

        portal_service = PortalService(self.db)
        portal_accounts = self.db.scalars(
            select(S3Account)
            .join(AccountIAMUser, AccountIAMUser.account_id == S3Account.id)
            .where(AccountIAMUser.user_id == user.id)
            .order_by(S3Account.id.asc())
        ).unique().all()
        for account in portal_accounts:
            portal_service.sync_existing_portal_user_access(user, account, None)

    def update_user(self, user_id: int, payload: UserUpdate) -> User:
        user = self.query.get_by_id(user_id)
        if not user:
            raise UiUserNotFoundError("User not found")
        was_active = bool(user.is_active)
        affected_portal_account_ids = self.associations.affected_portal_account_ids(
            user,
            payload,
        )
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=affected_portal_account_ids,
        )
        security_changed = self._apply_identity_updates(user, payload)
        next_role, role_security_changed = self._apply_role_updates(user, payload)
        security_changed = security_changed or role_security_changed
        self._apply_access_updates(user, payload, role=next_role)
        self._apply_profile_preferences(user, payload)
        self.associations.apply_updates(user, payload)
        if security_changed:
            user.auth_version += 1
        self.db.add(user)
        self.db.flush()
        self._revoke_portal_iam_for_deactivated_user(
            user,
            was_active=was_active,
        )
        portal_roles_after = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=affected_portal_account_ids,
        )
        sync_portal_role_downgrades(self.db, before=portal_roles_before, after=portal_roles_after)
        self.db.commit()
        sync_portal_role_promotions(self.db, before=portal_roles_before, after=portal_roles_after)
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
        if "quota_alerts_enabled" in fields:
            user.quota_alerts_enabled = bool(payload.quota_alerts_enabled)
        if "quota_alerts_global_watch" in fields:
            if not is_admin_ui_role(user.role) and payload.quota_alerts_global_watch:
                raise ValueError("Global quota watch requires admin role")
            user.quota_alerts_global_watch = (
                bool(payload.quota_alerts_global_watch)
                if is_admin_ui_role(user.role)
                else False
            )
        if "avatar_preference" in fields:
            UserAvatarService(self.db).set_preference(
                user,
                payload.avatar_preference or "auto",
            )

    @staticmethod
    def _apply_current_user_password(user: User, payload: UserSelfUpdate) -> bool:
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
        validate_password_policy(new_password)
        user.hashed_password = get_password_hash(new_password)
        user.auth_version += 1
        return True

    def update_current_user(self, user: User, payload: UserSelfUpdate) -> User:
        update_fields = payload.model_fields_set
        if "full_name" in update_fields:
            normalized_name = (payload.full_name or "").strip()
            user.full_name = normalized_name or None
        self._apply_profile_preferences(user, payload)
        if "ui_preferences" in update_fields:
            user.ui_preferences = (payload.ui_preferences or UiPreferences()).model_dump(
                exclude_none=True
            )

        password_changed = self._apply_current_user_password(user, payload)

        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        if password_changed:
            from app.services.auth_session_service import AuthSessionService

            AuthSessionService(self.db).revoke_all_for_user(
                user,
                "password_changed",
                increment_version=False,
            )
        logger.debug("Updated profile for user id=%s", user.id)
        return user


def get_user_update_service(db: Session) -> UserUpdateService:
    return UserUpdateService(db)
