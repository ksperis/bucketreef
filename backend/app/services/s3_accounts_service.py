# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from sqlalchemy.orm import Session

from app.db import S3Account
from app.models.s3_account import (
    PaginatedS3AccountsResponse,
    S3Account as S3AccountSchema,
    S3AccountCreate,
    S3AccountImport,
    S3AccountUpdate,
)
from app.services.mappers.s3_account import s3_account_from_db
from app.services.rgw_admin import RGWAdminClient
from app.services.rgw_account_topics_resolver import RgwAccountTopicsResolver
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.s3_account_associations_service import S3AccountAssociationsService
from app.services.s3_account_deletion_service import S3AccountDeletionService
from app.services.s3_account_import_service import S3AccountImportService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_provisioning_service import S3AccountProvisioningService
from app.services.s3_account_query_service import S3AccountQueryService
from app.services.s3_account_quota_service import S3AccountQuotaService
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.s3_account_rgw_users_service import S3AccountRgwUsersService
from app.services.s3_account_update_service import S3AccountUpdateService
from app.services.tags_service import TagsService


class S3AccountsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)
        self.account_topics = RgwAccountTopicsResolver()
        self.account_roots = RgwAccountRootService()
        self.rgw_users = S3AccountRgwUsersService(self.account_roots)
        self.associations = S3AccountAssociationsService(db)
        self.metrics = S3AccountMetricsService()
        self.rgw_context = S3AccountRgwContextService(db)
        self.quota = S3AccountQuotaService(self.rgw_context)
        self.repository = S3AccountRepository(db)
        self.query = S3AccountQueryService(
            db,
            repository=self.repository,
            rgw_context=self.rgw_context,
            metrics=self.metrics,
            associations=self.associations,
            rgw_users=self.rgw_users,
            account_topics=self.account_topics,
            tags=self.tags,
        )
        self.importer = S3AccountImportService(
            db,
            repository=self.repository,
            rgw_context=self.rgw_context,
            account_roots=self.account_roots,
        )
        self.provisioning = S3AccountProvisioningService(
            db,
            repository=self.repository,
            rgw_context=self.rgw_context,
            account_roots=self.account_roots,
            quota=self.quota,
            metrics=self.metrics,
            tags=self.tags,
        )
        self.updater = S3AccountUpdateService(
            db,
            repository=self.repository,
            rgw_context=self.rgw_context,
            quota=self.quota,
            metrics=self.metrics,
            associations=self.associations,
            tags=self.tags,
        )
        self.deletion = S3AccountDeletionService(
            db,
            metrics=self.metrics,
            rgw_users=self.rgw_users,
            account_topics=self.account_topics,
            account_roots=self.account_roots,
        )

    def get_account_record(self, account_id: int) -> S3Account:
        return self.repository.get(account_id)

    def find_account_by_rgw_id(self, rgw_account_id: str) -> Optional[S3Account]:
        return self.repository.find_by_rgw_id(rgw_account_id)

    def get_account_usage(self, account: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        return self.metrics.get_usage(account)

    def get_account_quota(
        self,
        account: S3Account,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        return self.metrics.get_quota(account, admin)

    def get_account_limits(
        self,
        account: S3Account,
    ) -> tuple[Optional[float], Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
        return self.metrics.get_limits(account)

    def list_accounts(
        self,
        include_usage_stats: bool = True,
        include_quota: bool = True,
        include_rgw_details: bool = True,
    ) -> list[S3AccountSchema]:
        return self.query.list_accounts(
            include_usage_stats=include_usage_stats,
            include_quota=include_quota,
            include_rgw_details=include_rgw_details,
        )

    def list_accounts_page(
        self,
        *,
        page: int,
        page_size: int,
        search: Optional[str],
        sort_by: str,
        sort_dir: str,
        include_quota: bool,
        include_rgw_details: bool,
        search_exact: bool = False,
    ) -> PaginatedS3AccountsResponse:
        return self.query.list_accounts_page(
            page=page,
            page_size=page_size,
            search=search,
            sort_by=sort_by,
            sort_dir=sort_dir,
            include_quota=include_quota,
            include_rgw_details=include_rgw_details,
            search_exact=search_exact,
        )

    def get_account_detail(self, account_id: int, include_usage: bool = False) -> S3AccountSchema:
        return self.query.get_account_detail(account_id, include_usage=include_usage)

    def import_accounts(self, imports: list[S3AccountImport]) -> list[S3AccountSchema]:
        return self.importer.import_accounts(imports)

    def ensure_provisioned_account(self, payload: S3AccountCreate, rgw_account_id: str) -> S3AccountSchema:
        account = self.provisioning.ensure_provisioned_account(payload, rgw_account_id)
        return self.get_account_detail(account.id, include_usage=False)

    def create_account_with_manager(self, payload: S3AccountCreate) -> S3AccountSchema:
        provisioned = self.provisioning.create_account_with_manager(payload)
        account = provisioned.account
        endpoint = provisioned.endpoint
        return s3_account_from_db(
            account,
            quota_max_size_gb=provisioned.quota_max_size_gb,
            quota_max_objects=provisioned.quota_max_objects,
            user_links=[],
            group_links=[],
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=self.rgw_context.endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )

    def update_account(self, account_id: int, payload: S3AccountUpdate) -> S3AccountSchema:
        return self.updater.update_account(account_id, payload)

    def delete_account(self, account_id: int, delete_rgw: bool = False) -> None:
        account = self.get_account_record(account_id)
        admin = None
        endpoint = None
        if delete_rgw:
            admin = self.rgw_context.admin_for_account(account, allow_missing=False)
            endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
        self.deletion.delete_account(
            account,
            delete_rgw=delete_rgw,
            admin=admin,
            endpoint=endpoint,
        )


def get_s3_accounts_service(db: Session) -> S3AccountsService:
    return S3AccountsService(db)
