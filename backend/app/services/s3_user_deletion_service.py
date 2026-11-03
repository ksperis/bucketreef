# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3User, S3UserDeletion, UiGroupS3User, UserS3User
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.s3_user_metrics_service import S3UserMetricsService
from app.services.tags_service import TagsService
from app.utils.rgw_payloads import require_rgw_user_identity
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED
from app.utils.time import utcnow


_DELETE_ACCESS_KEY = "access_key"
_DELETE_REMOTE_USER = "remote_user"


class S3UserDeletionService:
    """Delete persisted S3 users and their remote RGW resources safely."""

    def __init__(
        self,
        db: Session,
        metrics: S3UserMetricsService | None = None,
    ) -> None:
        self.db = db
        self.metrics = metrics or S3UserMetricsService()
        self.tags = TagsService(db)

    @staticmethod
    def _verify_remote_user_for_deletion(
        s3_user: S3User,
        admin: RGWAdminClient,
    ) -> tuple[str, bool]:
        tenant = s3_user.rgw_tenant
        remote = S3UserDeletionService._load_remote_user(s3_user, admin)
        if remote is None:
            return tenant, False
        if not any(
            key.get("access_key") == s3_user.rgw_access_key
            for key in admin.extract_keys(remote)
        ):
            raise ValueError("RGW user no longer owns its stored access key")
        return tenant, True

    @staticmethod
    def _load_remote_user(
        s3_user: S3User,
        admin: RGWAdminClient,
    ) -> dict | None:
        tenant = s3_user.rgw_tenant
        try:
            remote = admin.get_user(
                s3_user.rgw_user_uid,
                tenant=tenant or None,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise ValueError(
                f"Unable to verify RGW user before deletion: {sanitized_error_log_detail(exc)}"
            ) from exc
        if remote:
            require_rgw_user_identity(remote, s3_user.rgw_user_uid, tenant)
            return remote

        # get_user(..., allow_not_found=True) intentionally collapses every HTTP 404
        # to None. Re-run strictly so only Ceph's explicit NoSuchUser response is
        # treated as a stale local entry; endpoint/path failures must still block.
        try:
            admin.get_user(
                s3_user.rgw_user_uid,
                tenant=tenant or None,
                allow_not_found=False,
            )
        except RGWAdminError as exc:
            if exc.status_code == 404 and exc.error_code == "NoSuchUser":
                return None
            raise ValueError(
                f"Unable to verify RGW user before deletion: {sanitized_error_log_detail(exc)}"
            ) from exc
        raise ValueError("RGW user could not be verified")

    def delete_user(
        self,
        s3_user: S3User,
        admin: RGWAdminClient,
        *,
        delete_rgw: bool = False,
    ) -> None:
        ResourceDeletionPurgeService(self.db).validate_execution_context_cleanup(
            f"s3u-{s3_user.id}"
        )
        mode = _DELETE_REMOTE_USER if delete_rgw else _DELETE_ACCESS_KEY
        deletion = self._pending_deletion(s3_user.id)
        if deletion is None:
            _tenant, remote_exists = self._verify_remote_user_for_deletion(s3_user, admin)
            if not remote_exists:
                self._delete_local_user(s3_user)
                return
            if delete_rgw:
                self._require_no_remote_buckets(s3_user)
            deletion = self._claim_deletion(s3_user, mode=mode)
        else:
            self._validate_pending_deletion(deletion, s3_user, mode=mode)

        if not deletion.remote_completed:
            self._complete_remote_deletion(s3_user, deletion, admin)
            deletion.remote_completed = True
            deletion.updated_at = utcnow()
            commit_or_rollback(self.db)
            self.db.refresh(deletion)

        self._delete_local_user(s3_user, deletion=deletion)

    def _pending_deletion(self, s3_user_id: int) -> S3UserDeletion | None:
        return self.db.scalar(
            select(S3UserDeletion).where(S3UserDeletion.s3_user_id == s3_user_id)
        )

    def _claim_deletion(self, s3_user: S3User, *, mode: str) -> S3UserDeletion:
        deletion = S3UserDeletion(
            s3_user_id=s3_user.id,
            mode=mode,
            rgw_user_uid=s3_user.rgw_user_uid,
            rgw_tenant=s3_user.rgw_tenant,
            access_key_id=(
                (s3_user.rgw_access_key or "").strip()
                if mode == _DELETE_ACCESS_KEY
                else None
            ),
            remote_completed=False,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(deletion)
        try:
            commit_or_rollback(self.db)
        except IntegrityError:
            existing = self._pending_deletion(s3_user.id)
            if existing is None:
                raise
            self._validate_pending_deletion(existing, s3_user, mode=mode)
            return existing
        self.db.refresh(deletion)
        return deletion

    @staticmethod
    def _validate_pending_deletion(
        deletion: S3UserDeletion,
        s3_user: S3User,
        *,
        mode: str,
    ) -> None:
        if deletion.mode != mode:
            raise ValueError(
                "S3 user deletion is already pending with a different deletion mode"
            )
        expected_key = (
            (s3_user.rgw_access_key or "").strip()
            if mode == _DELETE_ACCESS_KEY
            else None
        )
        if (
            deletion.rgw_user_uid != s3_user.rgw_user_uid
            or deletion.rgw_tenant != s3_user.rgw_tenant
            or deletion.access_key_id != expected_key
        ):
            raise ValueError("S3 user identity changed while deletion was pending")

    def _complete_remote_deletion(
        self,
        s3_user: S3User,
        deletion: S3UserDeletion,
        admin: RGWAdminClient,
    ) -> None:
        remote = self._load_remote_user(s3_user, admin)
        if remote is None:
            return

        tenant = deletion.rgw_tenant or None
        if deletion.mode == _DELETE_REMOTE_USER:
            self._require_no_remote_buckets(s3_user)
            try:
                admin.delete_user(deletion.rgw_user_uid, tenant=tenant)
            except RGWAdminError as exc:
                raise ValueError(
                    f"Unable to delete RGW user {deletion.rgw_user_uid}: {exc}"
                ) from exc
            return

        access_key_id = deletion.access_key_id or ""
        if not any(
            key.get("access_key") == access_key_id
            for key in admin.extract_keys(remote)
        ):
            return
        try:
            admin.delete_access_key(
                deletion.rgw_user_uid,
                access_key_id,
                tenant=tenant,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to delete interface access key: {exc}") from exc

    def _require_no_remote_buckets(self, s3_user: S3User) -> None:
        bucket_count = self.metrics.get_interface_bucket_count(s3_user)
        if bucket_count is None:
            raise ValueError("Unable to verify owned buckets; cannot delete the RGW user.")
        if bucket_count > 0:
            raise ValueError(
                f"RGW user still owns {bucket_count} bucket(s); delete them first."
            )

    def _delete_local_user(
        self,
        s3_user: S3User,
        *,
        deletion: S3UserDeletion | None = None,
    ) -> None:
        try:
            self.db.execute(
                delete(UserS3User)
                .where(UserS3User.s3_user_id == s3_user.id)
                .execution_options(synchronize_session=False)
            )
            self.db.execute(
                delete(UiGroupS3User)
                .where(UiGroupS3User.s3_user_id == s3_user.id)
                .execution_options(synchronize_session=False)
            )
            purge = ResourceDeletionPurgeService(self.db)
            purge.purge_s3_user_derived_data(s3_user.id)
            purge.purge_execution_context_data(f"s3u-{s3_user.id}")
            if deletion is not None:
                self.db.delete(deletion)
            self.db.delete(s3_user)
            self.db.flush()
            self.tags.cleanup_orphan_definitions(domain_kinds=[TAG_DOMAIN_ADMIN_MANAGED])
        except Exception:
            self.db.rollback()
            raise
        commit_or_rollback(self.db)
