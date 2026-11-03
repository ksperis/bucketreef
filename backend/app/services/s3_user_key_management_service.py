# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import User
from app.models.s3_user import S3User as S3UserSchema, S3UserAccessKey, S3UserGeneratedKey
from app.services.durable_key_rotation_service import DurableKeyRotationService
from app.services.rgw_admin import RGWAdminError
from app.services.s3_user_access_key_service import S3UserAccessKeyService
from app.services.s3_user_associations_service import S3UserAssociationsService
from app.services.s3_user_query_service import S3UserQueryService
from app.services.s3_user_repository import S3UserRepository
from app.services.s3_user_rgw_context_service import S3UserRgwContextService


class S3UserKeyManagementService:
    """Coordinate S3 user key operations around the persisted RGW identity."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3UserRepository,
        rgw_context: S3UserRgwContextService,
        access_keys: S3UserAccessKeyService,
        associations: S3UserAssociationsService,
        query: S3UserQueryService,
    ) -> None:
        self.db = db
        self.repository = repository
        self.rgw_context = rgw_context
        self.access_keys = access_keys
        self.associations = associations
        self.query = query

    def rotate_keys(
        self,
        user_id: int,
        *,
        actor: User | None = None,
    ) -> S3UserSchema:
        s3_user = self.repository.get(user_id)
        self.repository.ensure_not_pending_deletion(user_id)
        endpoint = self.rgw_context.endpoint_for_user(s3_user)
        try:
            DurableKeyRotationService(self.db, actor=actor).rotate(
                endpoint,
                "s3_user",
                s3_user.id,
            )
        except RGWAdminError as exc:
            raise ValueError(
                "Rotation is pending; check RGW connectivity and retry."
            ) from exc

        admin = self.rgw_context.admin_for_user(s3_user)
        user_links_map, group_links_map = self.associations.load_links([s3_user.id])
        return self.query.serialize_user(
            s3_user,
            user_links_map,
            group_links_map,
            quota_admin=admin,
        )

    def list_keys(self, user_id: int) -> list[S3UserAccessKey]:
        s3_user = self.repository.get(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        return self.access_keys.list_keys(s3_user, admin)

    def create_access_key_entry(self, user_id: int) -> S3UserGeneratedKey:
        s3_user = self.repository.get(user_id)
        self.repository.ensure_not_pending_deletion(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        self.rgw_context.verified_user_tenant(s3_user, admin)
        return self.access_keys.create_key(s3_user, admin)

    def set_key_status(
        self,
        user_id: int,
        access_key: str,
        active: bool,
    ) -> S3UserAccessKey:
        s3_user = self.repository.get(user_id)
        self.repository.ensure_not_pending_deletion(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        self.rgw_context.verified_user_tenant(s3_user, admin)
        return self.access_keys.set_key_status(s3_user, admin, access_key, active)

    def delete_key(self, user_id: int, access_key: str) -> None:
        s3_user = self.repository.get(user_id)
        self.repository.ensure_not_pending_deletion(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        self.rgw_context.verified_user_tenant(s3_user, admin)
        self.access_keys.delete_key(s3_user, admin, access_key)
