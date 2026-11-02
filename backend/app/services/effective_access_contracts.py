# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Internal contracts shared by effective-access services and projections."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.services.access_context_contracts import EffectiveAccountLink
from app.models.user import LinkedUiGroup, ManagerToolAccess


@dataclass(frozen=True)
class EffectiveAccessSource:
    """Origin of an effective UI grant used for read-only access auditing."""

    kind: Literal["direct", "group", "platform"]
    group_id: int | None = None
    group_name: str | None = None


@dataclass
class ResolvedUserAccess:
    group_ids: list[int]
    group_details: list[LinkedUiGroup]
    account_links: list[EffectiveAccountLink]
    s3_user_ids: list[int]
    manager_browser_s3_user_ids: list[int]
    s3_connection_ids: list[int]
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    has_owned_private_connections: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool
    feature_sources: dict[str, tuple[EffectiveAccessSource, ...]] = field(default_factory=dict)
    s3_user_sources: dict[int, tuple[EffectiveAccessSource, ...]] = field(default_factory=dict)
    s3_user_browser_sources: dict[int, tuple[EffectiveAccessSource, ...]] = field(default_factory=dict)
    s3_connection_sources: dict[int, tuple[EffectiveAccessSource, ...]] = field(default_factory=dict)

    @property
    def account_ids(self) -> list[int]:
        return [link.account_id for link in self.account_links]

    def account_link_for(self, account_id: int) -> EffectiveAccountLink | None:
        return next((link for link in self.account_links if link.account_id == account_id), None)

    def has_s3_user(self, s3_user_id: int) -> bool:
        return s3_user_id in set(self.s3_user_ids)

    def can_browse_s3_user(self, s3_user_id: int) -> bool:
        return s3_user_id in set(self.manager_browser_s3_user_ids)
