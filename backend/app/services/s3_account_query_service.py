# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.db import (
    S3Account,
    S3AccountTag,
    TagDefinition,
    UiGroup,
    UiGroupS3Account,
    User,
    UserS3Account,
)
from app.models.s3_account import (
    AccountGroupLink,
    AccountUserLink,
    PaginatedS3AccountsResponse,
    S3Account as S3AccountSchema,
    S3AccountListingRequest,
    S3AccountSortBy,
)
from app.models.admin_listing import AdminSortDir
from app.services.mappers.s3_account import s3_account_from_db
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.rgw_account_topics_resolver import RgwAccountTopicsResolver
from app.services.s3_account_associations_service import S3AccountAssociationsService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.s3_account_rgw_users_service import S3AccountRgwUsersService
from app.services.sqlalchemy_pagination import paginate_scalars
from app.services.tags_service import TagsService
from app.utils.name_ordering import name_order_by
from app.utils.sql_search import text_search_predicate


class S3AccountQueryService:
    """Read, search, and serialize S3 accounts."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3AccountRepository | None = None,
        rgw_context: S3AccountRgwContextService | None = None,
        metrics: S3AccountMetricsService | None = None,
        associations: S3AccountAssociationsService | None = None,
        rgw_users: S3AccountRgwUsersService | None = None,
        account_topics: RgwAccountTopicsResolver | None = None,
        tags: TagsService | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or S3AccountRepository(db)
        self.rgw_context = rgw_context or S3AccountRgwContextService(db)
        self.metrics = metrics or S3AccountMetricsService()
        self.associations = associations or S3AccountAssociationsService(db)
        self.rgw_users = rgw_users or S3AccountRgwUsersService(RgwAccountRootService())
        self.account_topics = account_topics or RgwAccountTopicsResolver()
        self.tags = tags or TagsService(db)

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
        return [
            self._serialize_account(
                account,
                include_usage_stats=include_usage_stats,
                include_quota=include_quota,
                include_rgw_details=include_rgw_details,
                user_links=user_links_by_account.get(account.id, []),
                group_links=group_links_by_account.get(account.id, []),
            )
            for account in db_accounts
        ]

    def _serialize_account(
        self,
        account: S3Account,
        *,
        include_usage_stats: bool,
        include_quota: bool,
        include_rgw_details: bool,
        user_links: list[AccountUserLink],
        group_links: list[AccountGroupLink],
    ) -> S3AccountSchema:
        endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
        endpoint_capabilities = self.rgw_context.endpoint_capabilities(endpoint)
        used_bytes = used_objects = bucket_count = None
        rgw_user_count = rgw_user_uids = rgw_topic_count = rgw_topics = None
        quota_max_size_gb = quota_max_objects = None
        if include_usage_stats:
            used_bytes, used_objects, bucket_count = self.metrics.get_usage(account)
        admin = None
        if include_quota or include_rgw_details:
            admin = self.rgw_context.admin_for_account(account, allow_missing=True)
        if include_quota and admin:
            quota_max_size_gb, quota_max_objects = self.metrics.get_quota(account, admin)
        if include_rgw_details and admin:
            rgw_user_count, rgw_user_uids = self.rgw_users.resolve(
                account.rgw_account_id,
                None,
                admin,
                endpoint_capabilities=endpoint_capabilities,
                root_uid=account.rgw_user_uid,
            )
            rgw_topic_count, rgw_topics = self.account_topics.resolve(
                account.rgw_account_id,
                admin,
                account.storage_endpoint_id,
            )
        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            used_bytes=used_bytes,
            used_objects=used_objects,
            rgw_user_count=rgw_user_count,
            rgw_user_uids=rgw_user_uids,
            rgw_topic_count=rgw_topic_count,
            rgw_topics=rgw_topics,
            bucket_count=bucket_count,
            user_links=user_links,
            group_links=group_links,
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=endpoint_capabilities,
            tags=self.tags.get_account_tags(account),
        )

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
    def _account_order_columns(
        sort_by: S3AccountSortBy,
        sort_dir: AdminSortDir,
    ) -> list[Any]:
        descending = sort_dir == "desc"
        if sort_by == "rgw_account_id":
            account_id_order = func.lower(S3Account.rgw_account_id)
            return [
                account_id_order.desc() if descending else account_id_order.asc(),
                S3Account.id.desc() if descending else S3Account.id.asc(),
            ]
        return list(name_order_by(S3Account, descending=descending))

    def list_accounts_page(
        self,
        request: S3AccountListingRequest,
    ) -> PaginatedS3AccountsResponse:
        search_value = request.search.strip() if isinstance(request.search, str) else ""
        query = self._apply_account_search(
            select(S3Account),
            search_value,
            exact=request.search_exact,
        )
        db_accounts, total, has_next = paginate_scalars(
            self.db,
            query,
            order_by=self._account_order_columns(request.sort_by, request.sort_dir),
            page=request.page,
            page_size=request.page_size,
        )
        accounts = self._serialize_accounts(
            db_accounts,
            include_usage_stats=False,
            include_quota=request.include_quota,
            include_rgw_details=request.include_rgw_details,
        )
        return PaginatedS3AccountsResponse(
            items=accounts,
            total=total,
            page=request.page,
            page_size=request.page_size,
            has_next=has_next,
        )

    def get_account_detail(self, account_id: int, include_usage: bool = False) -> S3AccountSchema:
        account = self.repository.get(account_id)
        user_links = self.associations.load_user_links([account.id]).get(account.id, [])
        group_links = self.associations.load_group_links([account.id]).get(account.id, [])
        used_bytes = used_objects = bucket_count = None
        if include_usage:
            used_bytes, used_objects, bucket_count = self.metrics.get_usage(account)
        admin = self.rgw_context.admin_for_account(account, allow_missing=True)
        rgw_user_count = rgw_user_uids = rgw_topic_count = rgw_topics = None
        quota_max_size_gb, quota_max_objects = self.metrics.get_quota(account, admin)
        endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
        endpoint_capabilities = self.rgw_context.endpoint_capabilities(endpoint)
        if admin:
            rgw_user_count, rgw_user_uids = self.rgw_users.resolve(
                account.rgw_account_id,
                None,
                admin,
                endpoint_capabilities=endpoint_capabilities,
                root_uid=account.rgw_user_uid,
            )
            rgw_topic_count, rgw_topics = self.account_topics.resolve(
                account.rgw_account_id,
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
