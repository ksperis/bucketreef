# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from app.models.user import (
    EffectiveAccountGroupSource,
    EffectiveAccountMembership,
    EffectiveAccountRoleProvenance,
    EffectiveUserAccess,
    LinkedS3Connection,
    LinkedS3User,
    ManagerToolAccess,
)
from app.services.manager_tool_access import MANAGER_TOOL_COLUMNS
from app.models.access_context import EffectiveAccountGroupRole, EffectiveAccountLink
from app.services.effective_access_contracts import ResolvedUserAccess


def _has_group_feature_source(resolved: ResolvedUserAccess, right_code: str) -> bool:
    return any(
        source.kind == "group"
        for source in resolved.feature_sources.get(right_code, ())
    )


def _group_manager_tool_access(resolved: ResolvedUserAccess) -> ManagerToolAccess:
    return ManagerToolAccess(
        **{
            tool: _has_group_feature_source(resolved, f"manager_{tool}")
            for tool in MANAGER_TOOL_COLUMNS
        }
    )


def _effective_account_group_source(
    source: EffectiveAccountGroupRole,
) -> EffectiveAccountGroupSource:
    return EffectiveAccountGroupSource(
        group_id=source.group_id,
        group_name=source.group_name,
        manager_role=source.manager_role,
        portal_role=source.portal_role,
        determines_effective_manager_role=source.determines_effective_manager_role,
        determines_effective_portal_role=source.determines_effective_portal_role,
        allow_manager_browser_data_access=source.allow_manager_browser_data_access,
    )


def _effective_account_membership(link: EffectiveAccountLink) -> EffectiveAccountMembership:
    return EffectiveAccountMembership(
        account_id=link.account_id,
        manager_role=link.manager_role,
        portal_role=link.portal_role,
        allow_manager_browser_data_access=link.manager_browser_allowed,
        provenance=EffectiveAccountRoleProvenance(
            direct_manager_role=link.direct_manager_role,
            direct_portal_role=link.direct_portal_role,
            direct_determines_effective_manager_role=link.direct_determines_effective_manager_role,
            direct_determines_effective_portal_role=link.direct_determines_effective_portal_role,
            direct_allow_manager_browser_data_access=link.direct_allow_manager_browser_data_access,
            groups=[
                _effective_account_group_source(source)
                for source in link.group_sources
            ],
        ),
    )


def effective_user_access_from_resolved(
    resolved: ResolvedUserAccess,
    *,
    s3_user_names: dict[int, str],
    shared_connection_names: dict[int, str],
) -> EffectiveUserAccess:
    return EffectiveUserAccess(
        can_access_ceph_admin=resolved.can_access_ceph_admin,
        can_access_storage_ops=resolved.can_access_storage_ops,
        can_create_manual_private_connections=resolved.can_create_manual_private_connections,
        can_provision_managed_private_connections=resolved.can_provision_managed_private_connections,
        allow_multisite_endpoint_switching=resolved.allow_multisite_endpoint_switching,
        group_can_provision_managed_private_connections=_has_group_feature_source(
            resolved,
            "managed_private_connection_provision",
        ),
        has_owned_private_connections=resolved.has_owned_private_connections,
        manager_tool_access=resolved.manager_tool_access,
        group_manager_tool_access=_group_manager_tool_access(resolved),
        browser_advanced_features_enabled=resolved.browser_advanced_features_enabled,
        account_links=[
            _effective_account_membership(link)
            for link in resolved.account_links
        ],
        s3_user_details=[
            LinkedS3User(
                id=s3_id,
                name=s3_user_names.get(s3_id) or f"S3 User #{s3_id}",
            )
            for s3_id in resolved.s3_user_ids
        ],
        s3_connection_details=[
            LinkedS3Connection(
                id=connection_id,
                name=shared_connection_names.get(connection_id)
                or f"Connection #{connection_id}",
            )
            for connection_id in resolved.s3_connection_ids
        ],
    )
