# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations


PORTAL_MANAGER_GROUP_NAME = "portal-manager"
PORTAL_USER_GROUP_NAME = "portal-user"
PORTAL_MANAGED_IAM_GROUP_NAMES = frozenset(
    {PORTAL_MANAGER_GROUP_NAME, PORTAL_USER_GROUP_NAME}
)
