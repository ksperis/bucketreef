# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.access_context import ManagerActor
from app.services.s3_execution_context import S3ExecutionContext
from app.models.iam import IAMGroup, IAMGroupCreate, IAMGroupUpdate, IAMUser
from app.models.policy import InlinePolicy, Policy
from app.routers.dependencies import (
    get_s3_execution_context,
    get_audit_service,
    require_iam_capable_manager,
)
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_http_exception_from_exception
from app.routers.manager.iam_common import (
    ensure_unmanaged_iam_user,
    ensure_inline_policy_name,
    get_iam_service_for_context,
)
from app.services.audit_service import AuditService
from app.services.manager_iam_support import load_inline_policies, resolve_attached_policy, save_inline_policy
from app.services.managed_resource_naming import PORTAL_MANAGED_IAM_GROUP_NAMES
from app.services.resource_name_validation import validate_inline_policy_request, validate_inline_policy_requests

router = APIRouter(prefix="/manager/iam/groups", tags=["manager-iam-groups"])


def _ensure_unmanaged_group(group_name: str) -> None:
    # Portal group membership and policies are controlled by Portal orchestration.
    if group_name in PORTAL_MANAGED_IAM_GROUP_NAMES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="BucketReef-managed IAM groups must be managed through Portal workflows",
        )


def _annotate_managed_group(item: IAMGroup) -> IAMGroup:
    if item.name in PORTAL_MANAGED_IAM_GROUP_NAMES:
        item.is_bucketreef_managed = True
        item.management_source = "portal"
    return item


@router.get("", response_model=list[IAMGroup])
def list_groups(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    db: Session = Depends(get_db),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[IAMGroup]:
    service = get_iam_service_for_context(context)
    try:
        return [_annotate_managed_group(group) for group in service.list_groups()]
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{group_name}", response_model=IAMGroup)
def get_group(
    group_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> IAMGroup:
    service = get_iam_service_for_context(context)
    try:
        group = service.get_group(group_name)
        if group is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        return _annotate_managed_group(group)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/{group_name}", response_model=IAMGroup)
def update_group(
    group_name: str,
    payload: IAMGroupUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> IAMGroup:
    _ensure_unmanaged_group(group_name)
    service = get_iam_service_for_context(context)
    try:
        existing = service.get_group(group_name)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        new_name = payload.name if payload.name is not None and payload.name != group_name else None
        new_path = payload.path if payload.path is not None and payload.path != existing.path else None
        service.update_group(group_name, new_name=new_name, new_path=new_path)
        effective_name = new_name or group_name
        updated = service.get_group(effective_name)
        if updated is None:
            raise RuntimeError("Updated IAM group could not be reloaded")
        if new_name is not None or new_path is not None:
            audit_service.record_action(
                user=current_user,
                scope="manager",
                action="update_iam_group",
                entity_type="iam_group",
                entity_id=effective_name,
                execution_context=context,
                metadata={
                    "previous_name": group_name if new_name is not None else None,
                    "name_updated": new_name is not None,
                    "path_updated": new_path is not None,
                },
            )
        return _annotate_managed_group(updated)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("", response_model=IAMGroup, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: IAMGroupCreate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> IAMGroup:
    _ensure_unmanaged_group(payload.name)
    validate_inline_policy_requests(payload.inline_policies, "group", context)
    service = get_iam_service_for_context(context)
    try:
        result = service.create_group(payload.name)
        if payload.inline_policies:
            for inline in payload.inline_policies:
                service.put_group_inline_policy(payload.name, inline.name, inline.document)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_iam_group",
            entity_type="iam_group",
            entity_id=payload.name,
            execution_context=context,
            metadata={"inline_policies": [p.name for p in payload.inline_policies] if payload.inline_policies else []},
        )
        return result
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{group_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    _ensure_unmanaged_group(group_name)
    service = get_iam_service_for_context(context)
    try:
        service.delete_group(group_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_iam_group",
            entity_type="iam_group",
            entity_id=group_name,
            execution_context=context,
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{group_name}/users", response_model=list[IAMUser])
def list_group_users(
    group_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[IAMUser]:
    service = get_iam_service_for_context(context)
    try:
        return service.list_group_users(group_name)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("/{group_name}/users", response_model=IAMUser, status_code=status.HTTP_201_CREATED)
def add_user_to_group(
    group_name: str,
    payload: IAMUser,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> IAMUser:
    _ensure_unmanaged_group(group_name)
    ensure_unmanaged_iam_user(db, context, payload.name)
    service = get_iam_service_for_context(context)
    try:
        service.add_user_to_group(group_name, payload.name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="add_user_to_group",
            entity_type="iam_group",
            entity_id=group_name,
            execution_context=context,
            metadata={"user": payload.name},
        )
        return IAMUser(name=payload.name)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{group_name}/users/{user_name}", status_code=status.HTTP_204_NO_CONTENT)
def remove_user_from_group(
    group_name: str,
    user_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> None:
    _ensure_unmanaged_group(group_name)
    ensure_unmanaged_iam_user(db, context, user_name)
    service = get_iam_service_for_context(context)
    try:
        service.remove_user_from_group(group_name, user_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="remove_user_from_group",
            entity_type="iam_group",
            entity_id=group_name,
            execution_context=context,
            metadata={"user": user_name},
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{group_name}/inline-policies", response_model=list[InlinePolicy])
def list_group_inline_policies(
    group_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[InlinePolicy]:
    service = get_iam_service_for_context(context)
    try:
        return load_inline_policies(
            group_name,
            list_names_fn=service.list_group_inline_policies,
            get_policy_fn=service.get_group_inline_policy,
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.put("/{group_name}/inline-policies/{policy_name}", response_model=InlinePolicy)
def put_group_inline_policy(
    group_name: str,
    policy_name: str,
    payload: InlinePolicy,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> InlinePolicy:
    _ensure_unmanaged_group(group_name)
    validate_inline_policy_request(payload.name, "group", context)
    validate_inline_policy_request(policy_name, "group", context, loc=("path", "policy_name"))
    ensure_inline_policy_name(payload, policy_name)
    service = get_iam_service_for_context(context)
    try:
        saved = save_inline_policy(
            group_name,
            policy_name=policy_name,
            document=payload.document,
            put_policy_fn=service.put_group_inline_policy,
            get_policy_fn=service.get_group_inline_policy,
        )
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_group_inline_policy",
            entity_type="iam_group",
            entity_id=group_name,
            execution_context=context,
            metadata={"policy_name": policy_name},
        )
        return saved
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{group_name}/inline-policies/{policy_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group_inline_policy(
    group_name: str,
    policy_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    _ensure_unmanaged_group(group_name)
    service = get_iam_service_for_context(context)
    try:
        service.delete_group_inline_policy(group_name, policy_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_group_inline_policy",
            entity_type="iam_group",
            entity_id=group_name,
            execution_context=context,
            metadata={"policy_name": policy_name},
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{group_name}/policies", response_model=list[Policy])
def list_group_policies(
    group_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[Policy]:
    service = get_iam_service_for_context(context)
    try:
        return service.list_group_policies(group_name)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("/{group_name}/policies", response_model=Policy, status_code=status.HTTP_201_CREATED)
def attach_group_policy(
    group_name: str,
    payload: Policy,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> Policy:
    _ensure_unmanaged_group(group_name)
    service = get_iam_service_for_context(context)
    try:
        service.attach_group_policy(group_name, payload.arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="attach_group_policy",
            entity_type="iam_group",
            entity_id=group_name,
            execution_context=context,
            metadata={"policy_arn": payload.arn},
        )
        return resolve_attached_policy(payload, get_policy_fn=service.get_policy)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{group_name}/policies/{policy_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def detach_group_policy(
    group_name: str,
    policy_arn: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    _ensure_unmanaged_group(group_name)
    service = get_iam_service_for_context(context)
    try:
        service.detach_group_policy(group_name, policy_arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="detach_group_policy",
            entity_type="iam_group",
            entity_id=group_name,
            execution_context=context,
            metadata={"policy_arn": policy_arn},
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
