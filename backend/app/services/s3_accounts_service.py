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
from dataclasses import dataclass
import logging
from typing import Any, Optional

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.core.domain_errors import S3AccountNotFoundError
from app.db import (
    S3Account,
    S3AccountTag,
    StorageEndpoint,
    StorageProvider,
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
from app.services.app_settings_service import load_app_settings_for_db
from app.services.mappers.s3_account import s3_account_from_db, s3_account_summary_from_db
from app.services.portal_role_sync import (
    PortalRoleMap,
    capture_effective_portal_roles,
    sync_portal_role_downgrades,
    sync_portal_role_promotions,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_account_topics_resolver import RgwAccountTopicsResolver
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.rgw_quota_update import (
    execute_rgw_quota_update,
    prepare_rgw_quota_update,
)
from app.services.s3_account_associations_service import S3AccountAssociationsService
from app.services.s3_account_deletion_service import S3AccountDeletionService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.s3_account_rgw_users_service import S3AccountRgwUsersService
from app.services.sqlalchemy_pagination import paginate_scalars
from app.services.tags_service import TagsService
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.rgw_identifiers import generate_rgw_account_id
from app.utils.rgw_payloads import extract_rgw_account_ids, extract_rgw_account_tenant
from app.utils.sql_search import text_search_predicate
from app.utils.name_ordering import name_order_by


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PreparedAccountImport:
    source: S3AccountImport
    endpoint: StorageEndpoint
    admin: RGWAdminClient
    account_name: str
    root_uid: str
    root_display_name: str
    rgw_tenant: str


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
        self.deletion = S3AccountDeletionService(
            db,
            metrics=self.metrics,
            rgw_users=self.rgw_users,
            account_topics=self.account_topics,
            account_roots=self.account_roots,
        )

    def get_account_record(self, account_id: int) -> S3Account:
        account = self.db.scalar(
            select(S3Account).where(S3Account.id == account_id)
        )
        if not account:
            raise S3AccountNotFoundError("S3Account not found")
        return account

    def find_account_by_rgw_id(self, rgw_account_id: str) -> Optional[S3Account]:
        return self.db.scalar(
            select(S3Account).where(S3Account.rgw_account_id == rgw_account_id)
        )

    def _ensure_account_name_available(
        self,
        *,
        storage_endpoint_id: int,
        rgw_tenant: str,
        name: str,
        exclude_account_id: Optional[int] = None,
        error_message: str = "S3Account already exists",
    ) -> None:
        query = select(S3Account.id).where(
            S3Account.storage_endpoint_id == storage_endpoint_id,
            S3Account.rgw_tenant == rgw_tenant,
            S3Account.name == name,
        )
        if exclude_account_id is not None:
            query = query.where(S3Account.id != exclude_account_id)
        if self.db.scalar(query.limit(1)) is not None:
            raise ValueError(error_message)

    def _apply_account_quota(
        self,
        account: S3Account,
        max_size_gb: Optional[float],
        max_objects: Optional[int],
        max_size_unit: Optional[str] = None,
    ) -> None:
        from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions
        require_endpoint_permissions(account.storage_endpoint, "accounts_write")
        admin = self.rgw_context.admin_for_account(account)
        quota = prepare_rgw_quota_update(max_size_gb, max_objects, max_size_unit)
        execute_rgw_quota_update(
            lambda: admin.set_account_quota(
                account_id=account.rgw_account_id,
                max_size_bytes=quota.max_size_bytes,
                max_objects=quota.max_objects,
                enabled=quota.enabled,
            ),
            subject="account",
            identifier=account.rgw_account_id,
        )

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

    @staticmethod
    def _ensure_account_creation_succeeded(result: Any, expected_id: str) -> None:
        if isinstance(result, dict) and result.get("conflict"):
            raise ValueError(
                "RGW account creation failed: another account already uses "
                "this name or email."
            )
        if not isinstance(result, dict):
            raise ValueError("RGW did not confirm the created account identity")
        account_payload = result.get("account")
        returned_ids = extract_rgw_account_ids(result, account_payload)
        if returned_ids != {expected_id}:
            raise ValueError("RGW did not confirm the requested account identity")

    def _generate_account_id(self) -> str:
        prefix = load_app_settings_for_db(self.db).general.rgw_account_id_prefix
        return generate_rgw_account_id(prefix)

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

    def _prepare_account_imports(self, imports: list[S3AccountImport]) -> list[_PreparedAccountImport]:
        app_settings = load_app_settings_for_db_readonly(self.db)
        requested_ids = {item.rgw_account_id for item in imports}
        existing_ids = {
            str(rgw_account_id)
            for rgw_account_id in self.db.scalars(
                select(S3Account.rgw_account_id).where(
                    S3Account.rgw_account_id.in_(requested_ids)
                )
            ).all()
        }
        seen_ids = set(existing_ids)
        prepared: list[_PreparedAccountImport] = []
        for item in imports:
            if item.rgw_account_id in seen_ids:
                continue
            seen_ids.add(item.rgw_account_id)
            prepared.append(
                self._prepare_account_import(
                    item,
                    allow_managed_rgw_tenant_creation=app_settings.general.allow_managed_rgw_tenant_creation,
                )
            )
        self._validate_prepared_account_names(prepared)
        return prepared

    def _prepare_account_import(
        self,
        item: S3AccountImport,
        *,
        allow_managed_rgw_tenant_creation: bool,
    ) -> _PreparedAccountImport:
        endpoint = self.rgw_context.resolve_storage_endpoint(item.storage_endpoint_id, require_ceph=True)
        admin = self.rgw_context.admin_for_endpoint(endpoint, allow_missing=False)
        if admin is None:
            raise ValueError("Admin operations are disabled for this endpoint.")
        rgw_info = admin.get_account(item.rgw_account_id, allow_not_found=True)
        if not rgw_info or rgw_info.get("not_found"):
            raise ValueError(f"S3Account {item.rgw_account_id} not found in RGW")
        account_info = rgw_info.get("account") if isinstance(rgw_info.get("account"), dict) else rgw_info
        account_name = str(account_info.get("name") or item.name or item.rgw_account_id)
        root_uid, rgw_tenant = self.account_roots.resolve_import_identity(
            admin,
            rgw_info,
            item.rgw_account_id,
            item.root_uid,
        )
        if item.rgw_tenant is not None and item.rgw_tenant != rgw_tenant:
            raise ValueError("Requested RGW tenant does not match the account tenant returned by RGW")
        if rgw_tenant and not allow_managed_rgw_tenant_creation:
            raise ValueError("Managed RGW tenant creation is disabled")
        return _PreparedAccountImport(
            source=item,
            endpoint=endpoint,
            admin=admin,
            account_name=account_name,
            root_uid=root_uid,
            root_display_name=self.account_roots.root_display_name(
                account_name,
                item.rgw_account_id,
            ),
            rgw_tenant=rgw_tenant,
        )

    def _validate_prepared_account_names(self, prepared: list[_PreparedAccountImport]) -> None:
        seen_scopes: set[tuple[int, str, str]] = set()
        for item in prepared:
            scope = (item.endpoint.id, item.rgw_tenant, item.account_name)
            if scope in seen_scopes:
                raise ValueError(f"S3Account name already exists: {item.account_name}")
            self._ensure_account_name_available(
                storage_endpoint_id=item.endpoint.id,
                rgw_tenant=item.rgw_tenant,
                name=item.account_name,
                error_message=f"S3Account name already exists: {item.account_name}",
            )
            seen_scopes.add(scope)

    def import_accounts(self, imports: list[S3AccountImport]) -> list[S3AccountSchema]:
        prepared = self._prepare_account_imports(imports)
        resolved = [
            (
                item,
                *self.account_roots.obtain_import_credentials(
                    item.admin,
                    account_id=item.source.rgw_account_id,
                    root_uid=item.root_uid,
                    root_display_name=item.root_display_name,
                    tenant=item.rgw_tenant,
                ),
            )
            for item in prepared
        ]
        accounts: list[tuple[S3Account, StorageEndpoint]] = []
        for item, access_key, secret_key in resolved:
            account = S3Account(
                name=item.account_name,
                rgw_account_id=item.source.rgw_account_id,
                rgw_tenant=item.rgw_tenant,
                rgw_access_key=access_key,
                rgw_secret_key=secret_key,
                rgw_user_uid=item.root_uid,
                email=item.source.email,
                storage_endpoint_id=item.endpoint.id,
            )
            self.db.add(account)
            accounts.append((account, item.endpoint))
        self.db.flush()
        created = [
            s3_account_from_db(
                account,
                quota_max_size_gb=None,
                quota_max_objects=None,
                user_links=[],
                group_links=[],
                storage_endpoint=endpoint,
                storage_endpoint_capabilities=self.rgw_context.endpoint_capabilities(endpoint),
                tags=[],
            )
            for account, endpoint in accounts
        ]
        self.db.commit()
        return created

    def _persist_provisioned_account(
        self,
        payload: S3AccountCreate,
        endpoint: StorageEndpoint,
        *,
        rgw_account_id: str,
        root_uid: str,
        access_key: str,
        secret_key: str,
    ) -> S3Account:
        account = S3Account(
            name=payload.name,
            rgw_account_id=rgw_account_id,
            rgw_tenant=payload.rgw_tenant,
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
            rgw_user_uid=root_uid,
            email=payload.email,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(account)
        self.db.flush()
        self.tags.replace_account_tags(account, payload.tags)
        if payload.quota_max_size_gb is not None or payload.quota_max_objects is not None:
            self._apply_account_quota(
                account,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )
        return account

    def _validate_managed_account_creation_policy(self, payload: S3AccountCreate) -> None:
        app_settings = load_app_settings_for_db_readonly(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies)
        if payload.rgw_tenant and not app_settings.general.allow_managed_rgw_tenant_creation:
            raise ValueError("Managed RGW tenant creation is disabled")

    def _prepare_managed_account_creation(
        self,
        payload: S3AccountCreate,
    ) -> tuple[StorageEndpoint, RGWAdminClient]:
        self._ensure_account_name_available(
            storage_endpoint_id=payload.storage_endpoint_id,
            rgw_tenant=payload.rgw_tenant,
            name=payload.name,
        )
        endpoint = self.rgw_context.resolve_storage_endpoint(payload.storage_endpoint_id, require_ceph=True)
        if not self.rgw_context.endpoint_capabilities(endpoint).get("account", False):
            raise ValueError("Selected endpoint does not support RGW account API (/admin/account).")
        admin = self.rgw_context.admin_for_endpoint(endpoint, allow_missing=False)
        if admin is None:
            raise ValueError("RGW administrative credentials are required")
        from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions

        require_endpoint_permissions(endpoint, "users_write", "accounts_write", client=admin)
        return endpoint, admin

    def _create_remote_account(
        self,
        admin: RGWAdminClient,
        payload: S3AccountCreate,
        rgw_account_id: str,
    ) -> None:
        try:
            create_result = admin.create_account(
                account_id=rgw_account_id,
                account_name=payload.name,
                tenant=payload.rgw_tenant or None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW account creation failed: {exc}") from exc
        self._ensure_account_creation_succeeded(create_result, rgw_account_id)
        logger.debug("Created RGW account %s (%s)", rgw_account_id, payload.name)

    def ensure_provisioned_account(self, payload: S3AccountCreate, rgw_account_id: str) -> S3AccountSchema:
        """Resume a minimal account provisioning operation with a durable RGW ID.

        The orchestrator owns the ID and records it before any remote mutation.
        Account and root creation stay on the same RGW client/session. A retry
        reconciles whichever remote resources were already created.
        """
        self._validate_managed_account_creation_policy(payload)
        existing = self.db.scalar(
            select(S3Account).where(S3Account.rgw_account_id == rgw_account_id)
        )
        if existing:
            if (
                existing.storage_endpoint_id != payload.storage_endpoint_id
                or existing.name != payload.name
                or existing.rgw_tenant != payload.rgw_tenant
            ):
                raise ValueError("Provisioned account scope changed")
            return self.get_account_detail(existing.id, include_usage=False)
        endpoint, admin = self._prepare_managed_account_creation(payload)
        remote = admin.get_account(rgw_account_id, allow_not_found=True)
        resume = bool(remote and not remote.get("not_found"))
        if not remote or remote.get("not_found"):
            self._create_remote_account(admin, payload, rgw_account_id)
        else:
            nested_account = remote.get("account")
            remote_ids = extract_rgw_account_ids(remote, nested_account)
            remote_name = None
            for record in (nested_account, remote):
                if isinstance(record, dict) and record.get("name") is not None:
                    remote_name = record.get("name")
                    break
            if (
                remote_name != payload.name
                or remote_ids != {rgw_account_id}
                or extract_rgw_account_tenant(remote) != payload.rgw_tenant
            ):
                raise ValueError("Provisioned RGW account does not match the requested identity")
        root_uid, access_key, secret_key = self.account_roots.ensure_provisioned_credentials(
            admin,
            rgw_account_id=rgw_account_id,
            account_name=payload.name,
            resume=resume,
            tenant=payload.rgw_tenant,
        )
        account = self._persist_provisioned_account(
            payload,
            endpoint,
            rgw_account_id=rgw_account_id,
            root_uid=root_uid,
            access_key=access_key,
            secret_key=secret_key,
        )
        self.db.commit()
        self.db.refresh(account)
        return self.get_account_detail(account.id, include_usage=False)

    def create_account_with_manager(self, payload: S3AccountCreate) -> S3AccountSchema:
        self._validate_managed_account_creation_policy(payload)
        endpoint, admin = self._prepare_managed_account_creation(payload)
        rgw_account_id = self._generate_account_id()
        self._create_remote_account(admin, payload, rgw_account_id)

        root_uid, access_key, secret_key = self.account_roots.ensure_provisioned_credentials(
            admin,
            rgw_account_id=rgw_account_id,
            account_name=payload.name,
            resume=False,
            tenant=payload.rgw_tenant,
        )
        account = self._persist_provisioned_account(
            payload,
            endpoint,
            rgw_account_id=rgw_account_id,
            root_uid=root_uid,
            access_key=access_key,
            secret_key=secret_key,
        )
        quota_max_size_gb, quota_max_objects = self.get_account_quota(account, admin)

        self.db.commit()
        self.db.refresh(account)
        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            user_links=[],
            group_links=[],
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=self.rgw_context.endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )

    def _apply_account_update_fields(self, account: S3Account, payload: S3AccountUpdate) -> None:
        app_settings = load_app_settings_for_db_readonly(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies, account)
        validate_multisite_endpoint_switching_override(
            payload,
            app_settings.manager.feature_policies,
            account,
        )
        validate_project_overrides(payload, app_settings.general.project_feature_policies, account)
        validate_project_collection_overrides(payload, app_settings.general.project_collection_policies, account)
        target_endpoint_id = account.storage_endpoint_id
        if payload.storage_endpoint_id is not None:
            endpoint = self.rgw_context.resolve_storage_endpoint(payload.storage_endpoint_id, require_ceph=True)
            target_endpoint_id = endpoint.id
        target_name = payload.name if payload.name else account.name
        if target_name != account.name or target_endpoint_id != account.storage_endpoint_id:
            self._ensure_account_name_available(
                storage_endpoint_id=target_endpoint_id,
                rgw_tenant=account.rgw_tenant,
                name=target_name,
                exclude_account_id=account.id,
            )
        if payload.name:
            account.name = payload.name
        if payload.email is not None:
            account.email = payload.email
        if payload.storage_endpoint_id is not None:
            account.storage_endpoint_id = target_endpoint_id
        if payload.tags is not None:
            self.tags.replace_account_tags(account, payload.tags)
        apply_resource_feature_overrides(payload, account)

    def _apply_account_quota_update(self, account: S3Account, payload: S3AccountUpdate) -> None:
        if {"quota_max_size_gb", "quota_max_objects"} & payload.model_fields_set:
            quota_requested = payload.quota_max_size_gb is not None or payload.quota_max_objects is not None
            if quota_requested:
                self._apply_account_quota(
                    account,
                    payload.quota_max_size_gb,
                    payload.quota_max_objects,
                    payload.quota_max_size_unit,
                )
            else:
                endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
                if endpoint.provider == StorageProvider.CEPH.value and resolve_feature_flags(endpoint).admin_enabled:
                    self._apply_account_quota(
                        account,
                        payload.quota_max_size_gb,
                        payload.quota_max_objects,
                        payload.quota_max_size_unit,
                    )

    def _apply_account_associations(self, account: S3Account, payload: S3AccountUpdate) -> None:
        if payload.user_links is not None:
            self.associations.set_user_links(account, payload.user_links)
        if payload.group_links is not None:
            self.associations.set_group_links(account, payload.group_links)

    def _commit_account_update_with_portal_sync(
        self,
        account: S3Account,
        *,
        affected_portal_user_ids: set[int],
        portal_roles_before: PortalRoleMap,
    ) -> None:
        self.db.add(account)
        self.db.flush()
        portal_roles_after = capture_effective_portal_roles(
            self.db,
            user_ids=affected_portal_user_ids,
            account_ids=[account.id],
        )
        try:
            sync_portal_role_downgrades(
                self.db,
                before=portal_roles_before,
                after=portal_roles_after,
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        sync_portal_role_promotions(
            self.db,
            before=portal_roles_before,
            after=portal_roles_after,
        )
        self.db.refresh(account)

    def _updated_account_schema(self, account: S3Account) -> S3AccountSchema:
        user_links = self.associations.load_user_links([account.id]).get(
            account.id,
            [],
        )
        group_links = self.associations.load_group_links([account.id]).get(
            account.id,
            [],
        )
        endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
        quota_max_size_gb, quota_max_objects = self.get_account_quota(account)

        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            user_links=user_links,
            group_links=group_links,
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=self.rgw_context.endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )

    def update_account(self, account_id: int, payload: S3AccountUpdate) -> S3AccountSchema:
        account = self.get_account_record(account_id)
        affected_portal_user_ids = self.associations.affected_portal_user_ids(
            account,
            payload,
        )
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_portal_user_ids,
            account_ids=[account.id],
        )

        self._apply_account_update_fields(account, payload)
        self._apply_account_quota_update(account, payload)
        self._apply_account_associations(account, payload)
        self._commit_account_update_with_portal_sync(
            account,
            affected_portal_user_ids=affected_portal_user_ids,
            portal_roles_before=portal_roles_before,
        )
        return self._updated_account_schema(account)

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
