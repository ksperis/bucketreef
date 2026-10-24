# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from app.core.domain_errors import ManagerIAMRoleNotFoundError
from app.models.access_context import ManagerActor
from app.models.iam import IAMRole, IAMRoleUpdate
from app.services.audit_service import AuditService
from app.services.rgw_iam import RGWIAMService
from app.services.s3_execution_context import S3ExecutionContext


def _same_policy_document(left: object, right: object) -> bool:
    return json.dumps(left, sort_keys=True, separators=(",", ":")) == json.dumps(
        right,
        sort_keys=True,
        separators=(",", ":"),
    )


def _parse_assume_role_policy(value: object) -> object:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("Assume role policy must be valid JSON") from exc


def update_iam_role(
    service: RGWIAMService,
    role_name: str,
    payload: IAMRoleUpdate,
    *,
    context: S3ExecutionContext,
    current_user: ManagerActor,
    audit_service: AuditService,
) -> IAMRole:
    existing = service.get_role(role_name)
    if existing is None:
        raise ManagerIAMRoleNotFoundError("Role not found")
    if payload.path is not None and payload.path != existing.path:
        raise ValueError(
            "Updating an IAM role path is not supported. Create a new role with the desired path."
        )

    assume_policy = _parse_assume_role_policy(payload.assume_role_policy_document)
    duration_changed = (
        payload.max_session_duration is not None
        and payload.max_session_duration != existing.max_session_duration
    )
    assume_policy_changed = (
        assume_policy is not None
        and not _same_policy_document(assume_policy, existing.assume_role_policy_document)
    )

    if duration_changed:
        service.update_role_max_session_duration(role_name, payload.max_session_duration)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_iam_role",
            entity_type="iam_role",
            entity_id=role_name,
            execution_context=context,
            metadata={"max_session_duration": payload.max_session_duration},
        )
    if assume_policy_changed:
        service.update_role_assume_policy(role_name, assume_policy)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_iam_role",
            entity_type="iam_role",
            entity_id=role_name,
            execution_context=context,
            metadata={"assume_role_policy_updated": True},
        )
    if not duration_changed and not assume_policy_changed:
        return existing

    updated = service.get_role(role_name)
    if updated is None:
        raise RuntimeError("Updated IAM role could not be reloaded")
    return updated
