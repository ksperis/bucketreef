# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import (
    PortalAccountRole,
    PortalAdminRequest,
    UiGroupS3Account,
    User,
    UserRole,
    UserS3Account,
    UserUiGroup,
)
from app.models.access_context import AccountAccess
from app.models.portal_requests import PortalUserAccessRequestCreate
from app.services.portal_service import PortalService
from app.services.users_service import UsersService
from app.utils.time import utcnow


_PORTAL_ROLES = {
    PortalAccountRole.PORTAL_USER.value,
    PortalAccountRole.PORTAL_MANAGER.value,
}


class PortalCollaboratorRequestsService:
    """Validate and execute Portal collaborator request mutations."""

    def __init__(self, db: Session, *, users_service: UsersService) -> None:
        self.db = db
        self.users_service = users_service

    def _direct_portal_link(self, user_id: int, account_id: int) -> UserS3Account | None:
        return self.db.execute(
            select(UserS3Account).where(
                UserS3Account.user_id == user_id,
                UserS3Account.account_id == account_id,
            )
        ).scalar_one_or_none()

    def normalize_user_access_request(
        self,
        actor: User,
        access: AccountAccess,
        payload: PortalUserAccessRequestCreate,
    ) -> tuple[str, dict[str, Any]]:
        if payload.intent == "add":
            return payload.request_type, payload.model_dump(
                mode="json",
                exclude={"request_type"},
                exclude_none=True,
            )

        if payload.target_user_id is None:
            raise ValueError("Target user is required")
        if int(actor.id) == int(payload.target_user_id):
            raise ValueError("Portal managers cannot change their own project role")
        target = self.db.execute(
            select(User).where(User.id == int(payload.target_user_id))
        ).scalar_one_or_none()
        if not target or not target.is_active:
            raise ValueError("Target user was not found or is inactive")
        link = self._direct_portal_link(
            int(target.id),
            int(access.account.id),
        )
        if not link or link.portal_role not in {
            PortalAccountRole.PORTAL_USER.value,
            PortalAccountRole.PORTAL_MANAGER.value,
        }:
            raise ValueError("Target user has no direct Portal membership in this project")
        if self._has_group_portal_membership(int(target.id), int(access.account.id)):
            raise ValueError("Role changes require direct-only Portal membership")
        if link.portal_role == payload.portal_role:
            raise ValueError("Requested Portal role is unchanged")
        return payload.request_type, {
            "intent": "role_change",
            "target_user_id": int(target.id),
            "target_name": target.full_name or target.email,
            "target_email": target.email,
            "current_portal_role": link.portal_role,
            "portal_role": payload.portal_role,
            **({"reason": payload.reason} if payload.reason is not None else {}),
        }

    @staticmethod
    def is_delegated_execution(
        access: AccountAccess,
        *,
        request_type: str,
        payload_data: dict[str, Any],
    ) -> bool:
        if request_type != "portal_user_access":
            return False
        intent = str(payload_data["intent"])
        if intent == "role_change":
            return bool(access.account.portal_collaborator_role_management_delegated)
        if intent != "add" or not access.account.portal_collaborator_addition_delegated:
            return False
        requested_role = str(payload_data["portal_role"])
        if requested_role == PortalAccountRole.PORTAL_MANAGER.value:
            return bool(access.account.portal_collaborator_role_management_delegated)
        return requested_role == PortalAccountRole.PORTAL_USER.value

    def execute_user_access(
        self,
        row: PortalAdminRequest,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        intent = payload.get("intent")
        if intent == "role_change":
            return self._execute_user_role_change(row, payload)
        if intent != "add":
            raise ValueError("Invalid Portal collaborator request intent")

        target_name, target_email, requested_portal_role = (
            self._validated_user_addition(payload)
        )
        target, created_user = self._resolve_user_addition_target(
            target_name=target_name,
            target_email=target_email,
        )
        existing_link = self._direct_portal_link(
            int(target.id),
            int(row.account_id),
        )
        next_portal_role = self._addition_portal_role(
            existing_link,
            requested_portal_role=requested_portal_role,
        )
        self.users_service.assign_user_to_account(
            int(target.id),
            int(row.account_id),
            manager_role=existing_link.manager_role if existing_link else None,
            portal_role=next_portal_role,
        )
        return {
            "target_user_id": int(target.id),
            "target_email": target.email,
            "created_user": created_user,
            "requested_portal_role": requested_portal_role,
            "portal_role": next_portal_role,
        }

    @staticmethod
    def _validated_user_addition(payload: dict[str, Any]) -> tuple[str, str, str]:
        target_name = str(payload.get("target_name") or "").strip()
        target_email = str(payload.get("target_email") or "").strip().lower()
        requested_portal_role = payload.get("portal_role")
        if not target_name or not target_email:
            raise ValueError("Target user name and email are required")
        if requested_portal_role not in _PORTAL_ROLES:
            raise ValueError("Invalid requested Portal role")
        return target_name, target_email, requested_portal_role

    def _resolve_user_addition_target(
        self,
        *,
        target_name: str,
        target_email: str,
    ) -> tuple[User, bool]:
        target = self.users_service.get_by_email_case_insensitive(target_email)
        if target:
            if not target.is_active:
                raise ValueError("Target user is inactive")
            if not target.full_name:
                target.full_name = target_name
            self.db.add(target)
            return target, False

        target = User(
            email=target_email,
            full_name=target_name,
            hashed_password=None,
            is_active=True,
            role=UserRole.UI_USER.value,
        )
        self.db.add(target)
        # Keep placeholder creation in the same transaction as account assignment.
        # assign_user_to_account owns the commit and rolls back both on failure.
        self.db.flush()
        return target, True

    @staticmethod
    def _addition_portal_role(
        existing_link: UserS3Account | None,
        *,
        requested_portal_role: str,
    ) -> str:
        if (
            existing_link
            and existing_link.portal_role == PortalAccountRole.PORTAL_MANAGER.value
            and requested_portal_role == PortalAccountRole.PORTAL_USER.value
        ):
            return existing_link.portal_role
        return requested_portal_role

    def execute_user_removal(
        self,
        row: PortalAdminRequest,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        target_email = str(payload.get("target_email") or "").strip().lower()
        if not target_email:
            raise ValueError("Target user email is required")

        target = self.users_service.get_by_email_case_insensitive(target_email)
        if not target:
            raise ValueError("Target user was not found")

        link = self._direct_portal_link(
            int(target.id),
            int(row.account_id),
        )
        if not link:
            raise ValueError("Target user is not linked to this Portal project")
        if link.portal_role != PortalAccountRole.PORTAL_USER.value:
            raise ValueError("Only Portal user links can be removed through this request")

        removed_role = link.portal_role
        PortalService(self.db).remove_portal_user(target, row.account)
        if link.manager_role is None:
            self.db.delete(link)
        else:
            link.portal_role = None
            link.updated_at = utcnow()
            self.db.add(link)
        self.db.commit()
        return {
            "target_user_id": int(target.id),
            "target_email": target.email,
            "removed_portal_role": removed_role,
        }

    def _execute_user_role_change(
        self,
        row: PortalAdminRequest,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        target_user_id = payload.get("target_user_id")
        expected_role = payload.get("current_portal_role")
        requested_role = payload.get("portal_role")
        if isinstance(target_user_id, bool) or not isinstance(target_user_id, int) or target_user_id <= 0:
            raise ValueError("Target user is required")
        if expected_role not in _PORTAL_ROLES:
            raise ValueError("Invalid current Portal role")
        if requested_role not in _PORTAL_ROLES:
            raise ValueError("Invalid requested Portal role")
        if requested_role == expected_role:
            raise ValueError("Requested Portal role is unchanged")

        target = self.db.execute(
            select(User).where(User.id == target_user_id)
        ).scalar_one_or_none()
        if not target or not target.is_active:
            raise ValueError("Target user was not found or is inactive")
        link = self._direct_portal_link(
            target_user_id,
            int(row.account_id),
        )
        if not link or link.portal_role is None:
            raise ValueError("Target user has no direct Portal membership in this project")
        if self._has_group_portal_membership(target_user_id, int(row.account_id)):
            raise ValueError("Role changes require direct-only Portal membership")
        if link.portal_role != expected_role:
            raise ValueError("Target user's Portal role changed after this request was created")

        self.users_service.assign_user_to_account(
            target_user_id,
            int(row.account_id),
            manager_role=link.manager_role,
            portal_role=requested_role,
        )
        return {
            "target_user_id": target_user_id,
            "target_email": target.email,
            "previous_portal_role": expected_role,
            "portal_role": requested_role,
        }

    def _has_group_portal_membership(self, user_id: int, account_id: int) -> bool:
        return self.db.execute(
            select(UserUiGroup.id)
            .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
            .where(
                UserUiGroup.user_id == user_id,
                UiGroupS3Account.account_id == account_id,
                UiGroupS3Account.portal_role.is_not(None),
            )
            .limit(1)
        ).scalar_one_or_none() is not None
