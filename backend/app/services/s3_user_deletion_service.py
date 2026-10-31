# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3User, UiGroupS3User, UserS3User
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.s3_user_metrics_service import S3UserMetricsService
from app.services.tags_service import TagsService
from app.utils.rgw_payloads import require_rgw_user_identity
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED


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
            if not any(
                key.get("access_key") == s3_user.rgw_access_key
                for key in admin.extract_keys(remote)
            ):
                raise ValueError("RGW user no longer owns its stored access key")
            return tenant, True

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
                return tenant, False
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
        tenant, remote_exists = self._verify_remote_user_for_deletion(s3_user, admin)
        if not remote_exists:
            self._delete_local_user(s3_user)
            return

        if delete_rgw:
            bucket_count = self.metrics.get_interface_bucket_count(s3_user)
            if bucket_count is None:
                raise ValueError("Unable to verify owned buckets; cannot delete the RGW user.")
            if bucket_count > 0:
                raise ValueError(
                    f"RGW user still owns {bucket_count} bucket(s); delete them first."
                )
            try:
                admin.delete_user(s3_user.rgw_user_uid, tenant=tenant or None)
            except RGWAdminError as exc:
                raise ValueError(
                    f"Unable to delete RGW user {s3_user.rgw_user_uid}: {exc}"
                ) from exc
        else:
            key_to_delete = (s3_user.rgw_access_key or "").strip()
            if key_to_delete:
                try:
                    admin.delete_access_key(
                        s3_user.rgw_user_uid,
                        key_to_delete,
                        tenant=tenant or None,
                    )
                except RGWAdminError as exc:
                    raise ValueError(f"Unable to delete interface access key: {exc}") from exc

        self._delete_local_user(s3_user)

    def _delete_local_user(self, s3_user: S3User) -> None:
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
        self.db.delete(s3_user)
        self.db.flush()
        self.tags.cleanup_orphan_definitions(domain_kinds=[TAG_DOMAIN_ADMIN_MANAGED])
        self.db.commit()
