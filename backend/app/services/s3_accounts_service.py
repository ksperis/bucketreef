# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.services.feature_policy_service import (
    apply_resource_feature_overrides,
    validate_manager_overrides,
    validate_project_collection_overrides,
    validate_project_overrides,
)
from app.services.app_settings_service import load_app_settings_for_db_readonly
from dataclasses import dataclass
import logging
from typing import Any, Iterator, Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.domain_errors import S3AccountNotFoundError, StorageEndpointNotFoundError
from app.core.sensitive_data import sanitized_error_log_detail
from app.db import (
    AccountIAMUser,
    S3Account,
    StorageEndpoint,
    StorageProvider,
    UiGroupS3Account,
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
from app.models.iam import IAMGroup, IAMRole, IAMUser
from app.services.app_settings_service import load_app_settings_for_db
from app.services.managed_resource_naming import (
    PORTAL_MANAGED_IAM_GROUP_NAMES,
)
from app.services.mappers.s3_account import s3_account_from_db, s3_account_summary_from_db
from app.services.portal_role_sync import (
    PortalRoleMap,
    capture_effective_portal_roles,
    sync_portal_role_downgrades,
    sync_portal_role_promotions,
)
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_account_topics_resolver import (
    RgwAccountTopicsResolver,
    normalize_account_key,
)
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client, get_endpoint_runtime_rgw_client
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.services.s3_account_associations_service import S3AccountAssociationsService
from app.services.tags_service import TagsService
from app.utils.s3_endpoint import resolve_iam_client_options
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    resolve_admin_endpoint,
    resolve_feature_flags,
)
from app.utils.rgw_identifiers import generate_rgw_account_id
from app.utils.rgw_payloads import (
    extract_bucket_list,
    extract_rgw_account_ids,
    extract_rgw_account_tenant,
)
from app.utils.usage_stats import aggregate_bucket_usage
from app.utils.quota_stats import bytes_to_gb, extract_positive_limit, extract_quota_limits
from app.utils.size_units import size_to_bytes
from app.utils.name_ordering import name_order_by


logger = logging.getLogger(__name__)


def _account_search_values(account: S3AccountSchema) -> Iterator[Optional[str]]:
    yield account.name
    yield account.rgw_account_id
    yield from (tag.label for tag in account.tags or [])
    for link in account.user_links or []:
        yield link.user_email
        yield link.user_full_name
    yield from (link.group_name for link in account.group_links or [])


def _account_matches_search(account: S3AccountSchema, search_value: str) -> bool:
    return any(
        search_value in (candidate or "").lower()
        for candidate in _account_search_values(account)
    )


@dataclass(frozen=True)
class _PreparedAccountImport:
    source: S3AccountImport
    endpoint: StorageEndpoint
    admin: RGWAdminClient
    account_name: str
    root_uid: str
    root_display_name: str
    rgw_tenant: str


@dataclass(frozen=True)
class _AccountIAMDeletionInventory:
    users: list[IAMUser]
    groups: list[IAMGroup]
    roles: list[IAMRole]
    group_members: dict[str, list[IAMUser]]


class S3AccountsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)
        self.account_topics = RgwAccountTopicsResolver()
        self.account_roots = RgwAccountRootService()
        self.associations = S3AccountAssociationsService(db)

    def _get_account(self, account_id: int) -> S3Account:
        account = self.db.execute(
            select(S3Account).where(S3Account.id == account_id)
        ).scalar_one_or_none()
        if not account:
            raise S3AccountNotFoundError("S3Account not found")
        return account

    def get_account_record(self, account_id: int) -> S3Account:
        return self._get_account(account_id)

    def find_account_by_rgw_id(self, rgw_account_id: str) -> Optional[S3Account]:
        return self.db.execute(
            select(S3Account).where(S3Account.rgw_account_id == rgw_account_id)
        ).scalar_one_or_none()

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
        if self.db.execute(query.limit(1)).scalar_one_or_none() is not None:
            raise ValueError(error_message)

    def _endpoint_capabilities(self, endpoint: StorageEndpoint) -> dict[str, bool]:
        features = normalize_features_config(endpoint.provider, endpoint.features_config)
        return features_to_capabilities(features)

    def _resolve_storage_endpoint(self, storage_endpoint_id: int, require_ceph: bool = False) -> StorageEndpoint:
        endpoint = self.db.execute(
            select(StorageEndpoint).where(StorageEndpoint.id == storage_endpoint_id)
        ).scalar_one_or_none()
        if not endpoint:
            raise StorageEndpointNotFoundError("Storage endpoint not found.")
        if require_ceph and endpoint.provider != StorageProvider.CEPH.value:
            raise ValueError("This endpoint is not a Ceph endpoint.")
        return endpoint

    def _admin_for_endpoint(self, endpoint: StorageEndpoint, allow_missing: bool = False) -> Optional[RGWAdminClient]:
        if endpoint.provider != StorageProvider.CEPH.value:
            if allow_missing:
                return None
            raise ValueError("This endpoint does not support Ceph admin operations.")
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            if allow_missing:
                return None
            raise ValueError("Admin operations are disabled for this endpoint.")
        try:
            return get_endpoint_admin_rgw_client(endpoint)
        except Exception as exc:
            if allow_missing:
                logger.warning("Unable to build RGW admin client for endpoint %s: %s", endpoint.name, exc)
                return None
            raise

    def _admin_for_account(self, account: S3Account, allow_missing: bool = False) -> Optional[RGWAdminClient]:
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        return self._admin_for_endpoint(endpoint, allow_missing=allow_missing)

    def _runtime_for_account(self, account, allow_missing=False):
        try:
            return get_endpoint_runtime_rgw_client(account.storage_endpoint)
        except (ValueError, RGWAdminError):
            if allow_missing:
                return None
            raise

    def _apply_account_quota(
        self,
        account: S3Account,
        max_size_gb: Optional[float],
        max_objects: Optional[int],
        max_size_unit: Optional[str] = None,
    ) -> None:
        from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions
        require_endpoint_permissions(account.storage_endpoint, "accounts_write")
        admin = self._admin_for_account(account)
        try:
            max_size_bytes = size_to_bytes(max_size_gb, max_size_unit)
        except ValueError as exc:
            raise ValueError(sanitized_error_log_detail(exc)) from exc
        enabled = max_size_bytes is not None or max_objects is not None
        try:
            response = admin.set_account_quota(
                account_id=account.rgw_account_id,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                enabled=enabled,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW account quota update failed: {exc}") from exc
        if response.get("not_found"):
            raise ValueError(f"RGW account not found for quota update: {account.rgw_account_id}")
        if response.get("not_implemented"):
            raise ValueError("RGW account quota update is not supported on this cluster.")

    def get_account_usage(self, account: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        admin = self._runtime_for_account(account, allow_missing=True)
        if not admin:
            return None, None, None
        try:
            uid = account.rgw_user_uid
            if not uid:
                return None, None, None
            payload = admin.get_all_buckets(uid=uid, with_stats=True, **({"tenant": account.rgw_tenant} if account.rgw_tenant else {}))
        except RGWAdminError as exc:
            logger.warning("Unable to list buckets for account %s: %s", account.rgw_account_id, exc)
            return None, None, None
        used_bytes, used_objects, bucket_count = aggregate_bucket_usage(
            extract_bucket_list(payload)
        )
        return used_bytes, used_objects, bucket_count

    def get_account_quota(
        self,
        account: S3Account,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        rgw_admin = admin or self._runtime_for_account(account, allow_missing=True)
        if not rgw_admin:
            return None, None
        try:
            max_size_bytes, max_objects = rgw_admin.get_account_quota(account.rgw_account_id)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch account quota for %s: %s", account.rgw_account_id, exc)
            return None, None
        return bytes_to_gb(max_size_bytes), max_objects

    def get_account_limits(
        self,
        account: S3Account,
    ) -> tuple[Optional[float], Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
        rgw_admin = self._runtime_for_account(account, allow_missing=True)
        if not rgw_admin:
            return None, None, None, None, None, None
        try:
            payload = rgw_admin.get_account(
                account.rgw_account_id,
                allow_not_found=True,
                allow_not_implemented=True,
            ) or {}
        except RGWAdminError as exc:
            logger.warning("Unable to fetch account limits for %s: %s", account.rgw_account_id, exc)
            return None, None, None, None, None, None
        max_size_bytes, max_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
        return (
            bytes_to_gb(max_size_bytes),
            max_objects,
            extract_positive_limit(payload, "max_buckets"),
            extract_positive_limit(payload, "max_users"),
            extract_positive_limit(payload, "max_roles"),
            extract_positive_limit(payload, "max_groups"),
        )

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

    def _account_rgw_users(
        self,
        account_identifier: Optional[str],
        precomputed_users: Optional[dict[str, list[str]]],
        admin: Optional[RGWAdminClient],
        endpoint_capabilities: Optional[dict[str, bool]] = None,
        root_uid: Optional[str] = None,
    ) -> tuple[Optional[int], Optional[list[str]]]:
        normalized_key = normalize_account_key(account_identifier)
        if not normalized_key:
            return None, None
        if precomputed_users is not None:
            users = list(precomputed_users.get(normalized_key, []))
            return len(users), users
        if not admin:
            return None, None
        if endpoint_capabilities is not None and not endpoint_capabilities.get("account", False):
            return None, None
        try:
            account_info = admin.get_account(
                account_identifier,
                allow_not_found=True,
                allow_not_implemented=True,
            )
        except RGWAdminError as exc:
            logger.debug("Unable to fetch account info for %s: %s", account_identifier, exc)
            return None, None
        if admin.account_api_supported is False:
            return None, None
        if not account_info:
            return 0, []
        info, user_list = self._embedded_account_user_list(account_info)
        if not isinstance(user_list, list):
            # Standard Ceph AccountInfo does not embed the account's users.
            # Do not scan the endpoint-wide user inventory here: account
            # listings call this method once per account and a large default
            # tenant would otherwise turn one request into thousands of Admin
            # Ops lookups. Import keeps its deliberate one-shot discovery path,
            # while deletion proves that no non-root users remain through IAM.
            return None, None
        root_uid = root_uid or self.account_roots.root_uid(account_identifier)
        deduped = self._clean_account_user_uids(
            user_list,
            root_uid=root_uid,
            account_tenant=str(info.get("tenant") or ""),
        )
        return len(deduped), deduped

    @staticmethod
    def _embedded_account_user_list(account_info: dict[str, Any]) -> tuple[dict[str, Any], Any]:
        info = account_info.get("account")
        if not isinstance(info, dict):
            info = account_info
        return info, info.get("user_list", info.get("users"))

    @staticmethod
    def _clean_account_user_uids(
        user_list: list[Any],
        *,
        root_uid: str,
        account_tenant: str,
    ) -> list[str]:
        cleaned: list[str] = []
        for entry in user_list:
            uid = str(entry.get("uid", entry.get("user_id", ""))) if isinstance(entry, dict) else str(entry or "")
            if not uid:
                continue
            if uid == root_uid or uid == f"{account_tenant}${root_uid}":
                continue
            cleaned.append(uid)
        return sorted(set(cleaned))

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
        account_ids = [account.id for account in db_accounts]
        user_links_by_account = self.associations.load_user_links(account_ids)
        group_links_by_account = self.associations.load_group_links(account_ids)

        results: list[S3AccountSchema] = []
        for acc in db_accounts:
            endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
            endpoint_capabilities = self._endpoint_capabilities(endpoint)
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
                admin = self._admin_for_account(acc, allow_missing=True)
            if include_quota and admin:
                quota_max_size_gb, quota_max_objects = self.get_account_quota(acc, admin)
            if include_rgw_details and admin:
                rgw_user_count, rgw_user_uids = self._account_rgw_users(
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
    ) -> PaginatedS3AccountsResponse:
        accounts = self.list_accounts(
            include_usage_stats=False,
            include_quota=include_quota,
            include_rgw_details=include_rgw_details,
        )
        search_value = search.strip().lower() if isinstance(search, str) else ""
        if search_value:
            accounts = [
                account
                for account in accounts
                if _account_matches_search(account, search_value)
            ]

        descending = sort_dir.lower() == "desc"
        if sort_by == "rgw_account_id":
            accounts.sort(
                key=lambda account: (account.rgw_account_id.lower(), account.id),
                reverse=descending,
            )
        else:
            accounts.sort(
                key=lambda account: (account.name.lower(), account.name, account.id),
                reverse=descending,
            )

        total = len(accounts)
        start = (page - 1) * page_size
        end = start + page_size
        return PaginatedS3AccountsResponse(
            items=accounts[start:end],
            total=total,
            page=page,
            page_size=page_size,
            has_next=end < total,
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
            endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
            summaries.append(
                s3_account_summary_from_db(
                    acc,
                    user_links=user_links_by_account.get(acc.id, []),
                    group_links=group_links_by_account.get(acc.id, []),
                    storage_endpoint=endpoint,
                    storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
                    tags=self.tags.get_account_tags(acc),
                )
            )
        return summaries

    def get_account_detail(self, account_id: int, include_usage: bool = False) -> S3AccountSchema:
        account = self._get_account(account_id)
        user_links = self.associations.load_user_links([account.id]).get(account.id, [])
        group_links = self.associations.load_group_links([account.id]).get(
            account.id,
            [],
        )
        used_bytes = used_objects = bucket_count = None
        if include_usage:
            used_bytes, used_objects, bucket_count = self.get_account_usage(account)
        account_identifier = account.rgw_account_id
        admin = self._admin_for_account(account, allow_missing=True)
        rgw_user_count = rgw_user_uids = rgw_topic_count = rgw_topics = None
        quota_max_size_gb, quota_max_objects = self.get_account_quota(account, admin)
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        endpoint_capabilities = self._endpoint_capabilities(endpoint)
        if admin:
            rgw_user_count, rgw_user_uids = self._account_rgw_users(
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
        endpoint = self._resolve_storage_endpoint(item.storage_endpoint_id, require_ceph=True)
        admin = self._admin_for_endpoint(endpoint, allow_missing=False)
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
                storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
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
        endpoint = self._resolve_storage_endpoint(payload.storage_endpoint_id, require_ceph=True)
        if not self._endpoint_capabilities(endpoint).get("account", False):
            raise ValueError("Selected endpoint does not support RGW account API (/admin/account).")
        admin = self._admin_for_endpoint(endpoint, allow_missing=False)
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
        existing = self.db.execute(
            select(S3Account).where(S3Account.rgw_account_id == rgw_account_id)
        ).scalar_one_or_none()
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
            storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )

    def _apply_account_update_fields(self, account: S3Account, payload: S3AccountUpdate) -> None:
        app_settings = load_app_settings_for_db_readonly(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies, account)
        validate_project_overrides(payload, app_settings.general.project_feature_policies, account)
        validate_project_collection_overrides(payload, app_settings.general.project_collection_policies, account)
        target_endpoint_id = account.storage_endpoint_id
        if payload.storage_endpoint_id is not None:
            endpoint = self._resolve_storage_endpoint(payload.storage_endpoint_id, require_ceph=True)
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
                endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
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
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        quota_max_size_gb, quota_max_objects = self.get_account_quota(account)

        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            user_links=user_links,
            group_links=group_links,
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )

    def update_account(self, account_id: int, payload: S3AccountUpdate) -> S3AccountSchema:
        account = self._get_account(account_id)
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
        account = self._get_account(account_id)
        ResourceDeletionPurgeService(self.db).validate_execution_context_cleanup(str(account.id))
        if delete_rgw:
            admin = self._admin_for_account(account, allow_missing=False)
            account_identifier = account.rgw_account_id
            endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
            endpoint_capabilities = self._endpoint_capabilities(endpoint)

            # Safety: only allow RGW deletion when we can prove the account is empty.
            _, _, bucket_count = self.get_account_usage(account)
            if bucket_count is None:
                raise ValueError("Unable to verify bucket existence; cannot delete the RGW account.")
            rgw_user_count, _ = self._account_rgw_users(
                account_identifier,
                None,
                admin,
                endpoint_capabilities=endpoint_capabilities,
                root_uid=account.rgw_user_uid,
            )
            iam_can_verify_users = resolve_feature_flags(endpoint).iam_enabled
            if rgw_user_count is None and not iam_can_verify_users:
                raise ValueError("Unable to verify RGW users; cannot delete the RGW account.")
            rgw_topic_count, _ = self.account_topics.resolve(
                account_identifier,
                admin,
                account.storage_endpoint_id,
            )
            if rgw_topic_count is None:
                raise ValueError("Unable to verify RGW notification topics; cannot delete the RGW account.")
            if bucket_count > 0 or (rgw_user_count or 0) > 0 or rgw_topic_count > 0:
                raise ValueError(
                    "RGW account still has attached resources "
                    f"(buckets={bucket_count}, users={rgw_user_count or 0}, topics={rgw_topic_count}); "
                    "remove them first."
                )

            # On standard Ceph releases AccountInfo omits user_list. IAM
            # ListUsers is scoped by the account root credentials and provides
            # the missing non-root user proof without enumerating every RGW
            # user on the endpoint.
            self._prepare_account_iam_for_deletion(account, endpoint)
            self._delete_root_user(account)
            try:
                admin.delete_account(account_identifier)
            except RGWAdminError as exc:
                raise ValueError(f"Unable to delete RGW account {account_identifier}: {exc}") from exc
        self._remove_account_entry(account)

    def _iam_for_account(self, account: S3Account) -> RGWIAMService:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise ValueError("Unable to verify RGW IAM resources; account root credentials are missing.")
        endpoint, region, verify_tls = resolve_iam_client_options(account)
        try:
            return get_iam_service(
                access_key,
                secret_key,
                endpoint=endpoint,
                region=region,
                verify_tls=verify_tls,
            )
        except Exception as exc:
            raise ValueError(
                f"Unable to initialize RGW IAM cleanup: {sanitized_error_log_detail(exc)}"
            ) from exc

    def _prepare_account_iam_for_deletion(
        self,
        account: S3Account,
        endpoint: StorageEndpoint,
    ) -> None:
        if not resolve_feature_flags(endpoint).iam_enabled:
            return

        iam = self._iam_for_account(account)
        inventory = self._load_account_iam_deletion_inventory(iam)
        self._require_account_iam_deletion_ready(inventory)
        self._remove_portal_iam_groups(iam, inventory.groups)

    @staticmethod
    def _load_account_iam_deletion_inventory(
        iam: RGWIAMService,
    ) -> _AccountIAMDeletionInventory:
        try:
            users = iam.list_users()
            groups = iam.list_groups()
            roles = iam.list_roles()
            group_members = {
                group.name: iam.list_group_users(group.name)
                for group in groups
            }
        except RuntimeError as exc:
            raise ValueError(
                f"Unable to verify RGW IAM resources; cannot delete the RGW tenant: {sanitized_error_log_detail(exc)}"
            ) from exc
        return _AccountIAMDeletionInventory(
            users=users,
            groups=groups,
            roles=roles,
            group_members=group_members,
        )

    @staticmethod
    def _require_account_iam_deletion_ready(
        inventory: _AccountIAMDeletionInventory,
    ) -> None:
        unexpected_groups = sorted(
            group.name
            for group in inventory.groups
            if group.name not in PORTAL_MANAGED_IAM_GROUP_NAMES
        )
        groups_with_members = sorted(
            group_name
            for group_name, members in inventory.group_members.items()
            if members
        )
        if inventory.users or inventory.roles or unexpected_groups or groups_with_members:
            raise ValueError(
                "RGW tenant still has attached IAM resources "
                f"(users={len(inventory.users)}, roles={len(inventory.roles)}, "
                f"groups={len(unexpected_groups)}, groups_with_members={len(groups_with_members)}); "
                "remove them first."
            )

    @staticmethod
    def _remove_portal_iam_groups(
        iam: RGWIAMService,
        groups: list[IAMGroup],
    ) -> None:
        try:
            for group in groups:
                for policy_arn in group.policies or []:
                    iam.detach_group_policy(group.name, policy_arn)
                for policy_name in iam.list_group_inline_policies(group.name):
                    iam.delete_group_inline_policy(group.name, policy_name)
                iam.delete_group(group.name)
        except RuntimeError as exc:
            raise ValueError(
                f"Unable to remove Portal IAM groups; cannot delete the RGW tenant: {sanitized_error_log_detail(exc)}"
            ) from exc

    def _delete_root_user(self, account: S3Account) -> None:
        admin = self._admin_for_account(account, allow_missing=False)
        self.account_roots.delete_root_user(
            admin,
            root_uid=account.rgw_user_uid,
            account_id=account.rgw_account_id,
            tenant=account.rgw_tenant,
            local_account_id=account.id,
        )

    def _remove_account_entry(self, account: S3Account) -> None:
        self.db.execute(
            delete(AccountIAMUser).where(AccountIAMUser.account_id == account.id)
        )
        self.db.execute(
            delete(UserS3Account).where(UserS3Account.account_id == account.id)
        )
        self.db.execute(
            delete(UiGroupS3Account)
            .where(UiGroupS3Account.account_id == account.id)
            .execution_options(synchronize_session=False)
        )
        purge = ResourceDeletionPurgeService(self.db)
        purge.purge_account_derived_data(account.id)
        purge.purge_execution_context_data(str(account.id))
        self.db.delete(account)
        self.db.flush()
        self.tags.cleanup_orphan_definitions(
            domain_kinds=[TAG_DOMAIN_ADMIN_MANAGED]
        )
        self.db.commit()


def get_s3_accounts_service(db: Session) -> S3AccountsService:
    return S3AccountsService(db)
