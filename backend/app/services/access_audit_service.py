# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Read-only effective-access inventory for Admin governance views."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db import ManagerAccountRole, S3Account, S3Connection, S3User, User
from app.models.access_audit import (
    AccessAuditGrantSource,
    AccessAuditPrincipal,
    AccessAuditRight,
    AccessAuditRightCode,
    AccessAuditRow,
    AccessAuditScope,
    AccessAuditSourceKind,
    AccessAuditTarget,
    PaginatedAccessAuditResponse,
)
from app.models.access_context import EffectiveAccountLink
from app.services.effective_access_service import EffectiveAccessService, EffectiveAccessSource


RIGHT_LABELS: dict[AccessAuditRightCode, str] = {
    "ceph_admin": "Ceph Admin",
    "storage_ops": "Storage Ops",
    "manager_bucket_compare": "Manager · Bucket compare",
    "manager_bucket_integrity_check": "Manager · Integrity check",
    "manager_bucket_migration": "Manager · Bucket migration",
    "manager_feature_rules": "Manager · Feature rules",
    "manager_bucket_purge": "Manager · Bucket purge",
    "private_connection_create": "Create manual private connections",
    "managed_private_connection_provision": "Provision managed private connections",
    "browser_advanced_features": "Browser advanced features",
    "account_administrator": "Account administrator",
    "portal_manager": "Portal manager",
    "portal_user": "Portal user",
    "manager_browser_data_access": "Manager Browser data access",
    "rgw_user_access": "RGW user access",
    "shared_connection_access": "Shared S3 connection access",
}

SCOPE_ORDER: dict[AccessAuditScope, int] = {
    "platform": 0,
    "rgw_account": 1,
    "rgw_user": 2,
    "s3_connection": 3,
}


@dataclass(frozen=True)
class AccessAuditFilters:
    search: str | None = None
    scope: AccessAuditScope | None = None
    right: AccessAuditRightCode | None = None
    source: AccessAuditSourceKind | None = None
    user_id: int | None = None
    target_id: int | None = None
    sort_by: str = "user"
    sort_dir: str = "asc"


class AccessAuditService:
    """Build effective rights from EffectiveAccessService and attach provenance."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.effective_access = EffectiveAccessService(db)

    @staticmethod
    def _source(source: EffectiveAccessSource) -> AccessAuditGrantSource:
        return AccessAuditGrantSource(
            kind=source.kind,
            group_id=source.group_id,
            group_name=source.group_name,
        )

    @classmethod
    def _right(
        cls,
        code: AccessAuditRightCode,
        sources: tuple[EffectiveAccessSource, ...] | list[EffectiveAccessSource],
    ) -> AccessAuditRight:
        return AccessAuditRight(
            code=code,
            label=RIGHT_LABELS[code],
            sources=[cls._source(source) for source in sources],
        )

    @staticmethod
    def _direct_source() -> EffectiveAccessSource:
        return EffectiveAccessSource(kind="direct")

    @staticmethod
    def _group_source(group_id: int, group_name: str) -> EffectiveAccessSource:
        return EffectiveAccessSource(kind="group", group_id=group_id, group_name=group_name)

    def _account_rights(self, link: EffectiveAccountLink) -> list[AccessAuditRight]:
        rights: list[AccessAuditRight] = []
        admin_role = ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
        manager_sources: list[EffectiveAccessSource] = []
        if link.direct_manager_role == admin_role:
            manager_sources.append(self._direct_source())
        manager_sources.extend(
            self._group_source(source.group_id, source.group_name)
            for source in link.group_sources
            if source.manager_role == admin_role
        )
        if link.manager_role == admin_role:
            rights.append(self._right("account_administrator", manager_sources))

        if link.portal_role is not None:
            portal_sources: list[EffectiveAccessSource] = []
            if link.direct_determines_effective_portal_role:
                portal_sources.append(self._direct_source())
            portal_sources.extend(
                self._group_source(source.group_id, source.group_name)
                for source in link.group_sources
                if source.determines_effective_portal_role
            )
            portal_code: AccessAuditRightCode = (
                "portal_manager" if link.portal_role == "portal_manager" else "portal_user"
            )
            rights.append(self._right(portal_code, portal_sources))

        browser_sources: list[EffectiveAccessSource] = []
        if (
            link.direct_manager_role == admin_role
            and link.direct_allow_manager_browser_data_access
        ):
            browser_sources.append(self._direct_source())
        browser_sources.extend(
            self._group_source(source.group_id, source.group_name)
            for source in link.group_sources
            if source.manager_role == admin_role
            and source.allow_manager_browser_data_access
        )
        if link.manager_browser_allowed:
            rights.append(self._right("manager_browser_data_access", browser_sources))
        return rights

    @staticmethod
    def _principal(user: User) -> AccessAuditPrincipal:
        return AccessAuditPrincipal(
            id=int(user.id),
            email=str(user.email),
            full_name=user.full_name,
            role=user.role,
            is_active=bool(user.is_active),
        )

    def _build_rows(self, users: list[User]) -> list[AccessAuditRow]:
        if not users:
            return []
        resolved_by_user = self.effective_access.resolve_users(users)
        account_ids = {
            link.account_id
            for resolved in resolved_by_user.values()
            for link in resolved.account_links
        }
        s3_user_ids = {
            s3_user_id
            for resolved in resolved_by_user.values()
            for s3_user_id in resolved.s3_user_ids
        }
        connection_ids = {
            connection_id
            for resolved in resolved_by_user.values()
            for connection_id in resolved.s3_connection_ids
        }
        accounts = {
            int(account.id): account
            for account in self.db.query(S3Account).filter(S3Account.id.in_(account_ids)).all()
        } if account_ids else {}
        s3_users = {
            int(s3_user.id): s3_user
            for s3_user in self.db.query(S3User).filter(S3User.id.in_(s3_user_ids)).all()
        } if s3_user_ids else {}
        connections = {
            int(connection.id): connection
            for connection in self.db.query(S3Connection).filter(
                S3Connection.id.in_(connection_ids),
                S3Connection.is_shared.is_(True),
            ).all()
        } if connection_ids else {}

        rows: list[AccessAuditRow] = []
        platform_order: list[AccessAuditRightCode] = [
            "ceph_admin",
            "storage_ops",
            "manager_bucket_compare",
            "manager_bucket_integrity_check",
            "manager_bucket_migration",
            "manager_feature_rules",
            "manager_bucket_purge",
            "private_connection_create",
            "managed_private_connection_provision",
            "browser_advanced_features",
        ]
        for user in users:
            user_id = int(user.id)
            resolved = resolved_by_user[user_id]
            principal = self._principal(user)
            platform_rights = [
                self._right(code, resolved.feature_sources[code])
                for code in platform_order
                if code in resolved.feature_sources
            ]
            if platform_rights:
                rows.append(
                    AccessAuditRow(
                        key=f"{user_id}:platform",
                        principal=principal,
                        scope="platform",
                        target=AccessAuditTarget(name="Platform"),
                        rights=platform_rights,
                    )
                )

            for link in resolved.account_links:
                account = accounts.get(link.account_id)
                rights = self._account_rights(link)
                if account is None or not rights:
                    continue
                rows.append(
                    AccessAuditRow(
                        key=f"{user_id}:rgw_account:{account.id}",
                        principal=principal,
                        scope="rgw_account",
                        target=AccessAuditTarget(
                            id=int(account.id),
                            name=str(account.name),
                            identifier=str(account.rgw_account_id),
                        ),
                        rights=rights,
                    )
                )

            browser_s3_user_ids = set(resolved.manager_browser_s3_user_ids)
            for s3_user_id in resolved.s3_user_ids:
                s3_user = s3_users.get(s3_user_id)
                if s3_user is None:
                    continue
                rights = [
                    self._right(
                        "rgw_user_access",
                        resolved.s3_user_sources.get(s3_user_id, ()),
                    )
                ]
                if s3_user_id in browser_s3_user_ids:
                    rights.append(
                        self._right(
                            "manager_browser_data_access",
                            resolved.s3_user_browser_sources.get(s3_user_id, ()),
                        )
                    )
                rows.append(
                    AccessAuditRow(
                        key=f"{user_id}:rgw_user:{s3_user_id}",
                        principal=principal,
                        scope="rgw_user",
                        target=AccessAuditTarget(
                            id=int(s3_user.id),
                            name=str(s3_user.name),
                            identifier=str(s3_user.rgw_user_uid),
                        ),
                        rights=rights,
                    )
                )

            for connection_id in resolved.s3_connection_ids:
                connection = connections.get(connection_id)
                if connection is None:
                    continue
                rows.append(
                    AccessAuditRow(
                        key=f"{user_id}:s3_connection:{connection_id}",
                        principal=principal,
                        scope="s3_connection",
                        target=AccessAuditTarget(
                            id=int(connection.id),
                            name=str(connection.name),
                        ),
                        rights=[
                            self._right(
                                "shared_connection_access",
                                resolved.s3_connection_sources.get(connection_id, ()),
                            )
                        ],
                    )
                )
        return rows

    @staticmethod
    def _matches_search(row: AccessAuditRow, search: str) -> bool:
        needle = search.strip().lower()
        if not needle:
            return True
        values = [
            row.principal.email,
            row.principal.full_name or "",
            row.principal.role,
            row.scope,
            row.target.name,
            row.target.identifier or "",
            str(row.target.id or ""),
        ]
        for right in row.rights:
            values.extend([right.code, right.label])
            values.extend(source.group_name or source.kind for source in right.sources)
        return any(needle in str(value).lower() for value in values)

    @staticmethod
    def _matches_filters(row: AccessAuditRow, filters: AccessAuditFilters) -> bool:
        if filters.scope is not None and row.scope != filters.scope:
            return False
        if filters.user_id is not None and row.principal.id != filters.user_id:
            return False
        if filters.target_id is not None and row.target.id != filters.target_id:
            return False
        if filters.right is not None and not any(right.code == filters.right for right in row.rights):
            return False
        if filters.source is not None and not any(
            source.kind == filters.source
            for right in row.rights
            for source in right.sources
        ):
            return False
        if filters.search and not AccessAuditService._matches_search(row, filters.search):
            return False
        return True

    @staticmethod
    def _sort_rows(rows: list[AccessAuditRow], sort_by: str, sort_dir: str) -> list[AccessAuditRow]:
        def user_name(row: AccessAuditRow) -> str:
            return (row.principal.full_name or row.principal.email).lower()

        if sort_by == "scope":
            key = lambda row: (SCOPE_ORDER[row.scope], user_name(row), row.target.name.lower(), row.key)
        elif sort_by == "target":
            key = lambda row: (row.target.name.lower(), user_name(row), SCOPE_ORDER[row.scope], row.key)
        else:
            key = lambda row: (user_name(row), row.principal.email.lower(), SCOPE_ORDER[row.scope], row.target.name.lower(), row.key)
        return sorted(rows, key=key, reverse=sort_dir.lower() == "desc")

    def list_rows(self, filters: AccessAuditFilters) -> list[AccessAuditRow]:
        query = self.db.query(User)
        if filters.user_id is not None:
            query = query.filter(User.id == filters.user_id)
        users = query.order_by(User.email.asc(), User.id.asc()).all()
        rows = [row for row in self._build_rows(users) if self._matches_filters(row, filters)]
        return self._sort_rows(rows, filters.sort_by, filters.sort_dir)

    def paginate(
        self,
        filters: AccessAuditFilters,
        *,
        page: int,
        page_size: int,
    ) -> PaginatedAccessAuditResponse:
        rows = self.list_rows(filters)
        total = len(rows)
        start = (page - 1) * page_size
        items = rows[start:start + page_size]
        return PaginatedAccessAuditResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            has_next=page * page_size < total,
        )

    @staticmethod
    def _source_label(source: AccessAuditGrantSource) -> str:
        return "Direct" if source.kind == "direct" else f"UI Group: {source.group_name or source.group_id}"

    def export_csv(self, filters: AccessAuditFilters) -> tuple[str, str]:
        rows = self.list_rows(filters)
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow([
            "ui_user_id",
            "email",
            "full_name",
            "ui_role",
            "active",
            "scope",
            "target_id",
            "target_name",
            "target_identifier",
            "effective_rights",
            "sources",
        ])
        for row in rows:
            rights = "; ".join(right.label for right in row.rights)
            sources = "; ".join(
                f"{right.label}: {', '.join(self._source_label(source) for source in right.sources)}"
                for right in row.rights
            )
            writer.writerow([
                row.principal.id,
                row.principal.email,
                row.principal.full_name or "",
                row.principal.role,
                "true" if row.principal.is_active else "false",
                row.scope,
                row.target.id or "",
                row.target.name,
                row.target.identifier or "",
                rights,
                sources,
            ])
        return "access-audit.csv", output.getvalue()
