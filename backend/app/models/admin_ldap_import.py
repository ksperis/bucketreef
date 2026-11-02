# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from pydantic import EmailStr, Field, model_validator

from app.models.base import ApiModel
from app.models.user import ManagerToolAccess, UiRole, UserCreateAssociationsPayload


class LDAPImportMatchedUser(ApiModel):
    id: int
    email: str
    full_name: Optional[str]
    role: UiRole


class LDAPImportSearchItem(ApiModel):
    selection_token: str
    provider_id: str
    email: Optional[str]
    full_name: Optional[str]
    directory_dn: str
    identity_state: Literal["available", "linked", "revoked"]
    linked_user: Optional[LDAPImportMatchedUser] = None
    email_match_user: Optional[LDAPImportMatchedUser] = None


class LDAPImportSearchResponse(ApiModel):
    items: list[LDAPImportSearchItem]
    truncated: bool


class LDAPImportCreatePayload(UserCreateAssociationsPayload):
    email: EmailStr
    full_name: Optional[str] = None
    role: UiRole
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool


class LDAPImportRequest(ApiModel):
    selection_token: str = Field(min_length=1, max_length=8192)
    action: Literal["create", "link", "restore"]
    target_user_id: Optional[int] = Field(default=None, ge=1)
    create: Optional[LDAPImportCreatePayload] = None

    @model_validator(mode="after")
    def validate_action_payload(self):
        if self.action == "create":
            if self.create is None:
                raise ValueError("LDAP user creation data is required")
            if self.target_user_id is not None:
                raise ValueError("target_user_id is not valid when creating a user")
        else:
            if self.target_user_id is None:
                raise ValueError("target_user_id is required when linking an LDAP identity")
            if self.create is not None:
                raise ValueError("create data is only valid when creating a user")
        return self
