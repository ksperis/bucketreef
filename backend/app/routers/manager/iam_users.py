# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.access_context import ManagerActor
from app.services.s3_execution_context import S3ExecutionContext
from app.models.access_key_metadata import AccessKeyMetadata, AccessKeyMetadataInput
from app.models.iam import AccessKey, AccessKeyStatusChange, IAMUser, IAMUserCreate, IAMUserUpdate, IAMUserWithKey
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
from app.services.resource_name_validation import validate_inline_policy_request, validate_inline_policy_requests
from app.services.access_key_metadata_service import AccessKeyMetadataService
from app.services.manager_iam_support import (
    load_inline_policies,
    managed_iam_user_source,
    resolve_attached_policy,
    save_inline_policy,
)
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.managed_private_access_sources import iam_source_reference
from app.services.managed_resource_naming import PORTAL_MANAGED_IAM_GROUP_NAMES

router = APIRouter(prefix="/manager/iam/users", tags=["manager-iam-users"])


def _annotate_managed_user(db: Session, context: S3ExecutionContext, item: IAMUser) -> IAMUser:
    managed = managed_iam_user_source(db, context, item.name)
    if managed is not None:
        item.is_bucketreef_managed = True
        item.management_source = managed[0]
        if managed[0] == "private_access":
            item.is_private_access_managed = True
            item.managed_connection_id = managed[1]
    return item


def _ensure_unmanaged_user(db: Session, context: S3ExecutionContext, user_name: str) -> None:
    ensure_unmanaged_iam_user(db, context, user_name)


@router.get("", response_model=list[IAMUser])
def list_users(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    db: Session = Depends(get_db),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[IAMUser]:
    service = get_iam_service_for_context(context)
    try:
        users = service.list_users()
        for item in users:
            _annotate_managed_user(db, context, item)
        return users
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{user_name}", response_model=IAMUser)
def get_user(
    user_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    db: Session = Depends(get_db),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> IAMUser:
    service = get_iam_service_for_context(context)
    try:
        user = service.get_user(user_name)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        user.groups = [group.name for group in service.list_groups_for_user(user_name)]
        user.policies = [policy.arn for policy in service.list_user_policies(user_name) if policy.arn]
        inline = service.list_user_inline_policies(user_name)
        user.inline_policies = inline or None
        user.has_keys = bool(service.list_access_keys(user_name))
        return _annotate_managed_user(db, context, user)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.patch("/{user_name}", response_model=IAMUser)
def update_user(
    user_name: str,
    payload: IAMUserUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> IAMUser:
    service = get_iam_service_for_context(context)
    try:
        existing = service.get_user(user_name)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        _annotate_managed_user(db, context, existing)
        if existing.is_bucketreef_managed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="BucketReef-managed IAM users cannot be renamed or moved",
            )
        new_name = payload.name if payload.name is not None and payload.name != user_name else None
        new_path = payload.path if payload.path is not None and payload.path != existing.path else None
        service.update_user(user_name, new_name=new_name, new_path=new_path)
        effective_name = new_name or user_name
        if new_name is not None and context.id is not None:
            AccessKeyMetadataService(db).rename_iam_principal_metadata(context.id, user_name, effective_name)
        updated = service.get_user(effective_name)
        if updated is None:
            raise RuntimeError("Updated IAM user could not be reloaded")
        updated.groups = [group.name for group in service.list_groups_for_user(effective_name)]
        updated.policies = [policy.arn for policy in service.list_user_policies(effective_name) if policy.arn]
        inline = service.list_user_inline_policies(effective_name)
        updated.inline_policies = inline or None
        updated.has_keys = bool(service.list_access_keys(effective_name))
        if new_name is not None or new_path is not None:
            audit_service.record_action(
                user=current_user,
                scope="manager",
                action="update_iam_user",
                entity_type="iam_user",
                entity_id=effective_name,
                execution_context=context,
                metadata={
                    "previous_name": user_name if new_name is not None else None,
                    "name_updated": new_name is not None,
                    "path_updated": new_path is not None,
                },
            )
        return updated
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("", response_model=IAMUserWithKey, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: IAMUserCreate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
) -> IAMUserWithKey:
    if any(group in PORTAL_MANAGED_IAM_GROUP_NAMES for group in (payload.groups or [])):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Portal-managed IAM groups cannot be assigned through generic IAM user creation",
        )
    validate_inline_policy_requests(payload.inline_policies, "user", context)
    service = get_iam_service_for_context(context)
    try:
        created_user, created_key = service.create_user(payload.name, create_key=payload.create_key)
        # Optionally attach user to groups
        if payload.groups:
            for group_name in payload.groups:
                service.add_user_to_group(group_name, payload.name)
        # Optionally attach managed policies
        if payload.policies:
            for policy_arn in payload.policies:
                service.attach_user_policy(payload.name, policy_arn)
        if payload.inline_policies:
            for inline in payload.inline_policies:
                service.put_user_inline_policy(payload.name, inline.name, inline.document)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_iam_user",
            entity_type="iam_user",
            entity_id=payload.name,
            execution_context=context,
            metadata={
                "create_key": payload.create_key,
                "groups": payload.groups or [],
                "policies": payload.policies or [],
                "inline_policies": [p.name for p in payload.inline_policies] if payload.inline_policies else [],
                "access_key_created": bool(created_key),
            },
        )
        return IAMUserWithKey(**created_user.model_dump(), access_key=created_key)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{user_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> None:
    _ensure_unmanaged_user(db, context, user_name)
    service = get_iam_service_for_context(context)
    try:
        service.delete_user(user_name)
        if context.id is not None:
            AccessKeyMetadataService(db).delete_iam_principal_metadata(context.id, user_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_iam_user",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{user_name}/keys", response_model=list[AccessKey])
def list_access_keys(
    user_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
    db: Session = Depends(get_db),
) -> list[AccessKey]:
    service = get_iam_service_for_context(context)
    try:
        keys = service.list_access_keys(user_name)
        metadata_service = AccessKeyMetadataService(db)
        if context.id is not None:
            metadata_service.apply_metadata(
                keys,
                metadata_service.iam_metadata(context.id, user_name),
                include_labels=metadata_service.metadata_enabled_for_context(context),
            )
        source = iam_source_reference(context)
        if source is not None:
            managed = {
                row.access_key_id: row
                for row in ManagedPrivateAccessService(db).managed_resources_for_source(*source)
                if row.iam_username == user_name and row.access_key_id
            }
            for key in keys:
                provisioning = managed.get(key.access_key_id)
                if provisioning is not None:
                    key.is_private_access_managed = True
                    key.managed_connection_id = provisioning.s3_connection_id
        return keys
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("/{user_name}/keys", response_model=AccessKey, status_code=status.HTTP_201_CREATED)
def create_access_key(
    user_name: str,
    payload: AccessKeyMetadataInput | None = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> AccessKey:
    _ensure_unmanaged_user(db, context, user_name)
    source = iam_source_reference(context)
    if source is not None and ManagedPrivateAccessService(db).managed_iam_user(*source, user_name) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Managed private access IAM users cannot receive keys through the generic endpoint",
        )
    metadata_service = AccessKeyMetadataService(db)
    if payload is not None and payload.model_fields_set:
        if context.id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access-key details are not available for this context")
        try:
            metadata_service.validate_payload(context, payload)
        except PermissionError as exc:
            raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
        except ValueError as exc:
            raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    service = get_iam_service_for_context(context)
    try:
        key = service.create_access_key(user_name)
        if payload is not None and payload.model_fields_set and context.id is not None:
            row = metadata_service.set_iam_metadata(context.id, user_name, key.access_key_id, payload)
            if row is not None:
                metadata_service.apply_metadata([key], {key.access_key_id: row})
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_access_key",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
            metadata={"access_key_id": key.access_key_id},
        )
        return key
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.put("/{user_name}/keys/{access_key_id}/metadata", response_model=AccessKeyMetadata)
def update_access_key_metadata(
    user_name: str,
    access_key_id: str,
    payload: AccessKeyMetadataInput,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> AccessKeyMetadata:
    _ensure_unmanaged_user(db, context, user_name)
    metadata_service = AccessKeyMetadataService(db)
    if context.id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access-key details are not available for this context")
    try:
        metadata_service.validate_payload(context, payload)
    except PermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    service = get_iam_service_for_context(context)
    try:
        if not any(key.access_key_id == access_key_id for key in service.list_access_keys(user_name)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Access key not found")
        row = metadata_service.set_iam_metadata(context.id, user_name, access_key_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_access_key_metadata",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
            metadata={
                "access_key_id": access_key_id,
                "has_name": bool(row and row.name),
                "has_notes": bool(row and row.notes),
                "has_expiration": bool(row and row.expires_at),
            },
        )
        return metadata_service.to_api(row)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.put("/{user_name}/keys/{access_key_id}/status", response_model=AccessKey)
def update_access_key_status(
    user_name: str,
    access_key_id: str,
    payload: AccessKeyStatusChange,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> AccessKey:
    _ensure_unmanaged_user(db, context, user_name)
    source = iam_source_reference(context)
    if source is not None and ManagedPrivateAccessService(db).managed_key(*source, access_key_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This key belongs to a managed private access; update or delete its private connection instead",
        )
    if payload.active and context.id is not None and AccessKeyMetadataService(db).expiration_due(
        account_id=context.id,
        principal_name=user_name,
        access_key_id=access_key_id,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Remove or move the expired access-key expiration before enabling this key",
        )
    service = get_iam_service_for_context(context)
    status_value = "Active" if payload.active else "Inactive"
    try:
        service.update_access_key_status(user_name, access_key_id, status_value)
        updated = next(
            (key for key in service.list_access_keys(user_name) if key.access_key_id == access_key_id),
            None,
        )
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_access_key_status",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
            metadata={"access_key_id": access_key_id, "active": payload.active},
        )
        if updated:
            return updated
        return AccessKey(access_key_id=access_key_id, status=status_value)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{user_name}/keys/{access_key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_access_key(
    user_name: str,
    access_key_id: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> None:
    _ensure_unmanaged_user(db, context, user_name)
    source = iam_source_reference(context)
    if source is not None and ManagedPrivateAccessService(db).managed_key(*source, access_key_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This key belongs to a managed private access; delete its private connection instead",
        )
    service = get_iam_service_for_context(context)
    try:
        service.delete_access_key(user_name, access_key_id)
        if context.id is not None:
            AccessKeyMetadataService(db).delete_iam_metadata(context.id, user_name, access_key_id)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_access_key",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
            metadata={"access_key_id": access_key_id},
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{user_name}/inline-policies", response_model=list[InlinePolicy])
def list_user_inline_policies(
    user_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[InlinePolicy]:
    service = get_iam_service_for_context(context)
    try:
        return load_inline_policies(
            user_name,
            list_names_fn=service.list_user_inline_policies,
            get_policy_fn=service.get_user_inline_policy,
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.put("/{user_name}/inline-policies/{policy_name}", response_model=InlinePolicy)
def put_user_inline_policy(
    user_name: str,
    policy_name: str,
    payload: InlinePolicy,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> InlinePolicy:
    _ensure_unmanaged_user(db, context, user_name)
    validate_inline_policy_request(payload.name, "user", context)
    validate_inline_policy_request(policy_name, "user", context, loc=("path", "policy_name"))
    ensure_inline_policy_name(payload, policy_name)
    service = get_iam_service_for_context(context)
    try:
        saved = save_inline_policy(
            user_name,
            policy_name=policy_name,
            document=payload.document,
            put_policy_fn=service.put_user_inline_policy,
            get_policy_fn=service.get_user_inline_policy,
        )
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="put_user_inline_policy",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
            metadata={"policy_name": policy_name},
        )
        return saved
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{user_name}/inline-policies/{policy_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_inline_policy(
    user_name: str,
    policy_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> None:
    _ensure_unmanaged_user(db, context, user_name)
    service = get_iam_service_for_context(context)
    try:
        service.delete_user_inline_policy(user_name, policy_name)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_user_inline_policy",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
            metadata={"policy_name": policy_name},
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.get("/{user_name}/policies", response_model=list[Policy])
def list_user_policies(
    user_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> list[Policy]:
    service = get_iam_service_for_context(context)
    try:
        return service.list_user_policies(user_name)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.post("/{user_name}/policies", response_model=Policy, status_code=status.HTTP_201_CREATED)
def attach_user_policy(
    user_name: str,
    payload: Policy,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> Policy:
    _ensure_unmanaged_user(db, context, user_name)
    service = get_iam_service_for_context(context)
    try:
        service.attach_user_policy(user_name, payload.arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="attach_user_policy",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
            metadata={"policy_arn": payload.arn},
        )
        return resolve_attached_policy(payload, get_policy_fn=service.get_policy)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


@router.delete("/{user_name}/policies/{policy_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def detach_user_policy(
    user_name: str,
    policy_arn: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(require_iam_capable_manager),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> None:
    _ensure_unmanaged_user(db, context, user_name)
    service = get_iam_service_for_context(context)
    try:
        service.detach_user_policy(user_name, policy_arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="detach_user_policy",
            entity_type="iam_user",
            entity_id=user_name,
            execution_context=context,
            metadata={"policy_arn": policy_arn},
        )
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
