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
from app.services.managed_resource_naming import managed_s3_user_uid
from app.services.mappers.s3_user import s3_user_from_db
from app.services.s3_user_associations_service import S3UserAssociationsService
from app.services.s3_user_access_key_service import S3UserAccessKeyService
from app.services.s3_user_deletion_service import S3UserDeletionService
from app.services.s3_user_metrics_service import S3UserMetricsService
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
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.rgw_payloads import (
    require_rgw_user_identity, split_rgw_tenant_uid,
)

class S3UsersService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.associations = S3UserAssociationsService(db)
        self.access_keys = S3UserAccessKeyService(db)
        self.metrics = S3UserMetricsService()
        self.rgw_context = S3UserRgwContextService(db)
        self.quota = S3UserQuotaService(self.rgw_context)
        self.repository = S3UserRepository(db)
        self.deletion = S3UserDeletionService(db, self.metrics)
        self.tags = TagsService(db)
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
        app_settings = load_app_settings_for_db_readonly(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies)
        uid, tenant = split_rgw_tenant_uid((payload.uid or "").strip() or managed_s3_user_uid(), payload.rgw_tenant)
        if tenant and not app_settings.general.allow_managed_rgw_tenant_creation:
            raise ValueError("Managed RGW tenant creation is disabled")
        endpoint = self.rgw_context.resolve_storage_endpoint(payload.storage_endpoint_id)
        from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions
        require_endpoint_permissions(endpoint, "users_write")
        admin = self.rgw_context.admin_for_endpoint(endpoint)
        if self.repository.find_identity(
            uid=uid,
            tenant=tenant,
            storage_endpoint_id=endpoint.id,
        ):
            raise ValueError("An S3 user with this UID already exists in this tenant")
        access_key, secret_key = self._provision_remote_user_credentials(
            admin,
            payload,
            uid=uid,
            tenant=tenant,
        )
        s3_user = S3UserModel(
            name=payload.name,
            rgw_user_uid=uid,
            rgw_tenant=tenant,
            email=payload.email,
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(s3_user)
        self.db.flush()
        self.tags.replace_s3_user_tags(s3_user, payload.tags)

        if payload.quota_max_size_gb is not None or payload.quota_max_objects is not None:
            self.quota.update(
                s3_user,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )

        self.db.commit()
        self.db.refresh(s3_user)
        quota_max_size_gb, quota_max_objects = self.get_user_quota(s3_user, admin)
        return s3_user_from_db(
            s3_user,
            user_links=[],
            group_links=[],
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            storage_endpoint=endpoint,
            tags=self.tags.get_s3_user_tags(s3_user),
        )

    @staticmethod
    def _provision_remote_user_credentials(
        admin: RGWAdminClient,
        payload: S3UserCreate,
        *,
        uid: str,
        tenant: str,
    ) -> tuple[str, str]:
        try:
            response = admin.create_user(
                uid=uid,
                display_name=payload.name,
                email=payload.email or "",
                **({"tenant": tenant} if tenant else {}),
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW user creation failed: {exc}") from exc
        if isinstance(response, dict) and response.get("conflict"):
            raise ValueError("An RGW user with this UID already exists in this tenant")
        access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
            admin.extract_keys(response)
        )
        if not access_key or not secret_key:
            try:
                key_response = admin.create_access_key(uid, tenant=tenant or None)
            except RGWAdminError as exc:
                raise ValueError(f"Unable to obtain RGW access keys: {exc}") from exc
            access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
                admin.extract_keys(key_response)
            )
        if not access_key or not secret_key:
            raise ValueError("RGW did not return access credentials for the new user")
        return access_key, secret_key

    def import_users(self, items: list[S3UserImport]) -> list[S3UserSchema]:
        app_settings = load_app_settings_for_db_readonly(self.db)
        parsed_items: list[tuple[S3UserImport, str, str]] = []
        for payload in items:
            uid, tenant = split_rgw_tenant_uid(payload.uid, payload.rgw_tenant)
            if not uid:
                raise ValueError("uid is required")
            if tenant and not app_settings.general.allow_managed_rgw_tenant_creation:
                raise ValueError("Managed RGW tenant creation is disabled")
            parsed_items.append((payload, uid, tenant))

        created: list[S3UserSchema] = []
        for payload, uid, tenant in parsed_items:
            imported = self._import_user(payload, uid=uid, tenant=tenant)
            if imported is not None:
                created.append(imported)
        self.db.commit()
        return created

    def _import_user(
        self,
        payload: S3UserImport,
        *,
        uid: str,
        tenant: str,
    ) -> S3UserSchema | None:
        endpoint = self.rgw_context.resolve_storage_endpoint(payload.storage_endpoint_id)
        admin = self.rgw_context.admin_for_endpoint(endpoint)
        if self.repository.find_identity(
            uid=uid,
            tenant=tenant,
            storage_endpoint_id=endpoint.id,
        ):
            return None
        try:
            user_info = admin.get_user(uid, tenant=tenant or None, allow_not_found=True)
        except RGWAdminError as exc:
            raise ValueError(f"RGW lookup failed for {uid}: {exc}") from exc
        if not user_info or user_info.get("not_found"):
            raise ValueError(f"RGW user {uid} not found")
        require_rgw_user_identity(user_info, uid, tenant)
        try:
            key_resp = admin.create_access_key(uid, tenant=tenant or None)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to create access key for {uid}: {exc}") from exc
        access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
            admin.extract_keys(key_resp)
        )
        if not access_key or not secret_key:
            raise ValueError(f"RGW did not return access credentials for {uid}")
        s3_user = S3UserModel(
            name=payload.name or user_info.get("display_name") or uid,
            rgw_user_uid=uid,
            rgw_tenant=tenant,
            email=payload.email or user_info.get("email"),
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(s3_user)
        self.db.flush()
        quota_max_size_gb, quota_max_objects = self.get_user_quota(s3_user, admin)
        return s3_user_from_db(
            s3_user,
            user_links=[],
            group_links=[],
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            storage_endpoint=endpoint,
            tags=[],
        )

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
