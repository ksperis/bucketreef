# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import logging

from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.core.domain_enums import is_admin_ui_role
from app.core.security import get_password_hash
from app.db import User
from app.models.user import UserCreate, validate_password_policy
from app.services.manager_tool_access import MANAGER_TOOL_ROLES, manager_tool_column_values
from app.services.user_associations_service import UserAssociationsService
from app.services.user_query_service import UserQueryService

logger = logging.getLogger(__name__)


class UserProvisioningService:
    """Create local UI users with their initial access and associations."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.query = UserQueryService(db)
        self.associations = UserAssociationsService(db)

    def create_user(self, payload: UserCreate) -> User:
        try:
            if self.query.get_by_email(payload.email):
                raise ValueError("User already exists")

            validate_password_policy(payload.password)
            role = payload.role
            admin_role = is_admin_ui_role(role)
            manager_role = role in MANAGER_TOOL_ROLES
            manager_tool_access = payload.manager_tool_access

            user = User(
                email=payload.email,
                full_name=payload.full_name,
                hashed_password=get_password_hash(payload.password),
                is_active=True,
                role=role,
                can_access_ceph_admin=bool(payload.can_access_ceph_admin) if admin_role else False,
                can_access_storage_ops=(
                    bool(payload.can_access_storage_ops) if manager_role else False
                ),
                can_create_manual_private_connections=(
                    bool(payload.can_create_manual_private_connections)
                    if manager_role
                    else False
                ),
                can_provision_managed_private_connections=(
                    bool(payload.can_provision_managed_private_connections)
                    if manager_role
                    else False
                ),
                allow_multisite_endpoint_switching=(
                    bool(payload.allow_multisite_endpoint_switching)
                    if manager_role
                    else False
                ),
                browser_advanced_features_enabled=bool(
                    payload.browser_advanced_features_enabled
                ),
                **manager_tool_column_values(manager_tool_access, enabled=manager_role),
            )
            self.db.add(user)
            self.db.flush()

            self.associations.apply_updates(user, payload)
            self.db.add(user)
        except Exception:
            self.db.rollback()
            raise

        commit_or_rollback(self.db)
        self.db.refresh(user)
        logger.debug(
            "Created user id=%s email=%s role=%s",
            user.id,
            user.email,
            role,
        )
        return user


def get_user_provisioning_service(db: Session) -> UserProvisioningService:
    return UserProvisioningService(db)
