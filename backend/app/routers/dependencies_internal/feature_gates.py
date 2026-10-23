# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import Literal, Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.feature_policy import FeaturePolicy
from app.models.access_context import BucketMigrationAccessScope, ManagerActor
from app.models.session import ManagerSessionPrincipal
from app.routers.manager.access import require_manager_capabilities
from app.services import app_settings_service
from app.services.connection_identity_service import ConnectionIdentityService
from app.services.effective_access_service import EffectiveAccessService, ResolvedUserAccess
from app.services.feature_policy_service import (
    bucket_usage_stats_state,
    manager_rgw_usage_metrics_state,
    manager_usage_metrics_resource,
    project_usage_resource,
)
from app.services.manager_tool_access import MANAGER_TOOL_ROLES
from app.services.manager_ceph_management_access_service import ManagerCephManagementAccessService
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.services.rgw_supervision import has_supervision_credentials
from app.utils.storage_endpoint_features import resolve_feature_flags

from .execution_context import get_s3_execution_context
from .auth_session import get_current_actor, get_current_user
from .workspace_context import browser_workspace_header

ManagerToolKey = Literal[
    "bucket_compare",
    "bucket_integrity_check",
    "bucket_migration",
    "feature_rules",
    "bucket_purge",
]

_MANAGER_TOOL_DISABLED_MESSAGES: dict[ManagerToolKey, str] = {
    "bucket_compare": "Bucket compare feature is disabled",
    "bucket_integrity_check": "Bucket integrity check feature is disabled",
    "bucket_migration": "Bucket migration feature is disabled",
    "bucket_purge": "Bucket purge feature is disabled",
    "feature_rules": "Feature rules are disabled",
}


def _require_supervision_access(
    context: S3ExecutionContext,
    actor: ManagerActor,
    db: Session,
    disabled_detail: str,
    required_feature: Literal["metrics", "usage"],
) -> ManagerActor:
    caps = require_manager_capabilities(context)
    settings = app_settings_service.load_app_settings_for_db_readonly(db)
    metrics_state = manager_rgw_usage_metrics_state(
        settings.manager.feature_policies,
        manager_usage_metrics_resource(db, context),
    )
    if not metrics_state.enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="RGW traffic and usage metrics are disabled",
        )

    if isinstance(actor, ManagerSessionPrincipal) and not actor.capabilities.can_view_traffic:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics are not available for this profile")
    if not caps.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics are not available for this context")
    endpoint = context.storage_endpoint

    if context.context_kind == "connection":
        source_connection = context.source_connection
        if (
            source_connection is None
            or context.s3_connection_id is None
            or source_connection.id != context.s3_connection_id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Metrics are unavailable: connection context is incomplete.",
            )
        resolution = ConnectionIdentityService().resolve_metrics_identity(source_connection)
        if not resolution.eligible:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=resolution.reason or disabled_detail)
        if required_feature == "metrics" and not resolution.metrics_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
        if required_feature == "usage" and not resolution.usage_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage logs are disabled for this endpoint")
        context.rgw_tenant = resolution.rgw_tenant
        if resolution.rgw_account_id:
            context.rgw_account_id = resolution.rgw_account_id
        if resolution.rgw_user_uid:
            context.rgw_user_uid = resolution.rgw_user_uid

    if endpoint:
        flags = resolve_feature_flags(endpoint)
        if required_feature == "metrics" and not flags.metrics_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=disabled_detail)
        if required_feature == "usage" and not flags.usage_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=disabled_detail)
    if not has_supervision_credentials(context):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Supervision credentials are not configured for this context")
    return actor


def require_iam_capable_manager(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    caps = require_manager_capabilities(context)
    if not caps.can_manage_iam:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IAM management not allowed for this context")
    endpoint = context.storage_endpoint
    if endpoint and not resolve_feature_flags(endpoint).iam_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IAM is disabled for this endpoint")
    return actor


def require_storage_metrics_capable_manager(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> ManagerActor:
    return _require_supervision_access(
        context,
        actor,
        db,
        disabled_detail="Storage metrics are disabled for this endpoint",
        required_feature="metrics",
    )


def require_sns_capable_manager(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    require_manager_capabilities(context)
    endpoint = context.storage_endpoint
    if endpoint:
        flags = resolve_feature_flags(endpoint)
        if not flags.sns_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SNS topics are disabled for this endpoint")
    return actor


def require_usage_logs_capable_manager(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> ManagerActor:
    return _require_supervision_access(
        context,
        actor,
        db,
        disabled_detail="Usage logs are disabled for this endpoint",
        required_feature="usage",
    )


def _manager_tool_global_state(tool: ManagerToolKey, db: Session) -> tuple[bool, str]:
    app_settings = app_settings_service.load_app_settings_for_db_readonly(db)
    disabled_detail = _MANAGER_TOOL_DISABLED_MESSAGES[tool]
    return getattr(app_settings.manager.feature_policies, tool) != FeaturePolicy.DISABLED, disabled_detail


def ensure_manager_tool_allowed(user: User, tool: ManagerToolKey, db: Session) -> ResolvedUserAccess:
    enabled, disabled_detail = _manager_tool_global_state(tool, db)
    if not enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=disabled_detail)
    if user.role not in MANAGER_TOOL_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    effective = EffectiveAccessService(db).resolve_user(user)
    if getattr(effective.manager_tool_access, tool):
        return effective
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


def get_current_bucket_migration_scope(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BucketMigrationAccessScope:
    effective = ensure_manager_tool_allowed(user, "bucket_migration", db=db)
    return EffectiveAccessService(db).build_bucket_migration_scope(user, resolved=effective)


def require_bucket_compare_enabled(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    ensure_manager_tool_allowed(user, "bucket_compare", db=db)
    return user


def require_bucket_integrity_check_enabled(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    ensure_manager_tool_allowed(user, "bucket_integrity_check", db=db)
    return user


def require_bucket_purge_enabled(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    ensure_manager_tool_allowed(user, "bucket_purge", db=db)
    return user


def require_bucket_purge_global_enabled(db: Session = Depends(get_db)) -> None:
    app_settings = app_settings_service.load_app_settings_for_db_readonly(db)
    if app_settings.manager.feature_policies.bucket_purge == FeaturePolicy.DISABLED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket purge feature is disabled")


def require_bucket_usage_stats_enabled(
    user: User = Depends(get_current_user),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    db: Session = Depends(get_db),
) -> User:
    app_settings = app_settings_service.load_app_settings_for_db_readonly(db)
    state = bucket_usage_stats_state(
        app_settings.general.project_feature_policies,
        project_usage_resource(db, context),
    )
    if not state.enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket usage stats feature is disabled")
    if user.role not in MANAGER_TOOL_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def require_manager_feature_rules_enabled(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    ensure_manager_tool_allowed(user, "feature_rules", db=db)
    return user


def is_manager_bucket_quota_available(
    context: S3ExecutionTarget,
    user: Optional[User] = None,
    db: Session | None = None,
) -> bool:
    if db is None:
        return False
    return ManagerCephManagementAccessService(db).evaluate(
        "bucket_quota",
        surface="manager",
        actor=user,
        execution_context=context,
    ).allowed


def require_manager_bucket_quota(
    user: User = Depends(get_current_user),
    context: S3ExecutionTarget = Depends(get_s3_execution_context),
    db: Session = Depends(get_db),
) -> S3ExecutionTarget:
    decision = ManagerCephManagementAccessService(db).evaluate(
        "bucket_quota",
        surface="manager",
        actor=user,
        execution_context=context,
    )
    if not decision.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=decision.reason)
    return context


def is_manager_rgw_access_key_management_available(
    context: S3ExecutionTarget,
    user: Optional[User] = None,
    db: Session | None = None,
) -> bool:
    if db is None:
        return False
    return ManagerCephManagementAccessService(db).evaluate(
        "rgw_access_keys",
        surface="manager",
        actor=user,
        execution_context=context,
    ).allowed


def require_manager_rgw_access_key_management(
    user: User = Depends(get_current_user),
    context: S3ExecutionTarget = Depends(get_s3_execution_context),
    db: Session = Depends(get_db),
) -> S3ExecutionTarget:
    decision = ManagerCephManagementAccessService(db).evaluate(
        "rgw_access_keys",
        surface="manager",
        actor=user,
        execution_context=context,
    )
    if not decision.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=decision.reason)
    return context


def require_manager_enabled(db: Session = Depends(get_db)) -> None:
    settings = app_settings_service.load_app_settings_for_db_readonly(db)
    if not settings.general.manager_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager feature is disabled")


def require_ceph_admin_enabled(db: Session = Depends(get_db)) -> None:
    settings = app_settings_service.load_app_settings_for_db_readonly(db)
    if not settings.general.ceph_admin_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ceph admin feature is disabled")


def require_storage_ops_enabled(db: Session = Depends(get_db)) -> None:
    settings = app_settings_service.load_app_settings_for_db_readonly(db)
    if not settings.general.storage_ops_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage Ops feature is disabled")


def require_browser_enabled(db: Session = Depends(get_db)) -> None:
    settings = app_settings_service.load_app_settings_for_db_readonly(db)
    if not settings.general.browser_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser feature is disabled")


def require_browser_workspace_surface(
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    surface = browser_workspace_header(request)
    if surface not in {"", "portal", "manager-browser"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Browser workspace surface is not authorized",
        )
    if surface != "manager-browser":
        return
    settings = app_settings_service.load_app_settings_for_db_readonly(db)
    if not settings.general.manager_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager feature is disabled",
        )
    if not settings.general.browser_manager_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager Browser feature is disabled",
        )


def require_portal_enabled(db: Session = Depends(get_db)) -> None:
    settings = app_settings_service.load_app_settings_for_db_readonly(db)
    if not settings.general.portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal feature is disabled")


def require_manager_context_enabled(db: Session = Depends(get_db)) -> None:
    settings = app_settings_service.load_app_settings_for_db_readonly(db)
    if not settings.general.manager_enabled and not settings.general.browser_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager access is disabled")
