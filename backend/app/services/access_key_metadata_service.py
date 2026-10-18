# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import ManagerAccessKeyMetadata, S3Account, S3User
from app.db.enums import StorageProvider
from app.models.feature_policy import FeaturePolicy, resolve_feature_policy
from app.models.access_key_metadata import AccessKeyMetadata, AccessKeyMetadataInput
from app.models.iam import AccessKey
from app.models.s3_user import S3UserAccessKey, S3UserGeneratedKey
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.time import utcnow


AccessKeyWithMetadata = AccessKey | S3UserAccessKey | S3UserGeneratedKey


class AccessKeyMetadataService:
    def __init__(self, db: Session):
        self.db = db

    def metadata_enabled_for_context(self, context: S3ExecutionContext) -> bool:
        policy = load_app_settings_for_db_readonly(self.db).manager.feature_policies.access_key_metadata
        if policy == FeaturePolicy.DISABLED:
            return False
        if context.context_kind == "account" and context.id is not None:
            resource = self.db.get(S3Account, context.id)
            return bool(resource and resolve_feature_policy(policy, resource.allow_access_key_metadata).enabled)
        if context.context_kind == "s3_user" and context.s3_user_id is not None:
            resource = self.db.get(S3User, context.s3_user_id)
            return bool(resource and resolve_feature_policy(policy, resource.allow_access_key_metadata).enabled)
        return False

    def expiration_enabled_for_context(self, context: S3ExecutionContext) -> bool:
        if not get_settings().scheduled_jobs_enabled:
            return False
        policies = load_app_settings_for_db_readonly(self.db).manager.feature_policies
        policy = policies.access_key_expiration
        if policy == FeaturePolicy.DISABLED:
            return False
        endpoint = context.storage_endpoint
        if endpoint is None or endpoint.provider != StorageProvider.CEPH.value:
            return False
        if context.context_kind == "account" and context.id is not None:
            resource = self.db.get(S3Account, context.id)
            return bool(resource and resolve_feature_policy(policy, resource.allow_access_key_expiration).enabled)
        if context.context_kind == "s3_user" and context.s3_user_id is not None:
            resource = self.db.get(S3User, context.s3_user_id)
            return bool(resource and resolve_feature_policy(policies.ceph_s3_user_keys, resource.allow_access_key_management).enabled
                        and resolve_feature_policy(policy, resource.allow_access_key_expiration).enabled)
        return False

    @staticmethod
    def metadata_requested(payload: AccessKeyMetadataInput) -> bool:
        return bool({"name", "notes"} & payload.model_fields_set)

    @staticmethod
    def expiration_requested(payload: AccessKeyMetadataInput) -> bool:
        return "expires_at" in payload.model_fields_set

    def validate_payload(self, context: S3ExecutionContext, payload: AccessKeyMetadataInput) -> None:
        if self.metadata_requested(payload) and not self.metadata_enabled_for_context(context):
            raise PermissionError("Access-key names and notes are not enabled for this Manager context")
        if self.expiration_requested(payload):
            if not self.expiration_enabled_for_context(context):
                raise PermissionError("Access-key expiration is not enabled for this Manager context")
            if payload.expires_at is not None and payload.expires_at <= utcnow():
                raise ValueError("Access-key expiration must be in the future")

    @staticmethod
    def to_api(row: ManagerAccessKeyMetadata | None) -> AccessKeyMetadata:
        if row is None:
            return AccessKeyMetadata()
        return AccessKeyMetadata(
            name=row.name,
            notes=row.notes,
            expires_at=row.expires_at,
            expiration_state=row.expiration_state,
            expiration_enforced_at=row.expiration_enforced_at,
            expiration_last_attempt_at=row.expiration_last_attempt_at,
            expiration_last_error=row.expiration_last_error,
        )

    @staticmethod
    def _iam_predicates(account_id: int, principal_name: str):
        return (
            ManagerAccessKeyMetadata.account_id == account_id,
            ManagerAccessKeyMetadata.principal_name == principal_name,
        )

    @staticmethod
    def _s3_user_predicates(s3_user_id: int):
        return (
            ManagerAccessKeyMetadata.s3_user_id == s3_user_id,
        )

    def _iam_row(
        self,
        account_id: int,
        principal_name: str,
        access_key_id: str,
    ) -> ManagerAccessKeyMetadata | None:
        return self.db.scalar(
            select(ManagerAccessKeyMetadata).where(
                *self._iam_predicates(account_id, principal_name),
                ManagerAccessKeyMetadata.access_key_id == access_key_id,
            )
        )

    def _s3_user_row(
        self,
        s3_user_id: int,
        access_key_id: str,
    ) -> ManagerAccessKeyMetadata | None:
        return self.db.scalar(
            select(ManagerAccessKeyMetadata).where(
                *self._s3_user_predicates(s3_user_id),
                ManagerAccessKeyMetadata.access_key_id == access_key_id,
            )
        )

    def iam_metadata(self, account_id: int, principal_name: str) -> dict[str, ManagerAccessKeyMetadata]:
        rows = self.db.scalars(
            select(ManagerAccessKeyMetadata).where(
                *self._iam_predicates(account_id, principal_name)
            )
        ).all()
        return {row.access_key_id: row for row in rows}

    def s3_user_metadata(self, s3_user_id: int) -> dict[str, ManagerAccessKeyMetadata]:
        rows = self.db.scalars(
            select(ManagerAccessKeyMetadata).where(
                *self._s3_user_predicates(s3_user_id)
            )
        ).all()
        return {row.access_key_id: row for row in rows}

    def set_iam_metadata(
        self,
        account_id: int,
        principal_name: str,
        access_key_id: str,
        payload: AccessKeyMetadataInput,
    ) -> ManagerAccessKeyMetadata | None:
        return self._set(
            self._iam_row(account_id, principal_name, access_key_id),
            payload,
            account_id=account_id,
            principal_name=principal_name,
            access_key_id=access_key_id,
        )

    def set_s3_user_metadata(
        self,
        s3_user_id: int,
        access_key_id: str,
        payload: AccessKeyMetadataInput,
    ) -> ManagerAccessKeyMetadata | None:
        return self._set(
            self._s3_user_row(s3_user_id, access_key_id),
            payload,
            s3_user_id=s3_user_id,
            access_key_id=access_key_id,
        )

    def _set(
        self,
        row: Optional[ManagerAccessKeyMetadata],
        payload: AccessKeyMetadataInput,
        **identity: object,
    ) -> ManagerAccessKeyMetadata | None:
        fields = payload.model_fields_set
        name = payload.name if "name" in fields else (row.name if row is not None else None)
        notes = payload.notes if "notes" in fields else (row.notes if row is not None else None)
        expires_at = payload.expires_at if "expires_at" in fields else (row.expires_at if row is not None else None)
        if row is None and name is None and notes is None and expires_at is None:
            return None
        if row is None:
            row = ManagerAccessKeyMetadata(**identity)
            self.db.add(row)
        if "name" in fields:
            row.name = payload.name
        if "notes" in fields:
            row.notes = payload.notes
        if "expires_at" in fields:
            row.expires_at = payload.expires_at
            row.expiration_state = "scheduled" if payload.expires_at is not None else None
            row.expiration_enforced_at = None
            row.expiration_last_attempt_at = None
            row.expiration_last_error = None
        if row.name is None and row.notes is None and row.expires_at is None:
            self.db.delete(row)
            self.db.commit()
            return None
        self.db.commit()
        self.db.refresh(row)
        return row

    def delete_iam_metadata(self, account_id: int, principal_name: str, access_key_id: str) -> None:
        self.db.execute(
            delete(ManagerAccessKeyMetadata).where(
                *self._iam_predicates(account_id, principal_name),
                ManagerAccessKeyMetadata.access_key_id == access_key_id,
            )
        )
        self.db.commit()

    def delete_iam_principal_metadata(self, account_id: int, principal_name: str) -> None:
        self.db.execute(
            delete(ManagerAccessKeyMetadata).where(
                *self._iam_predicates(account_id, principal_name),
            )
        )
        self.db.commit()

    def rename_iam_principal_metadata(self, account_id: int, principal_name: str, new_principal_name: str) -> None:
        self.db.execute(
            update(ManagerAccessKeyMetadata)
            .where(
                *self._iam_predicates(account_id, principal_name),
            )
            .values(principal_name=new_principal_name)
        )
        self.db.commit()

    def delete_s3_user_metadata(self, s3_user_id: int, access_key_id: str) -> None:
        self.db.execute(
            delete(ManagerAccessKeyMetadata).where(
                *self._s3_user_predicates(s3_user_id),
                ManagerAccessKeyMetadata.access_key_id == access_key_id,
            )
        )
        self.db.commit()

    def expiration_due(
        self,
        *,
        access_key_id: str,
        account_id: int | None = None,
        principal_name: str | None = None,
        s3_user_id: int | None = None,
    ) -> bool:
        if account_id is not None and principal_name is not None:
            row = self._iam_row(account_id, principal_name, access_key_id)
        elif s3_user_id is not None:
            row = self._s3_user_row(s3_user_id, access_key_id)
        else:
            return False
        return bool(row and row.expires_at is not None and row.expires_at <= utcnow())

    @staticmethod
    def apply_metadata(
        keys: Iterable[AccessKeyWithMetadata],
        metadata: dict[str, ManagerAccessKeyMetadata],
        *,
        include_labels: bool = True,
    ) -> None:
        for key in keys:
            row = metadata.get(key.access_key_id)
            if row is not None:
                if include_labels:
                    key.name = row.name
                    key.notes = row.notes
                key.expires_at = row.expires_at
                key.expiration_state = row.expiration_state
                key.expiration_enforced_at = row.expiration_enforced_at
                key.expiration_last_attempt_at = row.expiration_last_attempt_at
                key.expiration_last_error = row.expiration_last_error
