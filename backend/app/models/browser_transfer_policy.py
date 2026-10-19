# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from app.models.base import ApiModel

BrowserTransferWorkspace = Literal["browser", "manager", "ceph-admin", "portal"]


class BrowserTransferPolicy(ApiModel):
    workspace: BrowserTransferWorkspace
    context_id: Optional[str]
    connect_sources: list[str]
    policy_id: str
