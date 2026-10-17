# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.db import StorageEndpoint, User
from app.services.audit_service import AuditService
from app.services.rgw_admin import RGWAdminClient


@dataclass(frozen=True)
class CephAdminContext:
    endpoint: StorageEndpoint
    rgw_admin: RGWAdminClient
    s3_endpoint: str
    region: Optional[str]
    access_key: str
    secret_key: str
    actor: Optional[User] = None
    audit_service: Optional[AuditService] = None
