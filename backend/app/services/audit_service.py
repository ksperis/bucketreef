# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from typing import Any, Literal, Optional, Protocol

from sqlalchemy import String, cast, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitize_audit_metadata
from app.db import AuditLog, User
from app.services.access_context_contracts import ManagerActor
from app.models.audit import AuditStatus
from app.services.s3_execution_context import S3ExecutionContext
from app.services.audit_policy import should_persist_audit_action
from app.services.webhook_service import WebhookEventPublisher

logger = logging.getLogger(__name__)

MAX_AUDIT_METADATA_LENGTH = 16384
class AuditAccountSource(Protocol):
    id: int
    name: str


def audit_metadata_object(value: object) -> Optional[dict[str, Any]]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Persisted audit metadata must be a JSON object")
    return value


def _truncate_audit_metadata(serialized: str) -> dict[str, Any]:
    lower = 0
    upper = len(serialized)
    best: dict[str, Any] = {
        "truncated": True,
        "original_length": len(serialized),
        "preview": "",
    }
    while lower <= upper:
        preview_length = (lower + upper) // 2
        candidate = {
            "truncated": True,
            "original_length": len(serialized),
            "preview": serialized[:preview_length],
        }
        if len(json.dumps(candidate)) <= MAX_AUDIT_METADATA_LENGTH:
            best = candidate
            lower = preview_length + 1
        else:
            upper = preview_length - 1
    return best


class AuditService:
    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def _resolve_webhook_account(
        account: Optional[AuditAccountSource],
        execution_context: Optional[S3ExecutionContext],
    ) -> tuple[Optional[int], Optional[str]]:
        if account is not None:
            raw_account_id = account.id
            resolved_account_id = raw_account_id if isinstance(raw_account_id, int) and raw_account_id > 0 else None
            return resolved_account_id, account.name or None
        if execution_context is not None and execution_context.context_kind in {"account", "portal_account"}:
            raw_account_id = execution_context.id
            resolved_account_id = raw_account_id if isinstance(raw_account_id, int) and raw_account_id > 0 else None
            return resolved_account_id, execution_context.name or None
        return None, None

    @staticmethod
    def _resolve_execution_context(
        execution_context: Optional[S3ExecutionContext],
        account: Optional[AuditAccountSource],
        scope: str,
    ) -> tuple[Optional[str], Optional[str], Optional[str]]:
        if execution_context is not None:
            return (
                execution_context.context_kind,
                execution_context.context_id,
                execution_context.name or None,
            )
        if account is not None and isinstance(account.id, int) and account.id > 0:
            return (
                "portal_account" if scope == "portal" else "account",
                str(account.id),
                account.name or None,
            )
        return None, None, None

    def _persist_log(self, payload: AuditLog) -> bool:
        self.db.add(payload)
        try:
            self.db.commit()
        except SQLAlchemyError as exc:
            self.db.rollback()
            logger.warning(
                "Failed to persist audit log for action %s: %s",
                payload.action,
                exc,
            )
            return False
        return True

    def _publish_webhook(
        self,
        payload: AuditLog,
        *,
        account_id: Optional[int],
        account_name: Optional[str],
    ) -> None:
        try:
            WebhookEventPublisher(self.db).publish_audit_event(
                scope=payload.scope,
                action=payload.action,
                user_email=payload.user_email,
                user_role=payload.user_role,
                entity_type=payload.entity_type,
                entity_id=payload.entity_id,
                account_id=account_id,
                account_name=account_name,
                status=payload.status,
                message=payload.message,
                metadata=audit_metadata_object(payload.audit_metadata),
                occurred_at=payload.created_at,
                commit=True,
            )
        except Exception as exc:  # noqa: BLE001
            self.db.rollback()
            logger.warning(
                "Failed to queue webhook for audit action %s: %s",
                payload.action,
                exc,
            )

    def record_action(
        self,
        *,
        user: Optional[ManagerActor],
        scope: str,
        action: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        execution_context: Optional[S3ExecutionContext] = None,
        account: Optional[AuditAccountSource] = None,
        metadata: Optional[dict[str, Any]] = None,
        status: AuditStatus = "success",
        message: Optional[str] = None,
        user_email: Optional[str] = None,
        user_role: Optional[str] = None,
        request_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> None:
        if not should_persist_audit_action(action):
            return

        resolved_account_id, resolved_account_name = self._resolve_webhook_account(
            account,
            execution_context,
        )
        context_kind, context_id, context_name = self._resolve_execution_context(
            execution_context,
            account,
            scope,
        )
        resolved_user_email = user.email if user else (user_email or "unknown")
        resolved_user_role = user.role if user else (user_role or "unknown")
        resolved_user_id = user.id if isinstance(user, User) else None

        payload = AuditLog(
            user_id=resolved_user_id,
            user_email=resolved_user_email,
            user_role=resolved_user_role,
            scope=scope,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            context_kind=context_kind,
            context_id=context_id,
            context_name=context_name,
            status=status,
            message=message,
            audit_metadata=self._prepare_metadata(metadata),
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        if not self._persist_log(payload):
            return

        self._publish_webhook(
            payload,
            account_id=resolved_account_id,
            account_name=resolved_account_name,
        )

    def list_logs(
        self,
        *,
        limit: int = 200,
        scope: Optional[str] = None,
        role: Optional[str] = None,
        context_kind: Optional[str] = None,
        context_id: Optional[str] = None,
        cursor: Optional[int] = None,
        search: Optional[str] = None,
        status: Optional[AuditStatus] = None,
        search_mode: Literal["all", "manager_activity"] = "all",
    ) -> list[AuditLog]:
        statement = select(AuditLog)
        if scope:
            statement = statement.where(AuditLog.scope == scope)
        if role:
            statement = statement.where(AuditLog.user_role == role)
        if context_kind is not None:
            statement = statement.where(AuditLog.context_kind == context_kind)
        if context_id is not None:
            statement = statement.where(AuditLog.context_id == context_id)
        if cursor:
            statement = statement.where(AuditLog.id < cursor)
        if status:
            statement = statement.where(AuditLog.status == status)
        if search:
            trimmed = search.strip()
            if trimmed:
                pattern = f"%{trimmed}%"
                if search_mode == "manager_activity":
                    statement = statement.where(
                        or_(
                            AuditLog.user_email.ilike(pattern),
                            AuditLog.action.ilike(pattern),
                            AuditLog.entity_type.ilike(pattern),
                            AuditLog.entity_id.ilike(pattern),
                            AuditLog.context_name.ilike(pattern),
                        )
                    )
                else:
                    statement = statement.where(
                        or_(
                            AuditLog.user_email.ilike(pattern),
                            AuditLog.user_role.ilike(pattern),
                            AuditLog.scope.ilike(pattern),
                            AuditLog.action.ilike(pattern),
                            AuditLog.entity_type.ilike(pattern),
                            AuditLog.entity_id.ilike(pattern),
                            AuditLog.context_kind.ilike(pattern),
                            AuditLog.context_id.ilike(pattern),
                            AuditLog.context_name.ilike(pattern),
                            AuditLog.status.ilike(pattern),
                            AuditLog.message.ilike(pattern),
                            cast(AuditLog.audit_metadata, String).ilike(pattern),
                        )
                    )
        sliced_limit = min(max(limit, 1), 500)
        return self.db.scalars(
            statement.order_by(AuditLog.id.desc()).limit(sliced_limit)
        ).all()

    def serialize_log(self, log: AuditLog) -> dict[str, Any]:
        return {
            "id": log.id,
            "created_at": log.created_at,
            "user_email": log.user_email,
            "user_role": log.user_role,
            "scope": log.scope,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "context_kind": log.context_kind,
            "context_id": log.context_id,
            "context_name": log.context_name,
            "status": log.status,
            "message": log.message,
            "metadata": audit_metadata_object(log.audit_metadata),
        }

    def _prepare_metadata(
        self,
        metadata: Optional[dict[str, Any]],
    ) -> Optional[dict[str, Any]]:
        if not metadata:
            return None
        sanitized_metadata = sanitize_audit_metadata(metadata)
        try:
            serialized = json.dumps(sanitized_metadata, default=self._fallback_encoder)
        except (TypeError, ValueError):
            serialized = json.dumps({"raw": sanitize_audit_metadata(str(metadata))})
        if len(serialized) > MAX_AUDIT_METADATA_LENGTH:
            return _truncate_audit_metadata(serialized)
        value = json.loads(serialized)
        if not isinstance(value, dict):
            raise ValueError("Audit metadata must be a JSON object")
        return value

    @staticmethod
    def _fallback_encoder(value: Any) -> str:
        return str(value)
