# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared Portal access construction for HTTP and administrative workflows."""
from app.models.access_context import AccountAccess
from app.models.account_capabilities import AccountCapabilities
from app.services.effective_access_service import EffectiveAccessService


def portal_membership_capabilities(link):
    role = link.portal_role if link else None
    if role is None:
        return None, AccountCapabilities()
    manager = role == "portal_manager"
    return role, AccountCapabilities(
        can_manage_buckets=manager, can_manage_portal_users=manager,
        can_manage_iam=False, can_view_root_key=False, using_root_key=False,
    )


def resolve_portal_account_access(db, user, account_id):
    service = EffectiveAccessService(db)
    resolved = service.resolve_user(user)
    account = next((account for account in service.list_portal_accounts(user, resolved=resolved) if account.id == account_id), None)
    if account is None:
        raise ValueError("Portal account is not authorized or compatible")
    link = resolved.account_link_for(account.id)
    role, capabilities = portal_membership_capabilities(link)
    return AccountAccess(account=account, actor=user, membership=link, capabilities=capabilities, portal_role=role)
