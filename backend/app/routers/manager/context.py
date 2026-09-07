# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, S3User, User
from app.models.access_context import ManagerActor
from app.models.execution_context import ManagerContext
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies import (
    get_account_context,
    get_current_actor,
    is_manager_bucket_quota_available,
    is_manager_rgw_access_key_management_available,
)
from app.services.app_settings_service import load_app_settings
from app.services.connection_identity_service import ConnectionIdentityService
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_users_service import get_s3_users_service
from app.services.effective_access_service import EffectiveAccessService, ResolvedUserAccess
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.rgw_supervision import has_supervision_credentials
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.rgw_identifiers import resolve_admin_uid
from app.utils.storage_endpoint_features import resolve_feature_flags

router = APIRouter(prefix="/manager", tags=["manager-context"])


@dataclass(frozen=True)
class _ManagerBrowserState:
    enabled: bool
    message: Optional[str]


@dataclass(frozen=True)
class _ManagerLimits:
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    max_buckets: Optional[int] = None
    max_users: Optional[int] = None
    max_roles: Optional[int] = None
    max_groups: Optional[int] = None


def _manager_stats_state(
    account: S3ExecutionContext, actor: ManagerActor,
) -> tuple[bool, Optional[str], Optional[str]]:
    rgw_usage_metrics_enabled = bool(load_app_settings().manager.manager_rgw_usage_metrics_enabled)
    if account.context_kind == "connection":
        if not account.manager_capabilities.can_manage_buckets:
            return False, "Metrics are not available for this connection.", None
        if account.source_connection is None:
            return False, "Metrics are unavailable: connection context is incomplete.", None
        resolution = ConnectionIdentityService().resolve_metrics_identity(account.source_connection)
        if not resolution.eligible:
            return False, (resolution.reason or "Metrics are unavailable for this connection."), None
        if not rgw_usage_metrics_enabled:
            return False, "RGW traffic and usage metrics are disabled.", resolution.iam_identity
        if not has_supervision_credentials(account):
            return False, "Supervision credentials are not configured for this endpoint.", resolution.iam_identity
        if isinstance(actor, ManagerSessionPrincipal) and not actor.capabilities.can_view_traffic:
            return False, "Metrics are not available for this profile.", resolution.iam_identity
        return True, None, resolution.iam_identity

    if not rgw_usage_metrics_enabled:
        return False, "RGW traffic and usage metrics are disabled.", None
    if not has_supervision_credentials(account):
        return False, None, None
    if account.context_kind == "s3_user" and not account.rgw_user_uid:
        return False, None, None
    if not account.manager_capabilities.can_manage_buckets:
        return False, None, None
    if isinstance(actor, ManagerSessionPrincipal):
        return bool(actor.capabilities.can_view_traffic), None, None
    if isinstance(actor, User):
        return True, None, None
    return False, None, None


def _manager_access_mode(account: S3ExecutionContext) -> str:
    if account.context_kind == "account":
        return "admin"
    if account.context_kind in {"session", "connection", "s3_user"}:
        return account.context_kind
    raise RuntimeError("Unsupported Manager execution context")


def _manager_browser_state(
    account: S3ExecutionContext,
    actor: ManagerActor,
    db: Session,
    access_service: Optional[EffectiveAccessService],
    resolved_access: Optional[ResolvedUserAccess],
) -> _ManagerBrowserState:
    settings = load_app_settings()
    if not settings.general.browser_enabled:
        return _ManagerBrowserState(False, "Browser is disabled.")
    if not settings.general.manager_enabled:
        return _ManagerBrowserState(False, "Manager is disabled.")
    if not settings.general.browser_manager_enabled:
        return _ManagerBrowserState(False, "Manager Browser is disabled.")
    if isinstance(actor, ManagerSessionPrincipal):
        enabled = bool(actor.capabilities.access_browser)
        message = None if enabled else "Browser access is not allowed for this session."
        return _ManagerBrowserState(enabled, message)

    if resolved_access is None or access_service is None:
        raise RuntimeError("UI user effective access was not resolved")
    if account.context_kind == "connection":
        connection = db.query(S3Connection).filter(S3Connection.id == account.s3_connection_id).first()
        enabled = bool(
            connection
            and access_service.manager_browser_connection_is_allowed(
                actor,
                connection,
            )
        )
        message = None
        if not enabled:
            message = (
                "Manager Browser requires an owned private connection with both Manager and "
                "Browser access. Shared connections are not supported."
            )
        return _ManagerBrowserState(enabled, message)

    if account.context_kind == "s3_user":
        enabled = account.s3_user_id is not None and resolved_access.can_browse_s3_user(account.s3_user_id)
        message = None if enabled else "Manager Browser data access is not allowed for this RGW user."
        return _ManagerBrowserState(enabled, message)

    link = resolved_access.account_link_for(account.id) if account.id is not None else None
    enabled = bool(link and link.manager_browser_allowed)
    message = None
    if not enabled:
        message = (
            "Manager Browser requires account administrator and explicit data access on the "
            "same association."
        )
    return _ManagerBrowserState(enabled, message)


def _manager_iam_identity(
    account: S3ExecutionContext,
    actor: ManagerActor,
    access_mode: str,
    connection_iam_identity: Optional[str],
) -> Optional[str]:
    if access_mode == "admin":
        return resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
    if access_mode == "session" and isinstance(actor, ManagerSessionPrincipal):
        return actor.user_uid or actor.account_id or actor.account_name
    if access_mode == "s3_user":
        return account.rgw_user_uid
    if access_mode == "connection":
        return connection_iam_identity
    return None


def _manager_private_access_enabled(
    account: S3ExecutionContext,
    actor: ManagerActor,
    db: Session,
    resolved_access: Optional[ResolvedUserAccess],
) -> bool:
    if not isinstance(actor, User):
        return False
    if resolved_access is None:
        raise RuntimeError("UI user effective access was not resolved")
    managed_private_access = ManagedPrivateAccessService(db)
    if account.context_kind == "s3_user":
        return managed_private_access.rgw_user_provisioning_available(
            actor,
            account,
            resolved=resolved_access,
        )

    endpoint = account.storage_endpoint
    return bool(
        managed_private_access.managed_provisioning_allowed(
            actor,
            resolved=resolved_access,
        )
        and account.manager_capabilities.can_manage_iam
        and (endpoint is None or resolve_feature_flags(endpoint).iam_enabled)
    )


def _manager_limits(
    account: S3ExecutionContext,
    db: Session,
    *,
    include_limits: bool,
) -> _ManagerLimits:
    if not include_limits or account.context_kind == "connection":
        return _ManagerLimits()
    if account.context_kind == "s3_user":
        s3_user = db.query(S3User).filter(S3User.id == account.s3_user_id).first()
        if s3_user is None:
            return _ManagerLimits()
        quota_max_size_gb, quota_max_objects, max_buckets = get_s3_users_service(db).get_user_limits(s3_user)
        return _ManagerLimits(
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            max_buckets=max_buckets,
        )

    s3_account = db.query(S3Account).filter(S3Account.id == account.id).first() if account.id is not None else None
    if s3_account is None:
        return _ManagerLimits()
    (
        quota_max_size_gb,
        quota_max_objects,
        max_buckets,
        max_users,
        max_roles,
        max_groups,
    ) = get_s3_accounts_service(db).get_account_limits(s3_account)
    return _ManagerLimits(
        quota_max_size_gb=quota_max_size_gb,
        quota_max_objects=quota_max_objects,
        max_buckets=max_buckets,
        max_users=max_users,
        max_roles=max_roles,
        max_groups=max_groups,
    )


@router.get("/context", response_model=ManagerContext)
def get_manager_context(
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
    include_limits: Annotated[bool, Query()] = False,
) -> ManagerContext:
    access_mode = _manager_access_mode(account)
    manager_stats_enabled, manager_stats_message, connection_iam_identity = _manager_stats_state(account, actor)
    access_service = EffectiveAccessService(db) if isinstance(actor, User) else None
    resolved_access = access_service.resolve_user(actor) if access_service else None
    browser_state = _manager_browser_state(
        account,
        actor,
        db,
        access_service,
        resolved_access,
    )
    iam_identity = _manager_iam_identity(
        account,
        actor,
        access_mode,
        connection_iam_identity,
    )

    manager_ceph_keys_enabled = (
        is_manager_rgw_access_key_management_available(account, actor, db=db)
        if isinstance(actor, User)
        else False
    )
    manager_private_access_enabled = _manager_private_access_enabled(
        account,
        actor,
        db,
        resolved_access,
    )
    manager_bucket_quota_enabled = (
        is_manager_bucket_quota_available(account, actor, db=db)
        if isinstance(actor, User)
        else False
    )
    limits = _manager_limits(
        account,
        db,
        include_limits=include_limits,
    )

    return ManagerContext(
        access_mode=access_mode,
        context_kind=("connection" if access_mode == "connection" else "account"),
        iam_identity=iam_identity,
        manager_stats_enabled=manager_stats_enabled,
        manager_stats_message=manager_stats_message,
        manager_browser_enabled=browser_state.enabled,
        manager_browser_message=browser_state.message,
        manager_bucket_quota_enabled=manager_bucket_quota_enabled,
        manager_ceph_keys_enabled=manager_ceph_keys_enabled,
        manager_private_access_enabled=manager_private_access_enabled,
        quota_max_size_gb=limits.quota_max_size_gb,
        quota_max_objects=limits.quota_max_objects,
        max_buckets=limits.max_buckets,
        max_users=limits.max_users,
        max_roles=limits.max_roles,
        max_groups=limits.max_groups,
    )
