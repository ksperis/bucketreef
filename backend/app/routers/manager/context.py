# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.services.feature_policy_service import (
    bucket_usage_stats_state,
    manager_activity_resource,
    manager_resource_states,
    manager_rgw_usage_metrics_state,
    manager_usage_metrics_resource,
    project_usage_resource,
)
from app.services.app_settings_service import load_app_settings_for_db_readonly
from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.domain_errors import S3AccountNotFoundError, S3ConnectionNotFoundError, S3UserNotFoundError
from app.db import User
from app.models.access_context import ManagerActor
from app.models.app_settings import AppSettings
from app.models.execution_context import ManagerAccessMode, ManagerContext
from app.models.feature_policy import FeatureState
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies import (
    get_s3_execution_context,
    get_current_actor,
    is_manager_bucket_quota_available,
    is_manager_rgw_access_key_management_available,
)
from app.services.resource_name_validation import naming_validation_profile
from app.services.access_key_metadata_service import AccessKeyMetadataService
from app.services.connection_identity_service import ConnectionIdentityService
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_users_service import get_s3_users_service
from app.services.effective_access_service import EffectiveAccessService, ResolvedUserAccess
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.rgw_supervision import has_supervision_credentials
from app.services.s3_execution_context import S3ExecutionContext
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
    context: S3ExecutionContext,
    actor: ManagerActor,
    db: Session,
) -> tuple[bool, Optional[str], Optional[str]]:
    if context.context_kind == "openstack_project":
        return False, "RGW administrative metrics are unavailable for OpenStack contexts.", None
    settings = load_app_settings_for_db_readonly(db)
    rgw_usage_metrics_enabled = manager_rgw_usage_metrics_state(
        settings.manager.feature_policies,
        manager_usage_metrics_resource(db, context),
    ).enabled
    if context.context_kind == "connection":
        return _manager_connection_stats_state(context, actor, rgw_usage_metrics_enabled)
    return _manager_rgw_stats_state(context, actor, rgw_usage_metrics_enabled)


def _manager_connection_stats_state(
    context: S3ExecutionContext,
    actor: ManagerActor,
    rgw_usage_metrics_enabled: bool,
) -> tuple[bool, Optional[str], Optional[str]]:
    if not context.manager_capabilities.can_manage_buckets:
        return False, "Metrics are not available for this connection.", None
    if context.source_connection is None:
        return False, "Metrics are unavailable: connection context is incomplete.", None
    resolution = ConnectionIdentityService().resolve_metrics_identity(context.source_connection)
    if not resolution.eligible:
        return False, (resolution.reason or "Metrics are unavailable for this connection."), None
    if not rgw_usage_metrics_enabled:
        return False, "RGW traffic and usage metrics are disabled.", resolution.iam_identity
    if not has_supervision_credentials(context):
        return False, "Supervision credentials are not configured for this endpoint.", resolution.iam_identity
    if isinstance(actor, ManagerSessionPrincipal) and not actor.capabilities.can_view_traffic:
        return False, "Metrics are not available for this profile.", resolution.iam_identity
    return True, None, resolution.iam_identity


def _manager_rgw_stats_state(
    context: S3ExecutionContext,
    actor: ManagerActor,
    rgw_usage_metrics_enabled: bool,
) -> tuple[bool, Optional[str], Optional[str]]:
    if not rgw_usage_metrics_enabled:
        return False, "RGW traffic and usage metrics are disabled.", None
    if not has_supervision_credentials(context):
        return False, None, None
    if context.context_kind == "s3_user" and not context.rgw_user_uid:
        return False, None, None
    if not context.manager_capabilities.can_manage_buckets:
        return False, None, None
    if isinstance(actor, ManagerSessionPrincipal):
        return bool(actor.capabilities.can_view_traffic), None, None
    if isinstance(actor, User):
        return True, None, None
    return False, None, None


def _manager_access_mode(context: S3ExecutionContext) -> ManagerAccessMode:
    if context.context_kind == "account":
        return "admin"
    if context.context_kind in {"session", "connection", "s3_user", "openstack_project"}:
        return context.context_kind
    raise RuntimeError("Unsupported Manager execution context")


def _manager_browser_feature_state(settings: AppSettings) -> _ManagerBrowserState | None:
    if not settings.general.browser_enabled:
        return _ManagerBrowserState(False, "Browser is disabled.")
    if not settings.general.manager_enabled:
        return _ManagerBrowserState(False, "Manager is disabled.")
    if not settings.general.browser_manager_enabled:
        return _ManagerBrowserState(False, "Manager Browser is disabled.")
    return None


def _manager_connection_browser_state(
    context: S3ExecutionContext,
    actor: User,
    db: Session,
    access_service: EffectiveAccessService,
) -> _ManagerBrowserState:
    connection = context.source_connection
    if connection is None and context.s3_connection_id is not None:
        try:
            connection = S3ConnectionsService(db).get_record(context.s3_connection_id)
        except S3ConnectionNotFoundError:
            connection = None
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


def _manager_browser_state(
    context: S3ExecutionContext,
    actor: ManagerActor,
    db: Session,
    access_service: Optional[EffectiveAccessService],
    resolved_access: Optional[ResolvedUserAccess],
) -> _ManagerBrowserState:
    settings = load_app_settings_for_db_readonly(db)
    feature_state = _manager_browser_feature_state(settings)
    if feature_state is not None:
        return feature_state
    if isinstance(actor, ManagerSessionPrincipal):
        enabled = bool(actor.capabilities.access_browser)
        message = None if enabled else "Browser access is not allowed for this session."
        return _ManagerBrowserState(enabled, message)

    if resolved_access is None or access_service is None:
        raise RuntimeError("UI user effective access was not resolved")
    if context.context_kind == "openstack_project":
        return _ManagerBrowserState(True, None)
    if context.context_kind == "connection":
        return _manager_connection_browser_state(context, actor, db, access_service)

    if context.context_kind == "s3_user":
        enabled = context.s3_user_id is not None and resolved_access.can_browse_s3_user(context.s3_user_id)
        message = None if enabled else "Manager Browser data access is not allowed for this RGW user."
        return _ManagerBrowserState(enabled, message)

    link = resolved_access.account_link_for(context.id) if context.id is not None else None
    enabled = bool(link and link.manager_browser_allowed)
    message = None
    if not enabled:
        message = (
            "Manager Browser requires account administrator and explicit data access on the "
            "same association."
        )
    return _ManagerBrowserState(enabled, message)


def _manager_iam_identity(
    context: S3ExecutionContext,
    actor: ManagerActor,
    access_mode: ManagerAccessMode,
    connection_iam_identity: Optional[str],
) -> Optional[str]:
    if access_mode == "admin":
        return context.rgw_user_uid
    if access_mode == "session" and isinstance(actor, ManagerSessionPrincipal):
        return actor.user_uid or actor.account_id or actor.account_name
    if access_mode == "s3_user":
        return context.rgw_user_uid
    if access_mode == "connection":
        return connection_iam_identity
    return None


def _manager_private_access_enabled(
    context: S3ExecutionContext,
    actor: ManagerActor,
    db: Session,
    resolved_access: Optional[ResolvedUserAccess],
) -> bool:
    if context.context_kind == "openstack_project" or not isinstance(actor, User):
        return False
    if resolved_access is None:
        raise RuntimeError("UI user effective access was not resolved")
    managed_private_access = ManagedPrivateAccessService(db)
    if context.context_kind == "s3_user":
        return managed_private_access.rgw_user_provisioning_available(
            actor,
            context,
            resolved=resolved_access,
        )

    endpoint = context.storage_endpoint
    return bool(
        managed_private_access.managed_provisioning_allowed(
            actor,
            resolved=resolved_access,
        )
        and context.manager_capabilities.can_manage_iam
        and (endpoint is None or resolve_feature_flags(endpoint).iam_enabled)
    )


def _manager_limits(
    context: S3ExecutionContext,
    db: Session,
    *,
    include_limits: bool,
) -> _ManagerLimits:
    if not include_limits or context.context_kind == "connection":
        return _ManagerLimits()
    if context.context_kind == "s3_user":
        s3_user = context.source_s3_user
        if s3_user is None and context.s3_user_id is not None:
            try:
                s3_user = get_s3_users_service(db).get_user_record(context.s3_user_id)
            except S3UserNotFoundError:
                s3_user = None
        if s3_user is None:
            return _ManagerLimits()
        quota_max_size_gb, quota_max_objects, max_buckets = get_s3_users_service(db).get_user_limits(s3_user)
        return _ManagerLimits(
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            max_buckets=max_buckets,
        )

    s3_account = context.source_account
    if s3_account is None and context.id is not None:
        try:
            s3_account = get_s3_accounts_service(db).get_account_record(context.id)
        except S3AccountNotFoundError:
            s3_account = None
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


def _manager_feature_states(
    context: S3ExecutionContext,
    db: Session,
    resolved_access: Optional[ResolvedUserAccess],
    *,
    manager_bucket_quota_enabled: bool,
    manager_ceph_keys_enabled: bool,
    manager_access_key_metadata_enabled: bool,
    manager_access_key_expiration_enabled: bool,
    manager_private_access_enabled: bool,
) -> dict[str, FeatureState]:
    project_resource = project_usage_resource(db, context)
    resource = None
    if context.context_kind == "account":
        resource = context.source_account or project_resource
    elif context.context_kind == "s3_user":
        resource = project_resource

    provisioning_sources = (
        resolved_access.feature_sources.get("managed_private_connection_provision", ())
        if resolved_access
        else ()
    )
    app_settings = load_app_settings_for_db_readonly(db)
    states = manager_resource_states(
        app_settings.manager.feature_policies,
        resource,
        {
            "bucket_quota_management": manager_bucket_quota_enabled,
            "ceph_s3_user_keys": manager_ceph_keys_enabled,
            "access_key_metadata": manager_access_key_metadata_enabled,
            "access_key_expiration": manager_access_key_expiration_enabled,
            "cost_estimation": app_settings.general.cost_enabled,
            "managed_private_connection_provisioning": manager_private_access_enabled,
        },
        provisioning_source=provisioning_sources[0].kind if provisioning_sources else None,
        activity_resource=manager_activity_resource(db, context),
    )
    states["rgw_usage_metrics"] = manager_rgw_usage_metrics_state(
        app_settings.manager.feature_policies,
        manager_usage_metrics_resource(db, context),
    )
    states["bucket_usage_stats"] = bucket_usage_stats_state(
        app_settings.general.project_feature_policies,
        project_resource,
    )
    return states


@router.get("/context", response_model=ManagerContext)
def get_manager_context(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
    include_limits: Annotated[bool, Query()] = False,
) -> ManagerContext:
    access_mode = _manager_access_mode(context)
    manager_stats_enabled, manager_stats_message, connection_iam_identity = _manager_stats_state(context, actor, db)
    access_service = EffectiveAccessService(db) if isinstance(actor, User) else None
    resolved_access = access_service.resolve_user(actor) if access_service else None
    browser_state = _manager_browser_state(
        context,
        actor,
        db,
        access_service,
        resolved_access,
    )
    iam_identity = _manager_iam_identity(
        context,
        actor,
        access_mode,
        connection_iam_identity,
    )

    manager_ceph_keys_enabled = (
        is_manager_rgw_access_key_management_available(context, actor, db=db)
        if isinstance(actor, User)
        else False
    )
    access_key_metadata = AccessKeyMetadataService(db)
    manager_access_key_metadata_enabled = access_key_metadata.metadata_enabled_for_context(context)
    manager_access_key_expiration_enabled = access_key_metadata.expiration_enabled_for_context(context)
    manager_private_access_enabled = _manager_private_access_enabled(
        context,
        actor,
        db,
        resolved_access,
    )
    manager_bucket_quota_enabled = (
        is_manager_bucket_quota_available(context, actor, db=db)
        if isinstance(actor, User)
        else False
    )
    limits = _manager_limits(
        context,
        db,
        include_limits=include_limits,
    )
    feature_states = _manager_feature_states(
        context,
        db,
        resolved_access,
        manager_bucket_quota_enabled=manager_bucket_quota_enabled,
        manager_ceph_keys_enabled=manager_ceph_keys_enabled,
        manager_access_key_metadata_enabled=manager_access_key_metadata_enabled,
        manager_access_key_expiration_enabled=manager_access_key_expiration_enabled,
        manager_private_access_enabled=manager_private_access_enabled,
    )
    return ManagerContext(
        feature_states=feature_states,
        naming_validation_profile=naming_validation_profile(context),
        access_mode=access_mode,
        context_kind=("openstack_project" if access_mode == "openstack_project" else ("connection" if access_mode == "connection" else "account")),
        iam_identity=iam_identity,
        manager_stats_enabled=manager_stats_enabled,
        manager_stats_message=manager_stats_message,
        manager_browser_enabled=browser_state.enabled,
        manager_browser_message=browser_state.message,
        manager_bucket_quota_enabled=manager_bucket_quota_enabled,
        manager_ceph_keys_enabled=manager_ceph_keys_enabled,
        manager_access_key_metadata_enabled=manager_access_key_metadata_enabled,
        manager_access_key_expiration_enabled=manager_access_key_expiration_enabled,
        manager_private_access_enabled=manager_private_access_enabled,
        quota_max_size_gb=limits.quota_max_size_gb,
        quota_max_objects=limits.quota_max_objects,
        max_buckets=limits.max_buckets,
        max_users=limits.max_users,
        max_roles=limits.max_roles,
        max_groups=limits.max_groups,
    )
