# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.domain_errors import UiUserNotFoundError
from app.db import (
    AccountIAMUser,
    ApiToken,
    AuditLog,
    AuthSession,
    BucketMigration,
    PortalIAMRevocation,
    RefreshToken,
    S3Account,
    S3Connection,
    TagDefinition,
    User,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
)
from app.services.portal.iam_revocation import PortalIAMRevocationPreparation
from app.services.portal_ownership import require_no_private_storage_space_ownership
from app.utils.tagging import (
    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
)

logger = logging.getLogger(__name__)


class UserDeletionService:
    """Delete a UI user while preserving integrity and retained history."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def _created_private_connection_ids(self, user_id: int) -> list[int]:
        created_connection_rows = self.db.execute(
            select(S3Connection.id, S3Connection.is_shared).where(
                S3Connection.created_by_user_id == user_id
            )
        ).all()
        created_shared_ids = sorted(
            [row[0] for row in created_connection_rows if bool(row[1])]
        )
        if created_shared_ids:
            created_shared_str = ", ".join(
                str(connection_id) for connection_id in created_shared_ids
            )
            raise ValueError(
                "Cannot delete user with shared S3 connections created by this user: "
                f"{created_shared_str}"
            )
        return [row[0] for row in created_connection_rows if not bool(row[1])]

    def _prepare_portal_revocations(
        self,
        user: User,
    ) -> list[PortalIAMRevocationPreparation]:
        from app.services.portal_service import PortalService

        portal_service = PortalService(self.db)
        account_ids = {
            int(account_id)
            for account_id in self.db.scalars(
                select(AccountIAMUser.account_id).where(
                    AccountIAMUser.user_id == user.id
                )
            ).all()
        }
        account_ids.update(
            int(account_id)
            for account_id in self.db.scalars(
                select(PortalIAMRevocation.account_id).where(
                    PortalIAMRevocation.user_id == user.id
                )
            ).all()
        )
        preparations: list[PortalIAMRevocationPreparation] = []
        try:
            for account_id in sorted(account_ids):
                account = self.db.get(S3Account, account_id)
                if account is None:
                    continue
                preparation = portal_service._prepare_portal_iam_revocation(
                    user,
                    account,
                )
                if preparation is not None:
                    preparations.append(preparation)
        except Exception as exc:
            if self._rollback_portal_revocation_transaction(preparations):
                raise RuntimeError(
                    "Unable to prepare Portal IAM revocations. Local or IAM rollback also failed."
                ) from exc
            raise
        return preparations

    def _restore_portal_revocations(
        self,
        preparations: list[PortalIAMRevocationPreparation],
    ) -> bool:
        from app.services.portal_service import PortalService

        service = PortalService(self.db)
        failed = False
        for preparation in reversed(preparations):
            failed = service._rollback_portal_iam_revocation(preparation) or failed
        return failed

    def _rollback_portal_revocation_transaction(
        self,
        preparations: list[PortalIAMRevocationPreparation],
    ) -> bool:
        try:
            self.db.rollback()
        except Exception:
            return True
        return self._restore_portal_revocations(preparations)

    def _finalize_portal_revocations(
        self,
        preparations: list[PortalIAMRevocationPreparation],
    ) -> None:
        from app.services.portal_service import PortalService

        service = PortalService(self.db)
        for preparation in preparations:
            try:
                service._finalize_portal_iam_revocation(
                    user_id=preparation.user_id,
                    account_id=preparation.account_id,
                )
            except Exception as exc:
                logger.warning(
                    "Portal IAM cleanup remains pending after deleting user_id=%s account_id=%s: %s",
                    preparation.user_id,
                    preparation.account_id,
                    exc,
                )

    def _delete_links_and_private_connections(
        self,
        user_id: int,
        created_private_ids: list[int],
    ) -> None:
        # Remove dependent links/tokens first to satisfy FK constraints on PostgreSQL.
        self.db.execute(
            delete(UserS3Account)
            .where(UserS3Account.user_id == user_id)
            .execution_options(synchronize_session=False)
        )
        self.db.execute(
            delete(UserS3User)
            .where(UserS3User.user_id == user_id)
            .execution_options(synchronize_session=False)
        )
        self.db.execute(
            delete(UserS3Connection)
            .where(UserS3Connection.user_id == user_id)
            .execution_options(synchronize_session=False)
        )
        self.db.execute(
            delete(UserUiGroup)
            .where(UserUiGroup.user_id == user_id)
            .execution_options(synchronize_session=False)
        )
        if created_private_ids:
            self.db.execute(
                delete(UserS3Connection)
                .where(UserS3Connection.s3_connection_id.in_(created_private_ids))
                .execution_options(synchronize_session=False)
            )
            self.db.execute(
                delete(S3Connection)
                .where(S3Connection.id.in_(created_private_ids))
                .execution_options(synchronize_session=False)
            )

    def _delete_auth_artifacts(self, user_id: int) -> None:
        self.db.execute(
            delete(ApiToken)
            .where(ApiToken.user_id == user_id)
            .execution_options(synchronize_session=False)
        )
        auth_session_ids = list(
            self.db.scalars(
                select(AuthSession.id).where(AuthSession.user_id == user_id)
            ).all()
        )
        if auth_session_ids:
            self.db.execute(
                delete(RefreshToken)
                .where(RefreshToken.auth_session_id.in_(auth_session_ids))
                .execution_options(synchronize_session=False)
            )
            self.db.execute(
                delete(AuthSession)
                .where(AuthSession.id.in_(auth_session_ids))
                .execution_options(synchronize_session=False)
            )

    def _anonymize_history(self, user_id: int) -> None:
        self.db.execute(
            update(AuditLog)
            .where(AuditLog.user_id == user_id)
            .values(user_id=None)
            .execution_options(synchronize_session=False)
        )
        self.db.execute(
            update(BucketMigration)
            .where(BucketMigration.created_by_user_id == user_id)
            .values(created_by_user_id=None)
            .execution_options(synchronize_session=False)
        )

    def _cleanup_owned_tag_definitions(self, user_id: int) -> None:
        # Private bucket UI tags must disappear with their owner. Turning them
        # into global definitions would silently make private metadata shared.
        self.db.execute(
            delete(TagDefinition)
            .where(
                TagDefinition.owner_user_id == user_id,
                TagDefinition.domain_kind.in_(
                    [
                        TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
                        TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
                    ]
                ),
            )
            .execution_options(synchronize_session=False)
        )
        self.db.execute(
            update(TagDefinition)
            .where(TagDefinition.owner_user_id == user_id)
            .values(owner_user_id=None)
            .execution_options(synchronize_session=False)
        )

    def delete_user(self, user_id: int) -> None:
        user = self.db.get(User, user_id)
        if not user:
            raise UiUserNotFoundError("User not found")
        require_no_private_storage_space_ownership(self.db, user_id=user.id)
        created_private_ids = self._created_private_connection_ids(user.id)
        portal_revocations = self._prepare_portal_revocations(user)
        try:
            self._delete_links_and_private_connections(user.id, created_private_ids)
            self._delete_auth_artifacts(user.id)
            self._anonymize_history(user.id)
            self._cleanup_owned_tag_definitions(user.id)
            self.db.delete(user)
            self.db.commit()
        except Exception as exc:
            if self._rollback_portal_revocation_transaction(portal_revocations):
                raise RuntimeError(
                    "Unable to delete user. Portal IAM rollback also failed."
                ) from exc
            raise
        self._finalize_portal_revocations(portal_revocations)
        logger.debug("Deleted user id=%s email=%s", user.id, user.email)
