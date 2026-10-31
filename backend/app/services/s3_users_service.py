# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.services.feature_policy_service import (
    apply_resource_feature_overrides,
    validate_manager_overrides,
    validate_multisite_endpoint_switching_override,
    validate_project_collection_overrides,
    validate_project_overrides,
)
from app.services.app_settings_service import load_app_settings_for_db_readonly
from typing import Optional

from sqlalchemy.orm import Session

from app.db import S3User as S3UserModel
from app.services.mappers.s3_user import s3_user_from_db
from app.services.s3_user_associations_service import S3UserAssociationsService
from app.services.s3_user_access_key_service import S3UserAccessKeyService
from app.services.s3_user_deletion_service import S3UserDeletionService
from app.services.s3_user_import_service import S3UserImportService
from app.services.s3_user_metrics_service import S3UserMetricsService
from app.services.s3_user_provisioning_service import S3UserProvisioningService
from app.services.s3_user_query_service import S3UserQueryService
from app.services.s3_user_quota_service import S3UserQuotaService
from app.services.s3_user_repository import S3UserRepository
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.services.tags_service import TagsService
from app.models.s3_user import (
    S3User as S3UserSchema,
    S3UserAccessKey,
    S3UserCreate,
    S3UserGeneratedKey,
    S3UserImport,
    S3UserSummary,
    S3UserUpdate,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError

class S3UsersService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.associations = S3UserAssociationsService(db)
        self.access_keys = S3UserAccessKeyService(db)
        self.metrics = S3UserMetricsService()
        self.rgw_context = S3UserRgwContextService(db)
        self.quota = S3UserQuotaService(self.rgw_context)
        self.repository = S3UserRepository(db)
        self.tags = TagsService(db)
        self.provisioning = S3UserProvisioningService(
            db,
            repository=self.repository,
            rgw_context=self.rgw_context,
            quota=self.quota,
            metrics=self.metrics,
            tags=self.tags,
        )
        self.importer = S3UserImportService(
            db,
            repository=self.repository,
            rgw_context=self.rgw_context,
            metrics=self.metrics,
        )
        self.deletion = S3UserDeletionService(db, self.metrics)
        self.query = S3UserQueryService(
            db,
            rgw_context=self.rgw_context,
            metrics=self.metrics,
            repository=self.repository,
            associations=self.associations,
            tags=self.tags,
        )

    def get_user_usage(self, s3_user: S3UserModel) -> tuple[Optional[int], Optional[int], Optional[int]]:
        return self.metrics.get_usage(s3_user)

    def get_user_quota(
        self,
        s3_user: S3UserModel,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        return self.metrics.get_quota(s3_user, admin)

    def get_user_limits(self, s3_user: S3UserModel) -> tuple[Optional[float], Optional[int], Optional[int]]:
        return self.metrics.get_limits(s3_user)

    def get_user_record(self, user_id: int) -> S3UserModel:
        return self.query.get_user_record(user_id)

    def list_users(self, include_quota: bool = False) -> list[S3UserSchema]:
        return self.query.list_users(include_quota=include_quota)

    def list_users_minimal(self) -> list[S3UserSummary]:
        return self.query.list_users_minimal()

    def paginate_users(
        self,
        page: int,
        page_size: int,
        search: Optional[str] = None,
        sort_field: str = "name",
        sort_direction: str = "asc",
        include_quota: bool = False,
        search_exact: bool = False,
    ) -> tuple[list[S3UserSchema], int]:
        return self.query.paginate_users(
            page=page,
            page_size=page_size,
            search=search,
            sort_field=sort_field,
            sort_direction=sort_direction,
            include_quota=include_quota,
            search_exact=search_exact,
        )

    def get_user(
        self,
        user_id: int,
        include_buckets: bool = False,
        include_quota: bool = False,
    ) -> S3UserSchema:
        return self.query.get_user(
            user_id,
            include_buckets=include_buckets,
            include_quota=include_quota,
        )

    def create_user(self, payload: S3UserCreate) -> S3UserSchema:
        provisioned = self.provisioning.create_user(payload)
        s3_user = provisioned.s3_user
        return s3_user_from_db(
            s3_user,
            user_links=[],
            group_links=[],
            quota_max_size_gb=provisioned.quota_max_size_gb,
            quota_max_objects=provisioned.quota_max_objects,
            storage_endpoint=provisioned.endpoint,
            tags=self.tags.get_s3_user_tags(s3_user),
        )

    def import_users(self, items: list[S3UserImport]) -> list[S3UserSchema]:
        return [
            s3_user_from_db(
                imported.s3_user,
                user_links=[],
                group_links=[],
                quota_max_size_gb=imported.quota_max_size_gb,
                quota_max_objects=imported.quota_max_objects,
                storage_endpoint=imported.endpoint,
                tags=[],
            )
            for imported in self.importer.import_users(items)
        ]

    def update_user(self, user_id: int, payload: S3UserUpdate) -> S3UserSchema:
        s3_user = self.get_user_record(user_id)
        app_settings = load_app_settings_for_db_readonly(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies, s3_user)
        validate_multisite_endpoint_switching_override(
            payload,
            app_settings.manager.feature_policies,
            s3_user,
        )
        validate_project_overrides(payload, app_settings.general.project_feature_policies, s3_user)
        validate_project_collection_overrides(
            payload,
            app_settings.general.project_collection_policies,
            s3_user,
        )
        if payload.name is not None:
            s3_user.name = payload.name
        if payload.email is not None:
            s3_user.email = payload.email
        self.associations.replace_links(
            s3_user,
            user_links=payload.user_links,
            group_links=payload.group_links,
        )
        if payload.tags is not None:
            self.tags.replace_s3_user_tags(s3_user, payload.tags)
        apply_resource_feature_overrides(payload, s3_user)

        if {"quota_max_size_gb", "quota_max_objects"} & payload.model_fields_set:
            self.quota.update(
                s3_user,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )

        self.db.add(s3_user)
        self.db.commit()
        self.db.refresh(s3_user)
        user_links_map, group_links_map = self.associations.load_links([s3_user.id])
        return self.query.serialize_user(
            s3_user,
            user_links_map,
            group_links_map,
        )

    def rotate_keys(self, user_id: int, *, actor=None) -> S3UserSchema:
        s3_user = self.get_user_record(user_id)
        from app.services.durable_key_rotation_service import DurableKeyRotationService
        endpoint = self.rgw_context.endpoint_for_user(s3_user)
        try:
            DurableKeyRotationService(self.db, actor=actor).rotate(endpoint, "s3_user", s3_user.id)
        except RGWAdminError as exc:
            raise ValueError("Rotation is pending; check RGW connectivity and retry.") from exc
        admin = self.rgw_context.admin_for_user(s3_user)
        user_links_map, group_links_map = self.associations.load_links([s3_user.id])
        return self.query.serialize_user(
            s3_user,
            user_links_map,
            group_links_map,
            quota_admin=admin,
        )

    def list_keys(self, user_id: int) -> list[S3UserAccessKey]:
        s3_user = self.get_user_record(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        return self.access_keys.list_keys(s3_user, admin)

    def create_access_key_entry(self, user_id: int) -> S3UserGeneratedKey:
        s3_user = self.get_user_record(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        self.rgw_context.verified_user_tenant(s3_user, admin)
        return self.access_keys.create_key(s3_user, admin)

    def set_key_status(self, user_id: int, access_key: str, active: bool) -> S3UserAccessKey:
        s3_user = self.get_user_record(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        self.rgw_context.verified_user_tenant(s3_user, admin)
        return self.access_keys.set_key_status(s3_user, admin, access_key, active)

    def delete_key(self, user_id: int, access_key: str) -> None:
        s3_user = self.get_user_record(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        self.rgw_context.verified_user_tenant(s3_user, admin)
        self.access_keys.delete_key(s3_user, admin, access_key)

    def delete_user(self, user_id: int, delete_rgw: bool = False) -> None:
        s3_user = self.get_user_record(user_id)
        admin = self.rgw_context.admin_for_user(s3_user)
        self.deletion.delete_user(s3_user, admin, delete_rgw=delete_rgw)


def get_s3_users_service(db: Session) -> S3UsersService:
    return S3UsersService(db)
