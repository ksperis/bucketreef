# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""OpenStack cloud admission policy for UI users."""

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.db import UiGroup, User, UserUiGroup
from app.db.openstack import OpenStackCloud, cloud_groups, cloud_users
from app.db.ui_group import ALL_USERS_SYSTEM_KEY


def can_connect_openstack_cloud(db: Session, user: User, cloud: OpenStackCloud) -> bool:
    """Return whether a UI user may establish a session with the cloud."""
    if not user.is_active or user.role not in {"ui_user", "ui_admin", "ui_superadmin"} or not cloud.enabled:
        return False
    if db.scalar(
        select(cloud_users.c.user_id).where(
            cloud_users.c.cloud_id == cloud.id,
            cloud_users.c.user_id == user.id,
        )
    ) is not None:
        return True
    return db.scalar(
        select(cloud_groups.c.group_id)
        .join(UiGroup, UiGroup.id == cloud_groups.c.group_id)
        .outerjoin(
            UserUiGroup,
            and_(
                UserUiGroup.group_id == cloud_groups.c.group_id,
                UserUiGroup.user_id == user.id,
            ),
        )
        .where(
            cloud_groups.c.cloud_id == cloud.id,
            or_(
                UiGroup.system_key == ALL_USERS_SYSTEM_KEY,
                UserUiGroup.user_id == user.id,
            ),
        )
        .limit(1)
    ) is not None
