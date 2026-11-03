# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.services.access_context_contracts import ManagerActor
from app.services.s3_execution_context import S3ExecutionContext
from app.models.iam import IAMRole, IAMRoleCreate, IAMRolePage, IAMRoleUpdate, IAMTag
from app.models.policy import InlinePolicy, Policy
from app.routers.dependencies import (
    get_s3_execution_context,
    get_audit_service,
    require_iam_capable_manager,
)
from app.utils.http_errors import (
    raise_http_error_from_value_error,
    raise_http_exception_from_exception,
)
from app.routers.manager.iam_common import (
    ensure_inline_policy_name,
    get_iam_service_for_context,
    run_audited_iam_mutation,
    run_iam_read,
)
from app.services.audit_service import AuditService
from app.services.manager_iam_role_service import update_iam_role
from app.services.manager_iam_support import (
    attach_iam_policy,
    create_iam_role,
    load_inline_policies,
    save_inline_policy,
)
from app.services.resource_name_validation import validate_inline_policy_request, validate_inline_policy_requests

router = APIRouter(prefix="/manager/iam/roles", tags=["manager-iam-roles"])


def _ensure_role_tags_persisted(requested: list[IAMTag], current: list[IAMTag]) -> None:
    current_pairs = {(tag.key, tag.value) for tag in current}
    if any((tag.key, tag.value) not in current_pairs for tag in requested):
        raise RuntimeError("IAM role tag update did not persist on the storage backend")


def _ensure_role_tag_removed(tag_key: str, current: list[IAMTag]) -> None:
    if any(tag.key == tag_key for tag in current):
        raise RuntimeError("IAM role tag deletion did not persist on the storage backend")


@router.get("", response_model=list[IAMRole])
def list_roles(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[IAMRole]:
    service = get_iam_service_for_context(context)
    try:
        return service.list_roles()
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/page", response_model=IAMRolePage)
def list_roles_page(
    marker: str | None = Query(None),
    page_size: int = Query(25, ge=1, le=100),
    search: str | None = Query(None, max_length=200),
    include_details: bool = Query(False),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> IAMRolePage:
    service = get_iam_service_for_context(context)
    try:
        roles, next_marker = service.list_roles_page(
            marker=marker,
            max_items=page_size,
            search=search,
        )
        if include_details:
            for role in roles:
                role.policies = [policy.arn for policy in service.list_role_policies(role.name)]
                inline = service.list_role_inline_policies(role.name)
                role.inline_policies = inline or None
        return IAMRolePage(items=roles, next_marker=next_marker)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("", response_model=IAMRole, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: IAMRoleCreate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> IAMRole:
    validate_inline_policy_requests(payload.inline_policies, "role", context)
    service = get_iam_service_for_context(context)
    assume_policy = payload.assume_role_policy_document
    if isinstance(assume_policy, str):
        try:
            assume_policy = json.loads(assume_policy)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assume role policy must be valid JSON") from exc
    try:
        result = create_iam_role(service, payload, assume_policy)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_iam_role",
            entity_type="iam_role",
            entity_id=payload.name,
            execution_context=context,
            metadata={
                "policies": payload.policies,
                "inline_policies": [p.name for p in payload.inline_policies],
                "max_session_duration": payload.max_session_duration,
                "tag_keys": [tag.key for tag in payload.tags] if payload.tags else [],
            },
        )
        return result
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{role_name}", response_model=IAMRole)
def get_role(
    role_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> IAMRole:
    service = get_iam_service_for_context(context)
    try:
        role = service.get_role(role_name)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role


@router.delete("/{role_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    role_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    service = get_iam_service_for_context(context)
    try:
        service.delete_role(role_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_iam_role",
            entity_type="iam_role",
            entity_id=role_name,
            execution_context=context,
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.patch("/{role_name}", response_model=IAMRole)
def update_role(
    role_name: str,
    payload: IAMRoleUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> IAMRole:
    service = get_iam_service_for_context(context)
    try:
        return update_iam_role(
            service,
            role_name,
            payload,
            context=context,
            current_user=current_user,
            audit_service=audit_service,
        )
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{role_name}/tags", response_model=list[IAMTag])
def list_role_tags(
    role_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[IAMTag]:
    service = get_iam_service_for_context(context)
    try:
        if service.get_role(role_name) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
        return service.list_role_tags(role_name)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.put("/{role_name}/tags", response_model=list[IAMTag])
def put_role_tags(
    role_name: str,
    payload: list[IAMTag],
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> list[IAMTag]:
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one role tag is required")
    if len(payload) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="IAM roles support at most 50 tags per request")
    service = get_iam_service_for_context(context)
    try:
        if service.get_role(role_name) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
        service.tag_role(role_name, payload)
        tags = service.list_role_tags(role_name)
        _ensure_role_tags_persisted(payload, tags)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="tag_iam_role",
            entity_type="iam_role",
            entity_id=role_name,
            execution_context=context,
            metadata={"tag_keys": [tag.key for tag in payload]},
        )
        return tags
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{role_name}/tags/{tag_key:path}", response_model=list[IAMTag])
def delete_role_tag(
    role_name: str,
    tag_key: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> list[IAMTag]:
    service = get_iam_service_for_context(context)
    try:
        if service.get_role(role_name) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
        service.untag_role(role_name, [tag_key])
        tags = service.list_role_tags(role_name)
        _ensure_role_tag_removed(tag_key, tags)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="untag_iam_role",
            entity_type="iam_role",
            entity_id=role_name,
            execution_context=context,
            metadata={"tag_keys": [tag_key]},
        )
        return tags
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{role_name}/inline-policies", response_model=list[InlinePolicy])
def list_role_inline_policies(
    role_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[InlinePolicy]:
    service = get_iam_service_for_context(context)
    return run_iam_read(
        lambda: load_inline_policies(
            role_name,
            list_names_fn=service.list_role_inline_policies,
            get_policy_fn=service.get_role_inline_policy,
        )
    )


@router.put("/{role_name}/inline-policies/{policy_name}", response_model=InlinePolicy)
def put_role_inline_policy(
    role_name: str,
    policy_name: str,
    payload: InlinePolicy,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> InlinePolicy:
    validate_inline_policy_request(payload.name, "role", context)
    validate_inline_policy_request(policy_name, "role", context, loc=("path", "policy_name"))
    ensure_inline_policy_name(payload, policy_name)
    service = get_iam_service_for_context(context)
    return run_audited_iam_mutation(
        mutation=lambda: save_inline_policy(
            role_name,
            policy_name=policy_name,
            document=payload.document,
            put_policy_fn=service.put_role_inline_policy,
            get_policy_fn=service.get_role_inline_policy,
        ),
        audit_service=audit_service,
        current_user=current_user,
        context=context,
        action="put_role_inline_policy",
        entity_type="iam_role",
        entity_id=role_name,
        metadata={"policy_name": policy_name},
    )


@router.delete("/{role_name}/inline-policies/{policy_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role_inline_policy(
    role_name: str,
    policy_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    service = get_iam_service_for_context(context)
    run_audited_iam_mutation(
        mutation=lambda: service.delete_role_inline_policy(role_name, policy_name),
        audit_service=audit_service,
        current_user=current_user,
        context=context,
        action="delete_role_inline_policy",
        entity_type="iam_role",
        entity_id=role_name,
        metadata={"policy_name": policy_name},
    )


@router.get("/{role_name}/policies", response_model=list[Policy])
def list_role_policies(
    role_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[Policy]:
    service = get_iam_service_for_context(context)
    return run_iam_read(lambda: service.list_role_policies(role_name))


@router.post("/{role_name}/policies", response_model=Policy, status_code=status.HTTP_201_CREATED)
def attach_role_policy(
    role_name: str,
    payload: Policy,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> Policy:
    service = get_iam_service_for_context(context)
    return run_audited_iam_mutation(
        mutation=lambda: attach_iam_policy(
            role_name,
            payload,
            attach_policy_fn=service.attach_role_policy,
            get_policy_fn=service.get_policy,
        ),
        audit_service=audit_service,
        current_user=current_user,
        context=context,
        action="attach_role_policy",
        entity_type="iam_role",
        entity_id=role_name,
        metadata={"policy_arn": payload.arn},
    )


@router.delete("/{role_name}/policies/{policy_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def detach_role_policy(
    role_name: str,
    policy_arn: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    service = get_iam_service_for_context(context)
    run_audited_iam_mutation(
        mutation=lambda: service.detach_role_policy(role_name, policy_arn),
        audit_service=audit_service,
        current_user=current_user,
        context=context,
        action="detach_role_policy",
        entity_type="iam_role",
        entity_id=role_name,
        metadata={"policy_arn": policy_arn},
    )
