# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings as get_runtime_settings
from app.core.runtime_surfaces import runtime_surface_enabled
from app.db import S3Account, S3User, User, is_admin_ui_role
from app.models.execution_context import (
    ExecutionContext,
    WorkspaceAccess,
    WorkspaceAvailability,
)
from app.services import app_settings_service
from app.services.effective_access_service import EffectiveAccessService
from app.services.mappers.execution_context import (
    account_execution_context_from_db,
    connection_execution_context_from_db,
    portal_account_execution_context_from_db,
    s3_user_execution_context_from_db,
)
from app.services.tags_service import TagsService


class ExecutionContextCatalogService:
    """Build execution-context catalogues and workspace availability."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.access_service = EffectiveAccessService(db)
        self.tags_service = TagsService(db)

    def list_contexts(
        self,
        user: User,
        *,
        workspace: str | None = None,
    ) -> list[ExecutionContext]:
        effective = self.access_service.resolve_user(user)
        results: list[ExecutionContext] = []

        if workspace == "browser":
            for account, link in self.access_service.list_browser_portal_accounts(
                user,
                resolved=effective,
            ):
                portal_role = link.portal_role
                if portal_role is None:  # pragma: no cover - filtered by the service
                    continue
                results.append(
                    portal_account_execution_context_from_db(
                        account,
                        tags_service=self.tags_service,
                        portal_role=portal_role,
                        manager_role=link.manager_role,
                    )
                )
        else:
            account_ids = {link.account_id for link in effective.account_links}
            accounts = (
                self.db.scalars(select(S3Account).where(S3Account.id.in_(account_ids))).all()
                if account_ids
                else []
            )
            if workspace == "manager":
                account_by_id = {account.id: account for account in accounts}
                for link in effective.account_links:
                    if not self.access_service.manager_account_allowed(link):
                        continue
                    account = account_by_id.get(link.account_id)
                    if account is not None:
                        results.append(
                            account_execution_context_from_db(
                                account,
                                tags_service=self.tags_service,
                                manager_role=link.manager_role,
                            )
                        )
            else:
                results.extend(
                    account_execution_context_from_db(
                        account,
                        tags_service=self.tags_service,
                    )
                    for account in accounts
                )

            s3_user_ids = set(effective.s3_user_ids)
            s3_users = (
                self.db.scalars(select(S3User).where(S3User.id.in_(s3_user_ids))).all()
                if s3_user_ids
                else []
            )
            results.extend(
                s3_user_execution_context_from_db(
                    s3_user,
                    tags_service=self.tags_service,
                )
                for s3_user in s3_users
            )

        connection_workspace = workspace or "manager"
        results.extend(
            connection_execution_context_from_db(
                connection,
                tags_service=self.tags_service,
            )
            for connection in self.access_service.list_workspace_connections(
                user,
                workspace=connection_workspace,
                resolved=effective,
            )
        )
        return results

    def workspace_access(self, user: User) -> WorkspaceAccess:
        settings = app_settings_service.load_app_settings().general
        runtime = get_runtime_settings()
        effective = self.access_service.resolve_user(user)

        manager_count = (
            sum(
                1
                for link in effective.account_links
                if self.access_service.manager_account_allowed(link)
            )
            + len(effective.s3_user_ids)
            + len(
                self.access_service.list_workspace_connections(
                    user,
                    workspace="manager",
                    resolved=effective,
                )
            )
        )
        browser_count = len(
            self.access_service.list_workspace_connections(
                user,
                workspace="browser",
                resolved=effective,
            )
        ) + len(
            self.access_service.list_browser_portal_accounts(
                user,
                resolved=effective,
            )
        )
        portal_count = len(
            self.access_service.list_portal_accounts(
                user,
                resolved=effective,
            )
        )

        admin_available = bool(
            runtime_surface_enabled(runtime, "admin") and is_admin_ui_role(user.role)
        )
        ceph_admin_available = bool(
            runtime_surface_enabled(runtime, "ceph_admin")
            and settings.ceph_admin_enabled
            and effective.can_access_ceph_admin
        )
        storage_ops_available = bool(
            runtime_surface_enabled(runtime, "storage_ops")
            and settings.storage_ops_enabled
            and effective.can_access_storage_ops
            and manager_count
        )
        manager_available = bool(
            runtime_surface_enabled(runtime, "manager")
            and settings.manager_enabled
            and manager_count
        )
        browser_available = bool(
            runtime_surface_enabled(runtime, "browser")
            and settings.browser_enabled
            and settings.browser_root_enabled
            and browser_count
        )
        portal_available = bool(
            runtime_surface_enabled(runtime, "portal")
            and settings.portal_enabled
            and portal_count
        )

        if admin_available:
            default_workspace = "admin"
        elif manager_available:
            default_workspace = "manager"
        elif storage_ops_available:
            default_workspace = "storage-ops"
        elif portal_available:
            default_workspace = "portal"
        elif browser_available:
            default_workspace = "browser"
        elif ceph_admin_available:
            default_workspace = "ceph-admin"
        else:
            default_workspace = None

        return WorkspaceAccess(
            admin=WorkspaceAvailability(
                available=admin_available,
                context_count=1 if admin_available else 0,
            ),
            ceph_admin=WorkspaceAvailability(
                available=ceph_admin_available,
                context_count=1 if ceph_admin_available else 0,
            ),
            storage_ops=WorkspaceAvailability(
                available=storage_ops_available,
                context_count=manager_count if storage_ops_available else 0,
            ),
            manager=WorkspaceAvailability(
                available=manager_available,
                context_count=manager_count,
            ),
            browser=WorkspaceAvailability(
                available=browser_available,
                context_count=browser_count,
            ),
            portal=WorkspaceAvailability(
                available=portal_available,
                context_count=portal_count,
            ),
            default_workspace=default_workspace,
        )
