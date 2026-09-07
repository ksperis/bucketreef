# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared mapping between the Manager tool API contract and persisted grants."""

from app.db import UiGroup, User, UserRole
from app.models.user import ManagerToolAccess


MANAGER_TOOL_ROLES = {
    UserRole.UI_SUPERADMIN.value,
    UserRole.UI_ADMIN.value,
    UserRole.UI_USER.value,
}
MANAGER_TOOL_COLUMNS = {
    tool: f"can_access_manager_{tool}" for tool in ManagerToolAccess.model_fields
}


def manager_tool_column_values(access: ManagerToolAccess, *, enabled: bool = True) -> dict[str, bool]:
    return {
        column: enabled and getattr(access, tool)
        for tool, column in MANAGER_TOOL_COLUMNS.items()
    }


def read_manager_tool_access(source: User | UiGroup) -> ManagerToolAccess:
    return ManagerToolAccess(**{
        tool: bool(getattr(source, column))
        for tool, column in MANAGER_TOOL_COLUMNS.items()
    })
