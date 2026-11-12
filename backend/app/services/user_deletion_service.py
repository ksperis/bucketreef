# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session

from app.core.db_transactions import acquire_sqlite_write_transaction
from app.core.domain_errors import CompensationFailureError, UiUserNotFoundError
from app.db import (
    AccountIAMUser,
    ManagedPrivateAccess,
    PortalIAMRevocation,
    S3Account,
    S3Connection,
    TagDefinition,
    User,
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

    def _acquire_sqlite_write_transaction(self, user_id: int) -> None:
        def acquire_once(write_db: Session) -> None:
            changed = write_db.execute(
                text("UPDATE users SET id = id WHERE id = :user_id"),
                {"user_id": user_id},
            ).rowcount
            if changed != 1:
                raise UiUserNotFoundError("User not found")

        acquire_sqlite_write_transaction(self.db, acquire_once)

    def _require_no_created_shared_connections(self, user_id: int) -> None:
        created_shared_ids = sorted(
            self.db.scalars(
                select(S3Connection.id).where(
                    S3Connection.created_by_user_id == user_id,
                    S3Connection.is_shared.is_(True),
                )
            ).all()
        )
        if created_shared_ids:
            created_shared_str = ", ".join(
                str(connection_id) for connection_id in created_shared_ids
            )
            raise ValueError(
                "Cannot delete user with shared S3 connections created by this user: "
                f"{created_shared_str}"
            )

    def _cleanup_managed_private_accesses(self, user: User) -> None:
        from app.services.managed_private_access_cleanup_service import (
            ManagedPrivateAccessCleanupService,
        )

        cleanup = ManagedPrivateAccessCleanupService(self.db)
        provisionings = list(
            self.db.scalars(
                select(ManagedPrivateAccess)
                .where(ManagedPrivateAccess.owner_user_id == user.id)
                .order_by(ManagedPrivateAccess.id)
            ).all()
        )
        for provisioning in provisionings:
            if provisioning.s3_connection_id is not None:
                cleanup.delete_owned_connection(
                    user=user,
                    connection_id=int(provisioning.s3_connection_id),
                    use_persisted_source=True,
                )
                continue
            if provisioning.state == "cleanup_pending":
                cleanup.retry_provisioning_cleanup(
                    user=user,
                    provisioning_id=int(provisioning.id),
                )
                continue
            if provisioning.state == "failed":
                continue
            raise ValueError(
                "Cannot delete user while managed private access provisioning is still active"
            )

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
                raise CompensationFailureError(
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

    def _delete_failed_managed_private_accesses(self, user_id: int) -> None:
        self.db.execute(
            delete(ManagedPrivateAccess)
            .where(
                ManagedPrivateAccess.owner_user_id == user_id,
                ManagedPrivateAccess.s3_connection_id.is_(None),
                ManagedPrivateAccess.state == "failed",
            )
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
        self._cleanup_managed_private_accesses(user)
        self._acquire_sqlite_write_transaction(user_id)
        user = self.db.get(User, user_id)
        if not user:
            self.db.rollback()
            raise UiUserNotFoundError("User not found")
        try:
            require_no_private_storage_space_ownership(self.db, user_id=user.id)
            self._require_no_created_shared_connections(user.id)
        except Exception:
            self.db.rollback()
            raise
        portal_revocations = self._prepare_portal_revocations(user)
        try:
            self._delete_failed_managed_private_accesses(user.id)
            self._cleanup_owned_tag_definitions(user.id)
            self.db.delete(user)
            self.db.commit()
        except Exception as exc:
            if self._rollback_portal_revocation_transaction(portal_revocations):
                raise CompensationFailureError(
                    "Unable to delete user. Portal IAM rollback also failed."
                ) from exc
            raise
        self._finalize_portal_revocations(portal_revocations)
        logger.debug("Deleted user id=%s email=%s", user.id, user.email)
