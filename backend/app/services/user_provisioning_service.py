# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import logging

from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.core.domain_enums import is_admin_ui_role
from app.core.security import get_password_hash
from app.db import User
from app.models.user import UserCreate, UserCreateAccessPayload, validate_password_policy
from app.services.manager_tool_access import MANAGER_TOOL_ROLES, manager_tool_column_values
from app.services.user_associations_service import UserAssociationsService
from app.services.user_query_service import UserQueryService

logger = logging.getLogger(__name__)


def user_create_access_column_values(payload: UserCreateAccessPayload) -> dict[str, bool]:
    role = payload.role
    manager_role = role in MANAGER_TOOL_ROLES
    return {
        "can_access_ceph_admin": payload.can_access_ceph_admin if is_admin_ui_role(role) else False,
        "can_access_storage_ops": payload.can_access_storage_ops if manager_role else False,
        "can_create_manual_private_connections": (
            payload.can_create_manual_private_connections if manager_role else False
        ),
        "can_provision_managed_private_connections": (
            payload.can_provision_managed_private_connections if manager_role else False
        ),
        "allow_multisite_endpoint_switching": (
            payload.allow_multisite_endpoint_switching if manager_role else False
        ),
        "browser_advanced_features_enabled": payload.browser_advanced_features_enabled,
        **manager_tool_column_values(payload.manager_tool_access, enabled=manager_role),
    }


class UserProvisioningService:
    """Create local UI users with their initial access and associations."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.query = UserQueryService(db)
        self.associations = UserAssociationsService(db)

    def create_user(self, payload: UserCreate) -> User:
        role = payload.role
        staged_password_hash: str | None = None
        if self.db.get_bind().dialect.name == "sqlite":
            validate_password_policy(payload.password)
            staged_password_hash = get_password_hash(payload.password)

        def create_once(write_db: Session) -> int:
            query = UserQueryService(write_db)
            if query.get_by_email(payload.email):
                raise ValueError("User already exists")
            password_hash = staged_password_hash
            if password_hash is None:
                validate_password_policy(payload.password)
                password_hash = get_password_hash(payload.password)
            user = User(
                email=payload.email,
                full_name=payload.full_name,
                hashed_password=password_hash,
                is_active=True,
                role=role,
                **user_create_access_column_values(payload),
            )
            write_db.add(user)
            write_db.flush()

            UserAssociationsService(write_db).apply_updates(user, payload)
            write_db.add(user)
            write_db.flush()
            return int(user.id)

        user_id = run_replayable_db_unit(self.db, create_once)
        user = self.query.require_by_id(user_id)
        self.db.refresh(user)
        logger.debug(
            "Created user id=%s email=%s role=%s",
            user.id,
            user.email,
            role,
        )
        return user
