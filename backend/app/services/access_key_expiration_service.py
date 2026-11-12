# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.core.sensitive_data import sanitize_persisted_error
from app.db import ManagerAccessKeyMetadata, S3Account, S3User
from app.core.domain_enums import StorageProvider
from app.models.access_key_metadata import AccessKeyExpirationRunResult
from app.models.iam import AccessKey
from app.services.audit_service import AuditService
from app.services.managed_private_access_query_service import (
    ManagedPrivateAccessQueryService,
)
from app.services.rgw_iam import RGWIAMService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.s3_user_access_key_service import S3UserAccessKeyService
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.utils.s3_endpoint import resolve_iam_client_options
from app.utils.time import utcnow


class PermanentExpirationError(RuntimeError):
    pass


class RetryableExpirationError(RuntimeError):
    """Expected operational failure that should be retried by the scheduler."""


class AccessKeyExpirationService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run_due(self) -> AccessKeyExpirationRunResult:
        now = utcnow()
        rows = self.db.execute(
            select(
                ManagerAccessKeyMetadata.id,
                ManagerAccessKeyMetadata.account_id,
                ManagerAccessKeyMetadata.s3_user_id,
            )
            .where(
                ManagerAccessKeyMetadata.expires_at.is_not(None),
                ManagerAccessKeyMetadata.expires_at <= now,
                or_(
                    ManagerAccessKeyMetadata.expiration_state.is_(None),
                    ManagerAccessKeyMetadata.expiration_state.in_(["scheduled", "retrying"]),
                ),
            )
            .order_by(ManagerAccessKeyMetadata.expires_at.asc(), ManagerAccessKeyMetadata.id.asc())
            .limit(500)
        ).all()
        counts = {"processed": 0, "enforced": 0, "retried": 0, "blocked": 0, "missing": 0}
        for row_id, account_id, s3_user_id in rows:
            counts["processed"] += 1
            outcome = self._process(
                int(row_id),
                account_id=account_id,
                s3_user_id=s3_user_id,
            )
            counts[outcome] += 1
        return AccessKeyExpirationRunResult(status="ok", **counts)

    def _process(
        self,
        row_id: int,
        *,
        account_id: int | None,
        s3_user_id: int | None,
    ) -> str:
        attempt_at = utcnow()

        def mark_attempt(write_db: Session) -> bool:
            result = write_db.execute(
                update(ManagerAccessKeyMetadata)
                .where(ManagerAccessKeyMetadata.id == row_id)
                .values(
                    expiration_last_attempt_at=attempt_at,
                    expiration_last_error=None,
                )
            )
            return result.rowcount == 1

        if not run_replayable_db_unit(self.db, mark_attempt):
            return "missing"
        try:
            if account_id is not None:
                return self._process_iam(row_id, int(account_id))
            if s3_user_id is not None:
                return self._process_s3_user(row_id, int(s3_user_id))
            raise PermanentExpirationError("Access-key expiration has no valid resource scope")
        except PermanentExpirationError as exc:
            self._mark_failure(row_id, exc, state="blocked")
            return "blocked"
        except Exception as exc:  # noqa: BLE001 - each due key must be retried independently
            self._mark_failure(row_id, exc, state="retrying")
            return "retried"

    def _process_iam(self, row_id: int, account_id: int) -> str:
        row = self.db.get(ManagerAccessKeyMetadata, row_id)
        account = self.db.get(S3Account, account_id)
        if row is None:
            return "missing"
        if account is None:
            return self._remove_missing(row_id)
        principal_name = self._validated_iam_principal(row, account)
        context, iam = self._iam_service_for_account(account)
        access_key_id = row.access_key_id
        self.db.rollback()
        if not self._ensure_iam_key_inactive(
            iam,
            principal_name=principal_name,
            access_key_id=access_key_id,
        ):
            return self._remove_missing(row_id)
        self._mark_enforced(
            row_id,
            entity_type="iam_user",
            entity_id=principal_name,
            execution_context=context,
        )
        return "enforced"

    def _validated_iam_principal(
        self,
        row: ManagerAccessKeyMetadata,
        account: S3Account,
    ) -> str:
        endpoint = account.storage_endpoint
        if endpoint is None or endpoint.provider != StorageProvider.CEPH.value:
            raise PermanentExpirationError("Individual access-key expiration is supported only for Ceph RGW accounts")
        if not row.principal_name:
            raise PermanentExpirationError("IAM principal is missing for the access-key expiration")
        if ManagedPrivateAccessQueryService(self.db).managed_key(
            "account",
            account.id,
            row.access_key_id,
        ) is not None:
            raise PermanentExpirationError("Managed private-access keys cannot be expired from the generic key inventory")
        return row.principal_name

    @staticmethod
    def _iam_service_for_account(account: S3Account) -> tuple[S3ExecutionContext, RGWIAMService]:
        context = S3ExecutionContext.from_account(
            account,
            access_key=account.rgw_access_key,
            secret_key=account.rgw_secret_key,
        )
        access_key, secret_key = context.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RetryableExpirationError(
                "RGW Account credentials are unavailable for expiration enforcement"
            )
        iam_endpoint, region, verify_tls = resolve_iam_client_options(context)
        iam = RGWIAMService(
            access_key,
            secret_key,
            endpoint=iam_endpoint,
            region=region,
            verify_tls=verify_tls,
        )
        return context, iam

    @staticmethod
    def _find_iam_access_key(
        iam: RGWIAMService,
        *,
        principal_name: str,
        access_key_id: str,
    ) -> AccessKey | None:
        return next(
            (
                key
                for key in iam.list_access_keys(principal_name)
                if key.access_key_id == access_key_id
            ),
            None,
        )

    @staticmethod
    def _iam_key_is_inactive(key: AccessKey) -> bool:
        return str(key.status or "Active").strip().lower() in {
            "inactive",
            "disabled",
            "suspended",
        }

    @classmethod
    def _ensure_iam_key_inactive(
        cls,
        iam: RGWIAMService,
        *,
        principal_name: str,
        access_key_id: str,
    ) -> bool:
        remote = cls._find_iam_access_key(
            iam,
            principal_name=principal_name,
            access_key_id=access_key_id,
        )
        if remote is None:
            return False
        if cls._iam_key_is_inactive(remote):
            return True

        iam.update_access_key_status(principal_name, access_key_id, "Inactive")
        remote = cls._find_iam_access_key(
            iam,
            principal_name=principal_name,
            access_key_id=access_key_id,
        )
        if remote is None:
            return False
        if not cls._iam_key_is_inactive(remote):
            raise RetryableExpirationError(
                "Provider did not confirm the IAM access key as inactive"
            )
        return True

    def _process_s3_user(self, row_id: int, s3_user_id: int) -> str:
        row = self.db.get(ManagerAccessKeyMetadata, row_id)
        s3_user = self.db.get(S3User, s3_user_id)
        if row is None:
            return "missing"
        if s3_user is None:
            return self._remove_missing(row_id)
        endpoint = s3_user.storage_endpoint
        if endpoint is None or endpoint.provider != StorageProvider.CEPH.value:
            raise PermanentExpirationError("Individual access-key expiration is supported only for Ceph RGW users")
        if row.access_key_id == s3_user.rgw_access_key:
            raise PermanentExpirationError("BucketReef interface access keys cannot be expired; rotate them instead")
        if ManagedPrivateAccessQueryService(self.db).managed_key(
            "s3_user",
            s3_user.id,
            row.access_key_id,
        ) is not None:
            raise PermanentExpirationError("Managed private-access keys cannot be expired from the generic key inventory")
        admin = S3UserRgwContextService.admin_for_endpoint(endpoint)
        access_keys = S3UserAccessKeyService()
        access_key_id = row.access_key_id
        execution_context = S3ExecutionContext.from_s3_user(s3_user)
        self.db.expunge(s3_user)
        self.db.expunge(endpoint)
        self.db.rollback()
        remote = next(
            (
                key
                for key in access_keys.list_keys(execution_context, admin)
                if key.access_key_id == access_key_id
            ),
            None,
        )
        if remote is None:
            return self._remove_missing(row_id)
        if remote.is_active:
            remote = access_keys.set_key_status(
                execution_context,
                admin,
                access_key_id,
                False,
            )
            if remote.is_active:
                raise RetryableExpirationError(
                    "Provider did not confirm the RGW access key as inactive"
                )
        self._mark_enforced(
            row_id,
            entity_type="s3_user",
            entity_id=str(s3_user_id),
            execution_context=execution_context,
        )
        return "enforced"

    def _mark_enforced(
        self,
        row_id: int,
        *,
        entity_type: str,
        entity_id: str,
        execution_context: S3ExecutionContext,
    ) -> None:
        enforced_at = utcnow()

        def persist(write_db: Session) -> str | None:
            row = write_db.get(ManagerAccessKeyMetadata, row_id)
            if row is None:
                return None
            row.expiration_state = "enforced"
            row.expiration_enforced_at = enforced_at
            row.expiration_last_error = None
            return row.access_key_id

        access_key_id = run_replayable_db_unit(self.db, persist)
        if access_key_id is None:
            return
        AuditService(self.db).record_action(
            user=None,
            scope="manager",
            action="enforce_access_key_expiration",
            entity_type=entity_type,
            entity_id=entity_id,
            execution_context=execution_context,
            metadata={"access_key_id": access_key_id, "workflow": "scheduler"},
            user_email="scheduler@bucketreef.internal",
            user_role="system",
        )

    def _mark_failure(
        self,
        row_id: int,
        exc: Exception,
        *,
        state: Literal["retrying", "blocked"],
    ) -> None:
        self.db.rollback()
        attempted_at = utcnow()
        persisted_error = sanitize_persisted_error(exc)

        def persist(write_db: Session) -> None:
            row = write_db.get(ManagerAccessKeyMetadata, row_id)
            if row is None:
                return
            row.expiration_state = state
            row.expiration_last_attempt_at = attempted_at
            row.expiration_last_error = persisted_error

        run_replayable_db_unit(self.db, persist)

    def _remove_missing(self, row_id: int) -> str:
        def persist(write_db: Session) -> None:
            row = write_db.get(ManagerAccessKeyMetadata, row_id)
            if row is None:
                return
            write_db.delete(row)

        run_replayable_db_unit(self.db, persist)
        return "missing"
