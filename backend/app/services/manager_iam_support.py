# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import (
    ManagerIAMCredentialsMissingError,
    ManagerIAMManagedUserConflictError,
    ManagerIAMUserNotFoundError,
    ResourceConflictError,
)
from app.db import AccountIAMUser
from app.models.iam import (
    IAMGroup,
    IAMGroupCreate,
    IAMRole,
    IAMRoleCreate,
    IAMUser,
    IAMUserCreate,
    IAMUserUpdate,
    IAMUserWithKey,
)
from app.models.policy import InlinePolicy, Policy
from app.services.access_key_metadata_service import AccessKeyMetadataService
from app.services.managed_private_access_query_service import (
    ManagedPrivateAccessQueryService,
)
from app.services.managed_private_access_sources import iam_source_reference
from app.services.managed_resource_naming import PORTAL_MANAGED_IAM_GROUP_NAMES
from app.services.resource_name_validation import validate_inline_policy_requests
from app.services.rgw_iam import RGWIAMService, get_iam_service_for_execution_target
from app.services.s3_execution_context import S3ExecutionContext


@dataclass(frozen=True)
class ManagerIAMUserUpdateResult:
    user: IAMUser
    previous_name: str | None
    name_updated: bool
    path_updated: bool


_IAMEntity = TypeVar("_IAMEntity")


def managed_iam_user_source(
    db: Session,
    context: S3ExecutionContext,
    user_name: str,
) -> tuple[str, int | None] | None:
    source = iam_source_reference(context)
    if source is not None:
        provisioning = ManagedPrivateAccessQueryService(db).managed_iam_user(
            *source,
            user_name,
        )
        if provisioning is not None:
            return "private_access", provisioning.s3_connection_id
    if context.id is not None and (
        db.scalar(
            select(AccountIAMUser.id)
            .where(
                AccountIAMUser.account_id == context.id,
                AccountIAMUser.iam_username == user_name,
            )
            .limit(1)
        )
        is not None
    ):
        return "portal", None
    return None


def ensure_unmanaged_iam_user(db: Session, context: S3ExecutionContext, user_name: str) -> None:
    managed = managed_iam_user_source(db, context, user_name)
    if managed is None:
        return
    workflow = "private connection" if managed[0] == "private_access" else "Portal"
    raise ManagerIAMManagedUserConflictError(
        f"BucketReef-managed IAM users must be managed through their {workflow} workflow"
    )


def build_iam_service_for_context(context: S3ExecutionContext) -> RGWIAMService:
    service = get_iam_service_for_execution_target(context)
    if service is None:
        raise ManagerIAMCredentialsMissingError("Execution context credentials are missing")
    return service


def load_iam_user_details(service: RGWIAMService, user: IAMUser) -> IAMUser:
    user.groups = [group.name for group in service.list_groups_for_user(user.name)]
    user.policies = [policy.arn for policy in service.list_user_policies(user.name) if policy.arn]
    inline = service.list_user_inline_policies(user.name)
    user.inline_policies = inline or None
    user.has_keys = bool(service.list_access_keys(user.name))
    return user


def update_iam_user(
    db: Session,
    context: S3ExecutionContext,
    service: RGWIAMService,
    user_name: str,
    payload: IAMUserUpdate,
) -> ManagerIAMUserUpdateResult:
    existing = service.get_user(user_name)
    if existing is None:
        raise ManagerIAMUserNotFoundError("User not found")
    ensure_unmanaged_iam_user(db, context, user_name)

    new_name = payload.name if payload.name is not None and payload.name != user_name else None
    new_path = payload.path if payload.path is not None and payload.path != existing.path else None
    service.update_user(user_name, new_name=new_name, new_path=new_path)

    effective_name = new_name or user_name
    if new_name is not None and context.id is not None:
        AccessKeyMetadataService(db).rename_iam_principal_metadata(
            context.id,
            user_name,
            effective_name,
        )
    updated = service.get_user(effective_name)
    if updated is None:
        raise RuntimeError("Updated IAM user could not be reloaded")
    return ManagerIAMUserUpdateResult(
        user=load_iam_user_details(service, updated),
        previous_name=user_name if new_name is not None else None,
        name_updated=new_name is not None,
        path_updated=new_path is not None,
    )


def validate_iam_user_create(
    payload: IAMUserCreate,
    context: S3ExecutionContext,
) -> None:
    if any(group in PORTAL_MANAGED_IAM_GROUP_NAMES for group in payload.groups):
        raise ResourceConflictError(
            "Portal-managed IAM groups cannot be assigned through generic IAM user creation"
        )
    validate_inline_policy_requests(payload.inline_policies, "user", context)


def create_iam_user(
    service: RGWIAMService,
    payload: IAMUserCreate,
) -> IAMUserWithKey:
    created_user, created_key = service.create_user(
        payload.name,
        create_key=payload.create_key,
    )
    added_groups: list[str] = []
    attached_policies: list[str] = []
    inline_policy_names: list[str] = []
    try:
        for group_name in payload.groups:
            service.add_user_to_group(group_name, payload.name)
            added_groups.append(group_name)
        for policy_arn in payload.policies:
            service.attach_user_policy(payload.name, policy_arn)
            attached_policies.append(policy_arn)
        for inline in payload.inline_policies:
            service.put_user_inline_policy(payload.name, inline.name, inline.document)
            inline_policy_names.append(inline.name)
    except RuntimeError as exc:
        try:
            _rollback_created_iam_user(
                service,
                user_name=payload.name,
                groups=added_groups,
                policies=attached_policies,
                inline_policy_names=inline_policy_names,
                access_key_id=created_key.access_key_id if created_key is not None else None,
            )
        except RuntimeError as rollback_exc:
            raise RuntimeError(f"{exc}; {rollback_exc}") from exc
        raise
    return IAMUserWithKey(**created_user.model_dump(), access_key=created_key)


def _run_iam_rollback_step(
    failures: list[str],
    rollback_fn: Callable[..., None],
    *args: Any,
) -> None:
    try:
        rollback_fn(*args)
    except RuntimeError as exc:
        failures.append(str(exc))


def _rollback_created_iam_user(
    service: RGWIAMService,
    *,
    user_name: str,
    groups: list[str],
    policies: list[str],
    inline_policy_names: list[str],
    access_key_id: str | None,
) -> None:
    failures: list[str] = []
    for policy_name in reversed(inline_policy_names):
        _run_iam_rollback_step(
            failures,
            service.delete_user_inline_policy,
            user_name,
            policy_name,
        )
    for policy_arn in reversed(policies):
        _run_iam_rollback_step(
            failures,
            service.detach_user_policy,
            user_name,
            policy_arn,
        )
    for group_name in reversed(groups):
        _run_iam_rollback_step(
            failures,
            service.remove_user_from_group,
            group_name,
            user_name,
        )
    if access_key_id is not None:
        _run_iam_rollback_step(
            failures,
            service.delete_access_key,
            user_name,
            access_key_id,
        )
    _run_iam_rollback_step(failures, service.delete_user, user_name)
    if failures:
        raise RuntimeError(
            f"Unable to fully roll back created IAM user {user_name}: " + "; ".join(failures)
        )


def _rollback_created_iam_identity(
    *,
    entity_label: str,
    entity_name: str,
    policies: list[str],
    inline_policy_names: list[str],
    detach_policy_fn: Callable[[str, str], None],
    delete_inline_policy_fn: Callable[[str, str], None],
    delete_entity_fn: Callable[[str], None],
) -> None:
    failures: list[str] = []
    for policy_name in reversed(inline_policy_names):
        _run_iam_rollback_step(
            failures,
            delete_inline_policy_fn,
            entity_name,
            policy_name,
        )
    for policy_arn in reversed(policies):
        _run_iam_rollback_step(failures, detach_policy_fn, entity_name, policy_arn)
    _run_iam_rollback_step(failures, delete_entity_fn, entity_name)
    if failures:
        raise RuntimeError(
            f"Unable to fully roll back created {entity_label} {entity_name}: "
            + "; ".join(failures)
        )


def _configure_created_iam_identity(
    result: _IAMEntity,
    *,
    entity_label: str,
    entity_name: str,
    policies: list[str],
    inline_policies: list[InlinePolicy],
    attach_policy_fn: Callable[[str, str], None],
    put_inline_policy_fn: Callable[[str, str, dict[str, Any]], None],
    detach_policy_fn: Callable[[str, str], None],
    delete_inline_policy_fn: Callable[[str, str], None],
    delete_entity_fn: Callable[[str], None],
) -> _IAMEntity:
    attached_policies: list[str] = []
    inline_policy_names: list[str] = []
    try:
        for policy_arn in policies:
            attach_policy_fn(entity_name, policy_arn)
            attached_policies.append(policy_arn)
        for inline in inline_policies:
            put_inline_policy_fn(entity_name, inline.name, inline.document)
            inline_policy_names.append(inline.name)
    except RuntimeError as exc:
        try:
            _rollback_created_iam_identity(
                entity_label=entity_label,
                entity_name=entity_name,
                policies=attached_policies,
                inline_policy_names=inline_policy_names,
                detach_policy_fn=detach_policy_fn,
                delete_inline_policy_fn=delete_inline_policy_fn,
                delete_entity_fn=delete_entity_fn,
            )
        except RuntimeError as rollback_exc:
            raise RuntimeError(f"{exc}; {rollback_exc}") from exc
        raise
    return result


def create_iam_group(
    service: RGWIAMService,
    payload: IAMGroupCreate,
) -> IAMGroup:
    return _configure_created_iam_identity(
        service.create_group(payload.name),
        entity_label="IAM group",
        entity_name=payload.name,
        policies=payload.policies,
        inline_policies=payload.inline_policies,
        attach_policy_fn=service.attach_group_policy,
        put_inline_policy_fn=service.put_group_inline_policy,
        detach_policy_fn=service.detach_group_policy,
        delete_inline_policy_fn=service.delete_group_inline_policy,
        delete_entity_fn=service.delete_group,
    )


def create_iam_role(
    service: RGWIAMService,
    payload: IAMRoleCreate,
    assume_policy: Any,
) -> IAMRole:
    return _configure_created_iam_identity(
        service.create_role(
            payload.name,
            assume_policy,
            path=payload.path,
            max_session_duration=payload.max_session_duration,
            tags=payload.tags,
        ),
        entity_label="IAM role",
        entity_name=payload.name,
        policies=payload.policies,
        inline_policies=payload.inline_policies,
        attach_policy_fn=service.attach_role_policy,
        put_inline_policy_fn=service.put_role_inline_policy,
        detach_policy_fn=service.detach_role_policy,
        delete_inline_policy_fn=service.delete_role_inline_policy,
        delete_entity_fn=service.delete_role,
    )


def validate_inline_policy_name(payload: InlinePolicy, policy_name: str) -> None:
    if payload.name and payload.name != policy_name:
        raise ValueError("Inline policy name in payload does not match the URL.")


def load_inline_policies(
    entity_name: str,
    *,
    list_names_fn: Callable[[str], list[str]],
    get_policy_fn: Callable[[str, str], dict[str, Any] | None],
) -> list[InlinePolicy]:
    names = list_names_fn(entity_name)
    policies: list[InlinePolicy] = []
    for name in names:
        document = get_policy_fn(entity_name, name) or {}
        policies.append(InlinePolicy(name=name, document=document))
    return policies


def save_inline_policy(
    entity_name: str,
    *,
    policy_name: str,
    document: dict[str, Any],
    put_policy_fn: Callable[[str, str, dict[str, Any]], None],
    get_policy_fn: Callable[[str, str], dict[str, Any] | None],
) -> InlinePolicy:
    put_policy_fn(entity_name, policy_name, document)
    saved = get_policy_fn(entity_name, policy_name) or document
    return InlinePolicy(name=policy_name, document=saved)


def resolve_attached_policy(
    payload: Policy,
    *,
    get_policy_fn: Callable[[str], Policy | None],
) -> Policy:
    fetched = get_policy_fn(payload.arn)
    if fetched:
        return fetched
    return Policy(
        name=payload.name,
        arn=payload.arn,
        path=payload.path,
        default_version_id=payload.default_version_id,
    )
