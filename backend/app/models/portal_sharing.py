# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal collaboration, sharing, and public-link API contracts."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import AwareDatetime, Field

from app.db import PortalAccountRole
from app.models.base import ApiModel
from app.models.portal_storage_spaces import (
    PortalStorageSpaceAccountMemberRole,
    PortalStorageSpaceGrantRole,
    PortalStorageSpaceRole,
)
from app.models.user import UserAvatar


PortalStorageSpaceShareDirection = Literal["with_me", "by_me"]


class PortalStorageSpaceShare(ApiModel):
    id: str
    storage_space_id: str
    storage_space_name: str
    user_id: Optional[int]
    email: str
    role: PortalStorageSpaceGrantRole
    direction: PortalStorageSpaceShareDirection
    activity_label: str


class PortalStorageSpaceAccessPerson(ApiModel):
    user_id: Optional[int]
    email: str
    display_name: Optional[str]
    role: PortalStorageSpaceRole
    portal_role: Optional[PortalAccountRole]
    access_source: Optional[Literal["owner", "direct", "group", "direct_and_group"]]
    avatar: Optional[UserAvatar]


class PortalStorageSpaceAccessSummary(ApiModel):
    mode: Literal["private", "all", "restricted"]
    default_account_member_role: Optional[PortalStorageSpaceAccountMemberRole]
    owner: Optional[PortalStorageSpaceAccessPerson]
    effective_member_count: int
    explicit_shares: list[PortalStorageSpaceShare]
    public_link_count: int
    can_manage_access: bool
    can_create_public_links: bool


class PortalStorageSpaceShareCandidate(ApiModel):
    user_id: int
    email: str
    display_name: Optional[str]
    portal_role: PortalAccountRole
    access_source: Literal["direct", "group", "direct_and_group"]
    already_shared: bool
    avatar: Optional[UserAvatar]


class PortalCollaborator(ApiModel):
    user_id: int
    email: str
    display_name: Optional[str]
    portal_role: PortalAccountRole
    access_source: Literal["direct", "group", "direct_and_group"]
    member_since: Optional[datetime]
    avatar: Optional[UserAvatar]
    can_review_access: bool


PortalCollaboratorStorageSpaceAccessSource = Literal[
    "direct",
    "team",
    "owner",
    "project_manager",
]


class PortalCollaboratorStorageSpaceAccess(ApiModel):
    storage_space_id: str
    storage_space_name: str
    role: PortalStorageSpaceRole
    source: PortalCollaboratorStorageSpaceAccessSource
    can_revoke: bool


class PortalCollaboratorAccessReview(ApiModel):
    collaborator: PortalCollaborator
    can_request_project_removal: bool
    can_request_role_change: bool
    space_accesses: list[PortalCollaboratorStorageSpaceAccess]


class PortalCollaboratorTrend(ApiModel):
    window: Literal["month", "week", "day"]
    label: str
    period_start: str
    collaborator_count: int


class PortalCollaboratorSummary(ApiModel):
    collaborator_count: int
    external_access_key_count: int
    trend: Optional[PortalCollaboratorTrend]


class PortalCollaboratorsResponse(ApiModel):
    summary: PortalCollaboratorSummary
    collaborators: list[PortalCollaborator]


class PortalStorageSpaceSharePayload(ApiModel):
    email: Optional[str] = None
    user_id: Optional[int] = None
    role: PortalStorageSpaceGrantRole


class PortalStorageSpaceShareUpdate(ApiModel):
    role: PortalStorageSpaceGrantRole


class PortalPublicLink(ApiModel):
    id: int
    storage_space_id: str
    storage_space_name: str
    object_key: str
    object_name: str
    url: str
    label: Optional[str]
    created_by_email: Optional[str]
    created_at: datetime
    expires_at: Optional[datetime]
    revoked_at: Optional[datetime]
    status: str


class PortalPublicLinkCreate(ApiModel):
    object_key: str = Field(min_length=1)
    label: Optional[str] = Field(default=None, max_length=120)
    expires_at: Optional[AwareDatetime] = None
