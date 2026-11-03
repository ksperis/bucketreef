# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db import S3Account, StorageEndpoint
from app.models.s3_account import S3Account as S3AccountSchema, S3AccountImport
from app.services.app_settings_service import load_app_settings_for_db
from app.services.mappers.s3_account import s3_account_from_db
from app.services.rgw_admin import RGWAdminClient
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.utils.rgw_payloads import extract_rgw_account_name


@dataclass(frozen=True)
class _PreparedAccountImport:
    source: S3AccountImport
    endpoint: StorageEndpoint
    admin: RGWAdminClient
    account_name: str
    root_uid: str
    root_display_name: str
    rgw_tenant: str


class S3AccountImportService:
    """Validate and persist existing RGW accounts imported into BucketReef."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3AccountRepository | None = None,
        rgw_context: S3AccountRgwContextService | None = None,
        account_roots: RgwAccountRootService | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or S3AccountRepository(db)
        self.rgw_context = rgw_context or S3AccountRgwContextService(db)
        self.account_roots = account_roots or RgwAccountRootService()

    def import_accounts(self, imports: list[S3AccountImport]) -> list[S3AccountSchema]:
        prepared = self._prepare_imports(imports)
        resolved = [
            (
                item,
                *self.account_roots.obtain_import_credentials(
                    item.admin,
                    account_id=item.source.rgw_account_id,
                    root_uid=item.root_uid,
                    root_display_name=item.root_display_name,
                    tenant=item.rgw_tenant,
                ),
            )
            for item in prepared
        ]

        accounts: list[tuple[S3Account, StorageEndpoint]] = []
        for item, access_key, secret_key in resolved:
            account = S3Account(
                name=item.account_name,
                rgw_account_id=item.source.rgw_account_id,
                rgw_tenant=item.rgw_tenant,
                rgw_access_key=access_key,
                rgw_secret_key=secret_key,
                rgw_user_uid=item.root_uid,
                email=item.source.email,
                storage_endpoint_id=item.endpoint.id,
            )
            self.db.add(account)
            accounts.append((account, item.endpoint))

        self.db.flush()
        created = [
            s3_account_from_db(
                account,
                quota_max_size_gb=None,
                quota_max_objects=None,
                user_links=[],
                group_links=[],
                storage_endpoint=endpoint,
                storage_endpoint_capabilities=self.rgw_context.endpoint_capabilities(endpoint),
                tags=[],
            )
            for account, endpoint in accounts
        ]
        self.db.commit()
        return created

    def _prepare_imports(self, imports: list[S3AccountImport]) -> list[_PreparedAccountImport]:
        app_settings = load_app_settings_for_db(self.db)
        requested_ids = {item.rgw_account_id for item in imports}
        seen_ids = self.repository.existing_rgw_ids(requested_ids)
        prepared: list[_PreparedAccountImport] = []

        for item in imports:
            if item.rgw_account_id in seen_ids:
                continue
            seen_ids.add(item.rgw_account_id)
            prepared.append(
                self._prepare_import(
                    item,
                    allow_managed_rgw_tenant_creation=app_settings.general.allow_managed_rgw_tenant_creation,
                )
            )

        self._validate_names(prepared)
        return prepared

    def _prepare_import(
        self,
        item: S3AccountImport,
        *,
        allow_managed_rgw_tenant_creation: bool,
    ) -> _PreparedAccountImport:
        endpoint = self.rgw_context.resolve_storage_endpoint(
            item.storage_endpoint_id,
            require_ceph=True,
        )
        admin = self.rgw_context.admin_for_endpoint(endpoint, allow_missing=False)
        if admin is None:
            raise ValueError("Admin operations are disabled for this endpoint.")

        rgw_info = admin.get_account(item.rgw_account_id, allow_not_found=True)
        if not rgw_info or rgw_info.get("not_found"):
            raise ValueError(f"S3Account {item.rgw_account_id} not found in RGW")
        account_name = extract_rgw_account_name(rgw_info) or item.name or item.rgw_account_id
        root_uid, rgw_tenant = self.account_roots.resolve_import_identity(
            admin,
            rgw_info,
            item.rgw_account_id,
            item.root_uid,
        )
        if item.rgw_tenant is not None and item.rgw_tenant != rgw_tenant:
            raise ValueError(
                "Requested RGW tenant does not match the account tenant returned by RGW"
            )
        if rgw_tenant and not allow_managed_rgw_tenant_creation:
            raise ValueError("Managed RGW tenant creation is disabled")

        return _PreparedAccountImport(
            source=item,
            endpoint=endpoint,
            admin=admin,
            account_name=account_name,
            root_uid=root_uid,
            root_display_name=self.account_roots.root_display_name(
                account_name,
                item.rgw_account_id,
            ),
            rgw_tenant=rgw_tenant,
        )

    def _validate_names(self, prepared: list[_PreparedAccountImport]) -> None:
        seen_scopes: set[tuple[int, str, str]] = set()
        for item in prepared:
            scope = (item.endpoint.id, item.rgw_tenant, item.account_name)
            if scope in seen_scopes:
                raise ValueError(f"S3Account name already exists: {item.account_name}")
            self.repository.ensure_name_available(
                storage_endpoint_id=item.endpoint.id,
                rgw_tenant=item.rgw_tenant,
                name=item.account_name,
                error_message=f"S3Account name already exists: {item.account_name}",
            )
            seen_scopes.add(scope)
