# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.db import ManagerAccessKeyMetadata, S3Account, S3User
from app.models.access_key_metadata import AccessKeyMetadataInput
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.s3_execution_context import S3ExecutionContext


class AccessKeyMetadataService:
    def __init__(self, db: Session):
        self.db = db

    def enabled_for_context(self, context: S3ExecutionContext) -> bool:
        if not load_app_settings_for_db_readonly(self.db).general.manager_access_key_metadata_enabled:
            return False
        if context.context_kind == "account" and context.id is not None:
            resource = self.db.query(S3Account).filter(S3Account.id == context.id).first()
            return bool(resource and resource.allow_access_key_metadata)
        if context.context_kind == "s3_user" and context.s3_user_id is not None:
            resource = self.db.query(S3User).filter(S3User.id == context.s3_user_id).first()
            return bool(resource and resource.allow_access_key_metadata)
        return False

    def _iam_query(self, account_id: int, principal_name: str):
        return self.db.query(ManagerAccessKeyMetadata).filter(
            ManagerAccessKeyMetadata.account_id == account_id,
            ManagerAccessKeyMetadata.principal_name == principal_name,
        )

    def _s3_user_query(self, s3_user_id: int):
        return self.db.query(ManagerAccessKeyMetadata).filter(
            ManagerAccessKeyMetadata.s3_user_id == s3_user_id,
        )

    def iam_metadata(self, account_id: int, principal_name: str) -> dict[str, ManagerAccessKeyMetadata]:
        return {row.access_key_id: row for row in self._iam_query(account_id, principal_name).all()}

    def s3_user_metadata(self, s3_user_id: int) -> dict[str, ManagerAccessKeyMetadata]:
        return {row.access_key_id: row for row in self._s3_user_query(s3_user_id).all()}

    def set_iam_metadata(
        self,
        account_id: int,
        principal_name: str,
        access_key_id: str,
        payload: AccessKeyMetadataInput,
    ) -> ManagerAccessKeyMetadata | None:
        return self._set(
            self._iam_query(account_id, principal_name).filter(
                ManagerAccessKeyMetadata.access_key_id == access_key_id
            ).first(),
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
            self._s3_user_query(s3_user_id).filter(
                ManagerAccessKeyMetadata.access_key_id == access_key_id
            ).first(),
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
        name = payload.name
        notes = payload.notes
        if row is None and name is None and notes is None:
            return None
        if row is None:
            row = ManagerAccessKeyMetadata(**identity)
            self.db.add(row)
        row.name = name
        row.notes = notes
        if name is None and notes is None:
            self.db.delete(row)
            self.db.commit()
            return None
        self.db.commit()
        self.db.refresh(row)
        return row

    def delete_iam_metadata(self, account_id: int, principal_name: str, access_key_id: str) -> None:
        self._iam_query(account_id, principal_name).filter(
            ManagerAccessKeyMetadata.access_key_id == access_key_id
        ).delete(synchronize_session=False)
        self.db.commit()

    def delete_iam_principal_metadata(self, account_id: int, principal_name: str) -> None:
        self._iam_query(account_id, principal_name).delete(synchronize_session=False)
        self.db.commit()

    def delete_s3_user_metadata(self, s3_user_id: int, access_key_id: str) -> None:
        self._s3_user_query(s3_user_id).filter(
            ManagerAccessKeyMetadata.access_key_id == access_key_id
        ).delete(synchronize_session=False)
        self.db.commit()

    @staticmethod
    def apply_metadata(keys: Iterable[object], metadata: dict[str, ManagerAccessKeyMetadata]) -> None:
        for key in keys:
            row = metadata.get(getattr(key, "access_key_id", ""))
            if row is not None:
                setattr(key, "name", row.name)
                setattr(key, "notes", row.notes)
