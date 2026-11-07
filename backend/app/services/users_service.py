# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.domain_errors import UiUserNotFoundError
from app.db import User
from app.core.domain_enums import UserRole
from app.models.admin_listing import AdminOptionListingRequest
from app.models.user import (
    AdminUserListingRequest,
    PaginatedUserSummariesResponse,
    PaginatedUsersResponse,
    UserCreate,
    UserOut,
    UserSelfUpdate,
    UserUpdate,
)
from app.services.external_identity_user_service import ExternalIdentityUserService
from app.services.user_associations_service import UserAssociationsService
from app.services.user_deletion_service import UserDeletionService
from app.services.user_login_service import UserLoginService
from app.services.user_output_service import UserOutputService
from app.services.user_provisioning_service import UserProvisioningService
from app.services.user_query_service import UserQueryService
from app.services.user_update_service import UserUpdateService
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue

class UsersService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.deletion = UserDeletionService(db)
        self.query = UserQueryService(db)
        self.updates = UserUpdateService(db)
        self.associations = UserAssociationsService(db)
        self.login = UserLoginService(db)
        self.provisioning = UserProvisioningService(db)

    def get_by_email(self, email: str) -> Optional[User]:
        return self.query.get_by_email(email)

    def get_by_email_case_insensitive(self, email: str) -> Optional[User]:
        return self.query.get_by_email_case_insensitive(email)

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.query.get_by_id(user_id)

    def require_by_id(self, user_id: int) -> User:
        user = self.get_by_id(user_id)
        if user is None:
            raise UiUserNotFoundError("User not found")
        return user

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
        return self.provisioning.create_user(payload)

    def update_user(self, user_id: int, payload: UserUpdate) -> User:
        return self.updates.update_user(user_id, payload)

    def update_current_user(self, user: User, payload: UserSelfUpdate) -> User:
        return self.updates.update_current_user(user, payload)

    def delete_user(self, user_id: int) -> None:
        self.deletion.delete_user(user_id)

    def list_users(self) -> list[User]:
        return self.query.list_users()

    def list_user_options_page(
        self,
        request: AdminOptionListingRequest,
    ) -> PaginatedUserSummariesResponse:
        return self.query.list_user_options_page(request)

    def list_users_page(
        self,
        request: AdminUserListingRequest,
    ) -> PaginatedUsersResponse:
        return self.query.list_users_page(request)

    def assign_user_to_account(
        self,
        user_id: int,
        account_id: int,
        *,
        manager_role: Optional[ManagerAccountRoleValue],
        portal_role: Optional[PortalAccountRoleValue],
    ) -> User:
        return self.associations.assign_account(
            user_id,
            account_id,
            manager_role=manager_role,
            portal_role=portal_role,
        )

    def authenticate(self, email: str, password: str) -> Optional[User]:
        return self.login.authenticate_password(email, password)

    def user_to_out(
        self,
        user: User,
    ) -> UserOut:
        return UserOutputService(self.db).to_out(user)

    def mark_last_login(self, user: User) -> User:
        return self.login.mark_last_login(user)

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
