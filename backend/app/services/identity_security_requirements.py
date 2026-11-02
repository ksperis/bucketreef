# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from sqlalchemy.orm import Session

from app.db import UserRole
from app.services.app_settings_service import load_app_settings_for_db


STANDARD_UI_ROLES = {UserRole.UI_USER.value, UserRole.UI_NONE.value}
PRIVILEGED_UI_ROLES = {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}


def passkey_required_for_role(db: Session, role: str) -> bool:
    general = load_app_settings_for_db(db).general
    if role in PRIVILEGED_UI_ROLES:
        return bool(general.require_passkey_for_admins)
    if role in STANDARD_UI_ROLES:
        return bool(general.require_passkey_for_users)
    return False
