# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.domain_errors import S3AccountNotFoundError, UiUserNotFoundError
from app.core.security import consume_dummy_password_hash, get_password_hash, verify_and_update_password
from app.db import (
    S3Account,
    User,
    UserRole,
    UserS3Account,
    is_admin_ui_role,
)
from app.models.user import (
    AccountMembership,
    ManagerToolAccess,
    UserCreate,
    UserOut,
    UserSelfUpdate,
    UserSummary,
    UserUpdate,
    validate_password_policy,
)
from app.services.external_identity_user_service import ExternalIdentityUserService
from app.services.manager_tool_access import MANAGER_TOOL_ROLES, manager_tool_column_values
from app.services.portal_role_sync import (
    capture_effective_portal_roles,
    sync_portal_role_downgrades,
    sync_portal_role_promotions,
)
from app.services.user_associations_service import UserAssociationsService
from app.services.user_deletion_service import UserDeletionService
from app.services.user_output_service import UserOutputService
from app.services.user_query_service import UserQueryService
from app.services.user_update_service import UserUpdateService
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue
from app.utils.time import utcnow

logger = logging.getLogger(__name__)


class UsersService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.deletion = UserDeletionService(db)
        self.query = UserQueryService(db)
        self.updates = UserUpdateService(db)

    def get_by_email(self, email: str) -> Optional[User]:
        return self.query.get_by_email(email)

    def get_by_email_case_insensitive(self, email: str) -> Optional[User]:
        return self.query.get_by_email_case_insensitive(email)

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.query.get_by_id(user_id)

    def _active_superadmin_count(self, actor: User) -> int:
        count = self.db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.role == UserRole.UI_SUPERADMIN.value,
                User.is_active.is_(True),
            )
        ) or 0
        actor_is_persisted = self.db.scalar(
            select(User.id).where(User.id == actor.id).limit(1)
        )
        if (
            actor_is_persisted is None
            and actor.role == UserRole.UI_SUPERADMIN.value
            and actor.is_active
        ):
            count += 1
        return count

    def validate_superadmin_update(self, actor: User, target: User, payload: UserUpdate) -> None:
        next_role = payload.role or target.role
        next_active = target.is_active if payload.is_active is None else payload.is_active
        removes_active_superadmin = (
            target.role == UserRole.UI_SUPERADMIN.value
            and target.is_active
            and (next_role != UserRole.UI_SUPERADMIN.value or not next_active)
        )
        if actor.id == target.id and removes_active_superadmin:
            raise ValueError("A superadmin cannot deactivate or demote their own account")
        if removes_active_superadmin and self._active_superadmin_count(actor) <= 1:
            raise ValueError("The last active superadmin cannot be deactivated or demoted")

    def validate_superadmin_delete(self, actor: User, target: User) -> None:
        if (
            target.role == UserRole.UI_SUPERADMIN.value
            and target.is_active
            and self._active_superadmin_count(actor) <= 1
        ):
            raise ValueError("The last active superadmin cannot be deleted")

    def create_user(self, payload: UserCreate) -> User:
        existing = self.get_by_email(payload.email)
        if existing:
            raise ValueError("User already exists")
        validate_password_policy(payload.password)
        role = payload.role or UserRole.UI_USER.value
        can_access_ceph_admin = bool(payload.can_access_ceph_admin) if is_admin_ui_role(role) else False
        can_access_storage_ops = (
            bool(payload.can_access_storage_ops)
            if role in MANAGER_TOOL_ROLES
            else False
        )
        manager_tool_access = payload.manager_tool_access or ManagerToolAccess()
        manager_tools_supported = role in MANAGER_TOOL_ROLES
        user = User(
            email=payload.email,
            full_name=payload.full_name,
            hashed_password=get_password_hash(payload.password),
            is_active=True,
            role=role,
            can_access_ceph_admin=can_access_ceph_admin,
            can_access_storage_ops=can_access_storage_ops,
            can_create_manual_private_connections=(
                bool(payload.can_create_manual_private_connections) if manager_tools_supported else False
            ),
            can_provision_managed_private_connections=(
                bool(payload.can_provision_managed_private_connections) if manager_tools_supported else False
            ),
            allow_multisite_endpoint_switching=(
                bool(payload.allow_multisite_endpoint_switching) if manager_tools_supported else False
            ),
            browser_advanced_features_enabled=bool(payload.browser_advanced_features_enabled),
            **manager_tool_column_values(manager_tool_access, enabled=manager_tools_supported),
        )
        self.db.add(user)
        self.db.flush()
        if payload.group_ids is not None:
            associations = UserAssociationsService(self.db)
            associations.set_group_links(user, payload.group_ids)
        else:
            associations = UserAssociationsService(self.db)
        if payload.openstack_cloud_ids is not None:
            associations.set_openstack_cloud_links(user, payload.openstack_cloud_ids)
        self.db.commit()
        self.db.refresh(user)
        logger.debug("Created user id=%s email=%s role=%s", user.id, user.email, role)
        return user

    def update_user(self, user_id: int, payload: UserUpdate) -> User:
        return self.updates.update_user(user_id, payload)

    def update_current_user(self, user: User, payload: UserSelfUpdate) -> User:
        return self.updates.update_current_user(user, payload)

    def delete_user(self, user_id: int) -> None:
        self.deletion.delete_user(user_id)

    def list_users(self) -> list[User]:
        return self.query.list_users()

    def list_users_minimal(self) -> list[UserSummary]:
        return self.query.list_users_minimal()

    def paginate_users(
        self,
        page: int,
        page_size: int,
        search: Optional[str] = None,
        sort_field: str = "name",
        sort_direction: str = "asc",
    ) -> tuple[list[UserOut], int]:
        return self.query.paginate_users(
            page=page,
            page_size=page_size,
            search=search,
            sort_field=sort_field,
            sort_direction=sort_direction,
        )

    def assign_user_to_account(
        self,
        user_id: int,
        account_id: int,
        *,
        manager_role: Optional[ManagerAccountRoleValue],
        portal_role: Optional[PortalAccountRoleValue],
    ) -> User:
        user = self.db.get(User, user_id)
        if not user:
            raise UiUserNotFoundError("User not found")
        account = self.db.get(S3Account, account_id)
        if not account:
            raise S3AccountNotFoundError("S3Account not found")
        before_roles = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=[account.id],
        )
        link = self.db.scalar(
            select(UserS3Account)
            .where(
                UserS3Account.user_id == user.id,
                UserS3Account.account_id == account.id,
            )
            .limit(1)
        )
        if user.role == UserRole.UI_NONE.value:
            user.role = UserRole.UI_USER.value
        membership = AccountMembership(
            account_id=account.id,
            manager_role=manager_role,
            portal_role=portal_role,
        )
        if not link:
            link = UserS3Account(
                user_id=user.id,
                account_id=account.id,
                manager_role=membership.manager_role,
                portal_role=membership.portal_role,
            )
        link.manager_role = membership.manager_role
        link.portal_role = membership.portal_role
        link.updated_at = utcnow()
        self.db.add(link)
        self.db.add(user)
        self.db.flush()
        after_roles = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=[account.id],
        )
        try:
            sync_portal_role_downgrades(self.db, before=before_roles, after=after_roles)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        sync_portal_role_promotions(self.db, before=before_roles, after=after_roles)
        self.db.refresh(user)
        return user

    def authenticate(self, email: str, password: str) -> Optional[User]:
        user = self.get_by_email(email)
        if not user or not user.is_active or not user.hashed_password:
            consume_dummy_password_hash(password)
            return None
        valid, updated_hash = verify_and_update_password(password, user.hashed_password)
        if not valid:
            return None
        if updated_hash:
            user.hashed_password = updated_hash
            user.auth_version += 1
            self.db.add(user)
            self.db.commit()
            from app.services.auth_session_service import AuthSessionService

            AuthSessionService(self.db).revoke_all_for_user(
                user,
                "password_rehashed",
                increment_version=False,
            )
            self.db.refresh(user)
        logger.debug("Authenticated user id=%s email=%s", user.id, user.email)
        return self.mark_last_login(user)

    def user_to_out(
        self,
        user: User,
    ) -> UserOut:
        return UserOutputService(self.db).to_out(user)

    def mark_last_login(self, user: User) -> User:
        user.last_login_at = utcnow()
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def get_or_create_oidc_user(
        self,
        *,
        provider: str,
        issuer: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        picture_url: Optional[str],
        email_verified: bool = True,
        linking_policy: str = "manual",
        trusted_email_domains: Optional[list[str]] = None,
        browser_secret_hash: Optional[str] = None,
        redirect_path: Optional[str] = None,
    ) -> tuple[User, bool]:
        return ExternalIdentityUserService(self.db).get_or_create_oidc_user(
            provider=provider,
            issuer=issuer,
            subject=subject,
            email=email,
            full_name=full_name,
            picture_url=picture_url,
            email_verified=email_verified,
            linking_policy=linking_policy,
            trusted_email_domains=trusted_email_domains,
            browser_secret_hash=browser_secret_hash,
            redirect_path=redirect_path,
        )

    def get_or_create_ldap_user(
        self,
        *,
        provider: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        linking_policy: str = "manual",
        browser_secret_hash: Optional[str] = None,
        redirect_path: Optional[str] = None,
    ) -> tuple[User, bool]:
        return ExternalIdentityUserService(self.db).get_or_create_ldap_user(
            provider=provider,
            subject=subject,
            email=email,
            full_name=full_name,
            linking_policy=linking_policy,
            browser_secret_hash=browser_secret_hash,
            redirect_path=redirect_path,
        )


def get_users_service(db: Session) -> UsersService:
    return UsersService(db)
