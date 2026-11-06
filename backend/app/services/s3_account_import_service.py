# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.db import S3Account, S3AccountImportIntent, StorageEndpoint
from app.models.s3_account import S3Account as S3AccountSchema, S3AccountImport
from app.services.app_settings_service import load_app_settings_for_db
from app.services.mappers.s3_account import s3_account_from_db
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.rgw_admin import RGWAdminClient
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.s3_import_state import (
    checkpoint_s3_import_intent,
    new_s3_import_credentials,
)
from app.utils.rgw_payloads import extract_rgw_account_name
from app.utils.time import utcnow


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
    """Validate and durably import existing RGW accounts into BucketReef."""

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
        if not prepared:
            return []

        claimed: list[tuple[_PreparedAccountImport, S3AccountImportIntent]] = []
        try:
            for item in prepared:
                intent = self._claim_intent(item)
                self._ensure_remote_credentials(item, intent)
                claimed.append((item, intent))

            accounts: list[
                tuple[S3Account, StorageEndpoint, S3AccountImportIntent]
            ] = []
            for item, intent in claimed:
                account = S3Account(
                    name=intent.account_name,
                    rgw_account_id=intent.rgw_account_id,
                    rgw_tenant=intent.rgw_tenant,
                    rgw_access_key=intent.access_key_id,
                    rgw_secret_key=intent.secret_access_key,
                    rgw_user_uid=intent.root_uid,
                    email=intent.requested_email,
                    storage_endpoint_id=intent.storage_endpoint_id,
                )
                self.db.add(account)
                accounts.append((account, item.endpoint, intent))

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
                for account, endpoint, _intent in accounts
            ]
            for _account, _endpoint, intent in accounts:
                self.db.delete(intent)
            commit_or_rollback(self.db)
            return created
        except Exception:
            self.db.rollback()
            raise

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
        pending = self._pending_intent(item.rgw_account_id)
        account_name = (
            pending.account_name
            if pending is not None
            else extract_rgw_account_name(rgw_info) or item.name or item.rgw_account_id
        )
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
        if (
            pending is None
            and rgw_tenant
            and not allow_managed_rgw_tenant_creation
        ):
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

    def _pending_intent(self, rgw_account_id: str) -> S3AccountImportIntent | None:
        return self.db.scalar(
            select(S3AccountImportIntent).where(
                S3AccountImportIntent.rgw_account_id == rgw_account_id
            )
        )

    def _claim_intent(self, item: _PreparedAccountImport) -> S3AccountImportIntent:
        existing = self._pending_intent(item.source.rgw_account_id)
        if existing is not None:
            self._validate_intent(existing, item)
            return existing

        root = self.account_roots.load_existing_root_user(
            item.admin,
            item.root_uid,
            item.source.rgw_account_id,
            item.rgw_tenant,
        )
        access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
            item.admin.extract_keys(root or {})
        )
        if access_key and secret_key:
            credential_action = "reuse"
        else:
            credential_action = "create_key" if root is not None else "create_root"
            access_key, secret_key = new_s3_import_credentials()

        intent = S3AccountImportIntent(
            storage_endpoint_id=item.endpoint.id,
            rgw_account_id=item.source.rgw_account_id,
            rgw_tenant=item.rgw_tenant,
            root_uid=item.root_uid,
            account_name=item.account_name,
            requested_name=item.source.name,
            requested_email=item.source.email,
            credential_action=credential_action,
            access_key_id=access_key,
            secret_access_key=secret_key,
            phase="prepared",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(intent)
        try:
            commit_or_rollback(self.db)
        except IntegrityError:
            existing = self._pending_intent(item.source.rgw_account_id)
            if existing is None:
                raise
            self._validate_intent(existing, item)
            return existing
        self.db.refresh(intent)
        return intent

    @staticmethod
    def _validate_intent(
        intent: S3AccountImportIntent,
        item: _PreparedAccountImport,
    ) -> None:
        if (
            intent.storage_endpoint_id != item.endpoint.id
            or intent.rgw_account_id != item.source.rgw_account_id
            or intent.rgw_tenant != item.rgw_tenant
            or intent.root_uid != item.root_uid
            or intent.requested_name != item.source.name
            or intent.requested_email != item.source.email
        ):
            raise ValueError(
                "S3 account import is already pending with different request metadata"
            )

    def _load_root(self, item: _PreparedAccountImport) -> dict | None:
        return self.account_roots.load_existing_root_user(
            item.admin,
            item.root_uid,
            item.source.rgw_account_id,
            item.rgw_tenant,
        )

    @staticmethod
    def _intent_credentials_in_root(
        item: _PreparedAccountImport,
        intent: S3AccountImportIntent,
        root: dict,
    ) -> bool:
        access_key, secret_key = RgwUserKeyParser.credentials_for_access_key(
            item.admin.extract_keys(root),
            intent.access_key_id,
        )
        if access_key is None:
            return False
        if secret_key != intent.secret_access_key:
            raise ValueError(
                "RGW root access key collides with the pending import credential"
            )
        return True

    def _ensure_remote_credentials(
        self,
        item: _PreparedAccountImport,
        intent: S3AccountImportIntent,
    ) -> None:
        root = self._load_root(item)
        if intent.credential_action == "reuse":
            self._ensure_reused_remote_credentials(item, intent, root)
            return

        self._prepare_remote_credential_creation(item, intent, root)
        if intent.phase not in {"creating", "remote_created"}:
            raise ValueError(f"Unsupported S3 account import phase: {intent.phase}")

        root = self._ensure_remote_root(item, intent)
        self._ensure_remote_root_key(item, intent, root)
        if intent.phase != "remote_created":
            checkpoint_s3_import_intent(self.db, intent, "remote_created")

    def _ensure_reused_remote_credentials(
        self,
        item: _PreparedAccountImport,
        intent: S3AccountImportIntent,
        root: dict | None,
    ) -> None:
        if intent.phase not in {"prepared", "remote_created"}:
            raise ValueError(f"Unsupported S3 account import phase: {intent.phase}")
        if root is None or not self._intent_credentials_in_root(item, intent, root):
            raise ValueError("RGW account root credentials changed during import")
        if intent.phase != "remote_created":
            checkpoint_s3_import_intent(self.db, intent, "remote_created")

    def _prepare_remote_credential_creation(
        self,
        item: _PreparedAccountImport,
        intent: S3AccountImportIntent,
        root: dict | None,
    ) -> None:
        if intent.phase == "prepared":
            while (
                root is not None
                and intent.access_key_id
                in RgwUserKeyParser.access_key_ids(item.admin.extract_keys(root))
            ):
                intent.access_key_id, intent.secret_access_key = new_s3_import_credentials()
                intent.updated_at = utcnow()
                commit_or_rollback(self.db)
                self.db.refresh(intent)
                root = self._load_root(item)
            checkpoint_s3_import_intent(self.db, intent, "creating")

    def _ensure_remote_root(
        self,
        item: _PreparedAccountImport,
        intent: S3AccountImportIntent,
    ) -> dict:
        root = self._load_root(item)
        if root is not None:
            return root
        if intent.credential_action != "create_root":
            raise ValueError("RGW account root disappeared during import")
        item.admin.create_user_with_account_id(
            uid=item.root_uid,
            account_id=item.source.rgw_account_id,
            display_name=item.root_display_name,
            account_root=True,
            generate_key=False,
            tenant=item.rgw_tenant or None,
            access_key=intent.access_key_id,
            secret_key=intent.secret_access_key,
        )
        root = self._load_root(item)
        if root is None:
            raise ValueError("RGW account root could not be verified after creation")
        return root

    def _ensure_remote_root_key(
        self,
        item: _PreparedAccountImport,
        intent: S3AccountImportIntent,
        root: dict,
    ) -> None:
        if not self._intent_credentials_in_root(item, intent, root):
            item.admin.create_access_key(
                item.root_uid,
                tenant=item.rgw_tenant or None,
                access_key=intent.access_key_id,
                secret_key=intent.secret_access_key,
            )
            root = self._load_root(item)
            if root is None or not self._intent_credentials_in_root(item, intent, root):
                raise ValueError(
                    "RGW did not persist the requested root access credential"
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
