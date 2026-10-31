# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any, Optional

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.db import (
    S3Account,
    S3AccountTag,
    StorageEndpoint,
    TagDefinition,
    UiGroup,
    UiGroupS3Account,
    User,
    UserS3Account,
)
from app.models.s3_account import (
    PaginatedS3AccountsResponse,
    S3Account as S3AccountSchema,
    S3AccountCreate,
    S3AccountImport,
    S3AccountSummary,
    S3AccountUpdate,
)
from app.services.mappers.s3_account import s3_account_from_db, s3_account_summary_from_db
from app.services.rgw_admin import RGWAdminClient
from app.services.rgw_account_topics_resolver import RgwAccountTopicsResolver
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.s3_account_associations_service import S3AccountAssociationsService
from app.services.s3_account_deletion_service import S3AccountDeletionService
from app.services.s3_account_import_service import S3AccountImportService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_provisioning_service import S3AccountProvisioningService
from app.services.s3_account_quota_service import S3AccountQuotaService
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.s3_account_rgw_users_service import S3AccountRgwUsersService
from app.services.s3_account_update_service import S3AccountUpdateService
from app.services.sqlalchemy_pagination import paginate_scalars
from app.services.tags_service import TagsService
from app.utils.sql_search import text_search_predicate
from app.utils.name_ordering import name_order_by


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
        db_accounts = self.db.scalars(
            select(S3Account).order_by(*name_order_by(S3Account))
        ).all()
        return self._serialize_accounts(
            db_accounts,
            include_usage_stats=include_usage_stats,
            include_quota=include_quota,
            include_rgw_details=include_rgw_details,
        )

    def _serialize_accounts(
        self,
        db_accounts: list[S3Account],
        *,
        include_usage_stats: bool,
        include_quota: bool,
        include_rgw_details: bool,
    ) -> list[S3AccountSchema]:
        account_ids = [account.id for account in db_accounts]
        user_links_by_account = self.associations.load_user_links(account_ids)
        group_links_by_account = self.associations.load_group_links(account_ids)

        results: list[S3AccountSchema] = []
        for acc in db_accounts:
            endpoint = self.rgw_context.resolve_storage_endpoint(acc.storage_endpoint_id)
            endpoint_capabilities = self.rgw_context.endpoint_capabilities(endpoint)
            used_bytes = None
            used_objects = None
            bucket_count = None
            rgw_user_count = None
            rgw_user_uids = None
            rgw_topic_count = None
            rgw_topics = None
            quota_max_size_gb = None
            quota_max_objects = None
            if include_usage_stats:
                used_bytes, used_objects, bucket_count = self.get_account_usage(acc)
            account_identifier = acc.rgw_account_id
            admin = None
            if include_quota or include_rgw_details:
                admin = self.rgw_context.admin_for_account(acc, allow_missing=True)
            if include_quota and admin:
                quota_max_size_gb, quota_max_objects = self.get_account_quota(acc, admin)
            if include_rgw_details and admin:
                rgw_user_count, rgw_user_uids = self.rgw_users.resolve(
                    account_identifier,
                    None,
                    admin,
                    endpoint_capabilities=endpoint_capabilities,
                    root_uid=acc.rgw_user_uid,
                )
                rgw_topic_count, rgw_topics = self.account_topics.resolve(
                    account_identifier,
                    admin,
                    acc.storage_endpoint_id,
                )
            results.append(
                s3_account_from_db(
                    acc,
                    quota_max_size_gb=quota_max_size_gb,
                    quota_max_objects=quota_max_objects,
                    used_bytes=used_bytes,
                    used_objects=used_objects,
                    rgw_user_count=rgw_user_count,
                    rgw_user_uids=rgw_user_uids,
                    rgw_topic_count=rgw_topic_count,
                    rgw_topics=rgw_topics,
                    bucket_count=bucket_count,
                    user_links=user_links_by_account.get(acc.id, []),
                    group_links=group_links_by_account.get(acc.id, []),
                    storage_endpoint=endpoint,
                    storage_endpoint_capabilities=endpoint_capabilities,
                    tags=self.tags.get_account_tags(acc),
                )
            )
        return results

    @staticmethod
    def _apply_account_search(query, search_value: str, *, exact: bool):
        if not search_value:
            return query
        tag_match = (
            exists()
            .where(S3AccountTag.account_id == S3Account.id)
            .where(TagDefinition.id == S3AccountTag.tag_definition_id)
            .where(text_search_predicate(TagDefinition.label, search_value, exact=exact))
        )
        user_match = (
            exists()
            .where(UserS3Account.account_id == S3Account.id)
            .where(User.id == UserS3Account.user_id)
            .where(
                or_(
                    text_search_predicate(User.email, search_value, exact=exact),
                    text_search_predicate(User.full_name, search_value, exact=exact),
                )
            )
        )
        group_match = (
            exists()
            .where(UiGroupS3Account.account_id == S3Account.id)
            .where(UiGroup.id == UiGroupS3Account.group_id)
            .where(text_search_predicate(UiGroup.name, search_value, exact=exact))
        )
        return query.where(
            or_(
                text_search_predicate(S3Account.name, search_value, exact=exact),
                text_search_predicate(S3Account.rgw_account_id, search_value, exact=exact),
                tag_match,
                user_match,
                group_match,
            )
        )

    @staticmethod
    def _account_order_columns(sort_by: str, sort_dir: str) -> list[Any]:
        descending = sort_dir.lower() == "desc"
        if sort_by == "rgw_account_id":
            account_id_order = func.lower(S3Account.rgw_account_id)
            return [
                account_id_order.desc() if descending else account_id_order.asc(),
                S3Account.id.desc() if descending else S3Account.id.asc(),
            ]
        return list(name_order_by(S3Account, descending=descending))

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
        search_value = search.strip() if isinstance(search, str) else ""
        query = self._apply_account_search(select(S3Account), search_value, exact=search_exact)
        db_accounts, total = paginate_scalars(
            self.db,
            query,
            order_by=self._account_order_columns(sort_by, sort_dir),
            page=page,
            page_size=page_size,
        )
        accounts = self._serialize_accounts(
            db_accounts,
            include_usage_stats=False,
            include_quota=include_quota,
            include_rgw_details=include_rgw_details,
        )
        return PaginatedS3AccountsResponse(
            items=accounts,
            total=total,
            page=page,
            page_size=page_size,
            has_next=page * page_size < total,
        )

    def list_accounts_minimal(self) -> list[S3AccountSummary]:
        db_accounts = self.db.scalars(
            select(S3Account).order_by(*name_order_by(S3Account))
        ).all()
        account_ids = [account.id for account in db_accounts]
        user_links_by_account = self.associations.load_user_links(account_ids)
        group_links_by_account = self.associations.load_group_links(account_ids)
        summaries: list[S3AccountSummary] = []
        for acc in db_accounts:
            endpoint = self.rgw_context.resolve_storage_endpoint(acc.storage_endpoint_id)
            summaries.append(
                s3_account_summary_from_db(
                    acc,
                    user_links=user_links_by_account.get(acc.id, []),
                    group_links=group_links_by_account.get(acc.id, []),
                    storage_endpoint=endpoint,
                    storage_endpoint_capabilities=self.rgw_context.endpoint_capabilities(endpoint),
                    tags=self.tags.get_account_tags(acc),
                )
            )
        return summaries

    def get_account_detail(self, account_id: int, include_usage: bool = False) -> S3AccountSchema:
        account = self.get_account_record(account_id)
        user_links = self.associations.load_user_links([account.id]).get(account.id, [])
        group_links = self.associations.load_group_links([account.id]).get(
            account.id,
            [],
        )
        used_bytes = used_objects = bucket_count = None
        if include_usage:
            used_bytes, used_objects, bucket_count = self.get_account_usage(account)
        account_identifier = account.rgw_account_id
        admin = self.rgw_context.admin_for_account(account, allow_missing=True)
        rgw_user_count = rgw_user_uids = rgw_topic_count = rgw_topics = None
        quota_max_size_gb, quota_max_objects = self.get_account_quota(account, admin)
        endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
        endpoint_capabilities = self.rgw_context.endpoint_capabilities(endpoint)
        if admin:
            rgw_user_count, rgw_user_uids = self.rgw_users.resolve(
                account_identifier,
                None,
                admin,
                endpoint_capabilities=endpoint_capabilities,
                root_uid=account.rgw_user_uid,
            )
            rgw_topic_count, rgw_topics = self.account_topics.resolve(
                account_identifier,
                admin,
                account.storage_endpoint_id,
            )
        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            used_bytes=used_bytes,
            used_objects=used_objects,
            bucket_count=bucket_count,
            rgw_user_count=rgw_user_count,
            rgw_user_uids=rgw_user_uids,
            rgw_topic_count=rgw_topic_count,
            rgw_topics=rgw_topics,
            user_links=user_links,
            group_links=group_links,
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=endpoint_capabilities,
            tags=self.tags.get_account_tags(account),
        )

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
