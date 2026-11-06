# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.db import S3User, S3UserImportIntent, StorageEndpoint
from app.models.s3_user import S3UserImport
from app.services.app_settings_service import load_app_settings_for_db
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.services.s3_user_metrics_service import S3UserMetricsService
from app.services.s3_user_repository import S3UserRepository
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.services.s3_import_state import (
    checkpoint_s3_import_intent,
    new_s3_import_credentials,
)
from app.utils.rgw_payloads import require_rgw_user_identity, split_rgw_tenant_uid
from app.utils.time import utcnow


@dataclass(frozen=True)
class S3UserImportResult:
    s3_user: S3User
    endpoint: StorageEndpoint
    quota_max_size_gb: float | None
    quota_max_objects: int | None


@dataclass(frozen=True)
class _PreparedUserImport:
    source: S3UserImport
    endpoint: StorageEndpoint
    admin: RGWAdminClient
    uid: str
    tenant: str
    user_info: dict


class S3UserImportService:
    """Import existing RGW users into BucketReef-managed S3 user records."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3UserRepository | None = None,
        rgw_context: S3UserRgwContextService | None = None,
        metrics: S3UserMetricsService | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or S3UserRepository(db)
        self.rgw_context = rgw_context or S3UserRgwContextService(db)
        self.metrics = metrics or S3UserMetricsService()

    def import_users(self, items: list[S3UserImport]) -> list[S3UserImportResult]:
        prepared = self._prepare_imports(items)
        if not prepared:
            return []

        claimed: list[tuple[_PreparedUserImport, S3UserImportIntent]] = []
        try:
            for item in prepared:
                intent = self._claim_intent(item)
                self._ensure_remote_key(item, intent)
                claimed.append((item, intent))

            staged = [
                (item, intent, self._stage_local_user(item, intent))
                for item, intent in claimed
            ]
            for _item, intent, _result in staged:
                self.db.delete(intent)
            commit_or_rollback(self.db)
            return [result for _item, _intent, result in staged]
        except Exception:
            self.db.rollback()
            raise

    def _prepare_imports(self, items: list[S3UserImport]) -> list[_PreparedUserImport]:
        app_settings = load_app_settings_for_db(self.db)
        prepared: list[_PreparedUserImport] = []
        seen: set[tuple[int, str, str]] = set()
        for payload in items:
            uid, tenant = split_rgw_tenant_uid(payload.uid, payload.rgw_tenant)
            if not uid:
                raise ValueError("uid is required")
            endpoint = self.rgw_context.resolve_storage_endpoint(payload.storage_endpoint_id)
            identity = (endpoint.id, tenant, uid)
            if identity in seen:
                continue
            seen.add(identity)
            pending = self._pending_intent_for_identity(
                endpoint_id=endpoint.id,
                uid=uid,
                tenant=tenant,
            )
            if (
                pending is None
                and tenant
                and not app_settings.general.allow_managed_rgw_tenant_creation
            ):
                raise ValueError("Managed RGW tenant creation is disabled")
            if self.repository.find_identity(
                uid=uid,
                tenant=tenant,
                storage_endpoint_id=endpoint.id,
            ):
                continue
            admin = self.rgw_context.admin_for_endpoint(endpoint)
            try:
                user_info = admin.get_user(uid, tenant=tenant or None, allow_not_found=True)
            except RGWAdminError as exc:
                raise ValueError(f"RGW lookup failed for {uid}: {exc}") from exc
            if not user_info or user_info.get("not_found"):
                raise ValueError(f"RGW user {uid} not found")
            require_rgw_user_identity(user_info, uid, tenant)
            prepared.append(
                _PreparedUserImport(
                    source=payload,
                    endpoint=endpoint,
                    admin=admin,
                    uid=uid,
                    tenant=tenant,
                    user_info=user_info,
                )
            )
        return prepared

    def _pending_intent(self, item: _PreparedUserImport) -> S3UserImportIntent | None:
        return self._pending_intent_for_identity(
            endpoint_id=item.endpoint.id,
            uid=item.uid,
            tenant=item.tenant,
        )

    def _pending_intent_for_identity(
        self,
        *,
        endpoint_id: int,
        uid: str,
        tenant: str,
    ) -> S3UserImportIntent | None:
        return self.db.scalar(
            select(S3UserImportIntent).where(
                S3UserImportIntent.storage_endpoint_id == endpoint_id,
                S3UserImportIntent.rgw_tenant == tenant,
                S3UserImportIntent.rgw_user_uid == uid,
            )
        )

    def _claim_intent(self, item: _PreparedUserImport) -> S3UserImportIntent:
        existing = self._pending_intent(item)
        if existing is not None:
            self._validate_intent(existing, item)
            return existing

        access_key_id, secret_access_key = new_s3_import_credentials()
        intent = S3UserImportIntent(
            storage_endpoint_id=item.endpoint.id,
            rgw_user_uid=item.uid,
            rgw_tenant=item.tenant,
            requested_name=item.source.name,
            requested_email=item.source.email,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            phase="prepared",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(intent)
        try:
            commit_or_rollback(self.db)
        except IntegrityError:
            existing = self._pending_intent(item)
            if existing is None:
                raise
            self._validate_intent(existing, item)
            return existing
        self.db.refresh(intent)
        return intent

    @staticmethod
    def _validate_intent(intent: S3UserImportIntent, item: _PreparedUserImport) -> None:
        if (
            intent.storage_endpoint_id != item.endpoint.id
            or intent.rgw_user_uid != item.uid
            or intent.rgw_tenant != item.tenant
            or intent.requested_name != item.source.name
            or intent.requested_email != item.source.email
        ):
            raise ValueError(
                "S3 user import is already pending with different request metadata"
            )

    def _load_remote_user(self, item: _PreparedUserImport) -> dict:
        try:
            user_info = item.admin.get_user(
                item.uid,
                tenant=item.tenant or None,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW lookup failed for {item.uid}: {exc}") from exc
        if not user_info or user_info.get("not_found"):
            raise ValueError(f"RGW user {item.uid} not found")
        require_rgw_user_identity(user_info, item.uid, item.tenant)
        return user_info

    def _ensure_remote_key(
        self,
        item: _PreparedUserImport,
        intent: S3UserImportIntent,
    ) -> None:
        user_info = self._load_remote_user(item)
        key_ids = RgwUserKeyParser.access_key_ids(item.admin.extract_keys(user_info))

        if intent.phase == "prepared":
            while intent.access_key_id in key_ids:
                intent.access_key_id, intent.secret_access_key = new_s3_import_credentials()
                intent.updated_at = utcnow()
                commit_or_rollback(self.db)
                self.db.refresh(intent)
            checkpoint_s3_import_intent(self.db, intent, "creating")

        if intent.phase not in {"creating", "remote_created"}:
            raise ValueError(f"Unsupported S3 user import phase: {intent.phase}")

        user_info = self._load_remote_user(item)
        access_key, secret_key = RgwUserKeyParser.credentials_for_access_key(
            item.admin.extract_keys(user_info),
            intent.access_key_id,
        )
        if access_key is not None and secret_key != intent.secret_access_key:
            raise ValueError(
                "RGW access key collides with the pending S3 user import credential"
            )
        if access_key is None:
            try:
                item.admin.create_access_key(
                    item.uid,
                    tenant=item.tenant or None,
                    access_key=intent.access_key_id,
                    secret_key=intent.secret_access_key,
                )
            except RGWAdminError as exc:
                raise ValueError(f"Unable to create access key for {item.uid}: {exc}") from exc
            user_info = self._load_remote_user(item)
            access_key, secret_key = RgwUserKeyParser.credentials_for_access_key(
                item.admin.extract_keys(user_info),
                intent.access_key_id,
            )
            if access_key is None or secret_key != intent.secret_access_key:
                raise ValueError(
                    f"RGW did not persist the requested access credential for {item.uid}"
                )

        if intent.phase != "remote_created":
            checkpoint_s3_import_intent(self.db, intent, "remote_created")

    def _stage_local_user(
        self,
        item: _PreparedUserImport,
        intent: S3UserImportIntent,
    ) -> S3UserImportResult:
        s3_user = S3User(
            name=item.source.name or item.user_info.get("display_name") or item.uid,
            rgw_user_uid=item.uid,
            rgw_tenant=item.tenant,
            email=item.source.email or item.user_info.get("email"),
            rgw_access_key=intent.access_key_id,
            rgw_secret_key=intent.secret_access_key,
            storage_endpoint_id=item.endpoint.id,
        )
        self.db.add(s3_user)
        self.db.flush()
        quota_max_size_gb, quota_max_objects = self.metrics.get_quota(s3_user, item.admin)
        return S3UserImportResult(
            s3_user=s3_user,
            endpoint=item.endpoint,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
        )
