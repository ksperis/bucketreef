# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitize_error_detail
from app.db import ManagerAccessKeyMetadata, S3Account, S3User
from app.db.enums import StorageProvider
from app.services.audit_service import AuditService
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.rgw_iam import get_iam_service
from app.services.s3_execution_context import S3ExecutionContext
from app.services.s3_users_service import S3UsersService
from app.utils.s3_endpoint import resolve_iam_client_options
from app.utils.time import utcnow


class PermanentExpirationError(RuntimeError):
    pass

class AccessKeyExpirationService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run_due(self) -> dict[str, int | str]:
        now = utcnow()
        rows = (
            self.db.query(ManagerAccessKeyMetadata)
            .filter(
                ManagerAccessKeyMetadata.expires_at.is_not(None),
                ManagerAccessKeyMetadata.expires_at <= now,
                or_(
                    ManagerAccessKeyMetadata.expiration_state.is_(None),
                    ManagerAccessKeyMetadata.expiration_state.in_(["scheduled", "retrying"]),
                ),
            )
            .order_by(ManagerAccessKeyMetadata.expires_at.asc(), ManagerAccessKeyMetadata.id.asc())
            .limit(500)
            .all()
        )
        counts = {"processed": 0, "enforced": 0, "retried": 0, "blocked": 0, "missing": 0}
        for row in rows:
            counts["processed"] += 1
            outcome = self._process(row)
            counts[outcome] += 1
        return {"status": "ok", **counts}

    def _process(self, row: ManagerAccessKeyMetadata) -> str:
        row.expiration_last_attempt_at = utcnow()
        row.expiration_last_error = None
        self.db.commit()
        try:
            if row.account_id is not None:
                return self._process_iam(row)
            if row.s3_user_id is not None:
                return self._process_s3_user(row)
            raise PermanentExpirationError("Access-key expiration has no valid resource scope")
        except PermanentExpirationError as exc:
            self._mark_blocked(row, exc)
            return "blocked"
        except Exception as exc:  # noqa: BLE001 - each due key must be retried independently
            self._mark_retry(row, exc)
            return "retried"

    def _process_iam(self, row: ManagerAccessKeyMetadata) -> str:
        account = self.db.query(S3Account).filter(S3Account.id == row.account_id).first()
        if account is None:
            return self._remove_missing(row)
        endpoint = account.storage_endpoint
        if endpoint is None or endpoint.provider != StorageProvider.CEPH.value:
            raise PermanentExpirationError("Individual access-key expiration is supported only for Ceph RGW accounts")
        if not row.principal_name:
            raise PermanentExpirationError("IAM principal is missing for the access-key expiration")
        if ManagedPrivateAccessService(self.db).managed_key("account", account.id, row.access_key_id) is not None:
            raise PermanentExpirationError("Managed private-access keys cannot be expired from the generic key inventory")
        context = S3ExecutionContext.from_account(
            account,
            access_key=account.rgw_access_key,
            secret_key=account.rgw_secret_key,
        )
        access_key, secret_key = context.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("RGW Account credentials are unavailable for expiration enforcement")
        iam_endpoint, region, verify_tls = resolve_iam_client_options(context)
        iam = get_iam_service(
            access_key,
            secret_key,
            endpoint=iam_endpoint,
            region=region,
            verify_tls=verify_tls,
        )
        remote = next(
            (key for key in iam.list_access_keys(row.principal_name) if key.access_key_id == row.access_key_id),
            None,
        )
        if remote is None:
            return self._remove_missing(row)
        if str(remote.status or "Active").strip().lower() not in {"inactive", "disabled", "suspended"}:
            iam.update_access_key_status(row.principal_name, row.access_key_id, "Inactive")
            remote = next(
                (key for key in iam.list_access_keys(row.principal_name) if key.access_key_id == row.access_key_id),
                None,
            )
            if remote is None:
                return self._remove_missing(row)
            if str(remote.status or "Active").strip().lower() not in {"inactive", "disabled", "suspended"}:
                raise RuntimeError("Provider did not confirm the IAM access key as inactive")
        self._mark_enforced(row, entity_type="iam_user", entity_id=row.principal_name, account=account)
        return "enforced"

    def _process_s3_user(self, row: ManagerAccessKeyMetadata) -> str:
        s3_user = self.db.query(S3User).filter(S3User.id == row.s3_user_id).first()
        if s3_user is None:
            return self._remove_missing(row)
        endpoint = s3_user.storage_endpoint
        if endpoint is None or endpoint.provider != StorageProvider.CEPH.value:
            raise PermanentExpirationError("Individual access-key expiration is supported only for Ceph RGW users")
        if row.access_key_id == s3_user.rgw_access_key:
            raise PermanentExpirationError("BucketReef interface access keys cannot be expired; rotate them instead")
        if ManagedPrivateAccessService(self.db).managed_key("s3_user", s3_user.id, row.access_key_id) is not None:
            raise PermanentExpirationError("Managed private-access keys cannot be expired from the generic key inventory")
        service = S3UsersService(self.db)
        remote = next((key for key in service.list_keys(s3_user.id) if key.access_key_id == row.access_key_id), None)
        if remote is None:
            return self._remove_missing(row)
        if remote.is_active:
            remote = service.set_key_status(s3_user.id, row.access_key_id, False)
            if remote.is_active:
                raise RuntimeError("Provider did not confirm the RGW access key as inactive")
        self._mark_enforced(row, entity_type="s3_user", entity_id=str(s3_user.id), account_name=s3_user.name)
        return "enforced"

    def _mark_enforced(
        self,
        row: ManagerAccessKeyMetadata,
        *,
        entity_type: str,
        entity_id: str,
        account: S3Account | None = None,
        account_name: str | None = None,
    ) -> None:
        row.expiration_state = "enforced"
        row.expiration_enforced_at = utcnow()
        row.expiration_last_error = None
        self.db.commit()
        AuditService(self.db).record_action(
            user=None,
            scope="manager",
            action="enforce_access_key_expiration",
            entity_type=entity_type,
            entity_id=entity_id,
            account_id=account.id if account is not None else None,
            account_name=account.name if account is not None else account_name,
            metadata={"access_key_id": row.access_key_id, "workflow": "scheduler"},
            user_email="scheduler@bucketreef.internal",
            user_role="system",
        )

    def _mark_retry(self, row: ManagerAccessKeyMetadata, exc: Exception) -> None:
        self.db.rollback()
        persisted = self.db.query(ManagerAccessKeyMetadata).filter(ManagerAccessKeyMetadata.id == row.id).first()
        if persisted is None:
            return
        persisted.expiration_state = "retrying"
        persisted.expiration_last_attempt_at = utcnow()
        persisted.expiration_last_error = str(sanitize_error_detail(str(exc)))
        self.db.commit()

    def _mark_blocked(self, row: ManagerAccessKeyMetadata, exc: Exception) -> None:
        self.db.rollback()
        persisted = self.db.query(ManagerAccessKeyMetadata).filter(ManagerAccessKeyMetadata.id == row.id).first()
        if persisted is None:
            return
        persisted.expiration_state = "blocked"
        persisted.expiration_last_attempt_at = utcnow()
        persisted.expiration_last_error = str(sanitize_error_detail(str(exc)))
        self.db.commit()

    def _remove_missing(self, row: ManagerAccessKeyMetadata) -> str:
        self.db.delete(row)
        self.db.commit()
        return "missing"
