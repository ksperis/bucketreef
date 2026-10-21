# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, Literal, TypeVar

from app.models.access_context import ManagerActor
from app.services import bucket_config_actions
from app.services.audit_service import AuditService
from app.services.bucket_config_mutation_registry import (
    BucketConfigArea,
    get_bucket_config_delete_mutation,
    get_bucket_config_mutation,
)
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.s3_execution_context import S3ExecutionContext

_T = TypeVar("_T")
BucketConfigAuditScope = Literal["browser", "manager"]
BucketConfigCacheInvalidator = Callable[[S3ExecutionContext, str], None]


class BucketConfigMutationService:
    def __init__(
        self,
        *,
        configuration_service: BucketConfigurationService,
        audit_service: AuditService,
        audit_scope: BucketConfigAuditScope,
        cache_invalidator: BucketConfigCacheInvalidator,
    ) -> None:
        self.configuration_service = configuration_service
        self.audit_service = audit_service
        self.audit_scope = audit_scope
        self.cache_invalidator = cache_invalidator

    def _record(
        self,
        *,
        actor: ManagerActor,
        context: S3ExecutionContext,
        bucket_name: str,
        audit_action: str,
        metadata: dict[str, Any] | None,
    ) -> None:
        self.cache_invalidator(context, bucket_name)
        self.audit_service.record_action(
            user=actor,
            scope=self.audit_scope,
            action=audit_action,
            entity_type="bucket",
            entity_id=bucket_name,
            execution_context=context,
            metadata=metadata,
        )

    def update(
        self,
        *,
        actor: ManagerActor,
        context: S3ExecutionContext,
        bucket_name: str,
        config_area: BucketConfigArea,
        **kwargs: Any,
    ) -> _T:
        mutation = get_bucket_config_mutation(config_area)
        return bucket_config_actions.apply_bucket_config_update(
            service=self.configuration_service,
            context=context,
            bucket_name=bucket_name,
            action=mutation.update_action,
            audit_recorder=lambda metadata: self._record(
                actor=actor,
                context=context,
                bucket_name=bucket_name,
                audit_action=mutation.manager_update_audit_action,
                metadata=metadata,
            ),
            **kwargs,
        )

    def delete(
        self,
        *,
        actor: ManagerActor,
        context: S3ExecutionContext,
        bucket_name: str,
        config_area: BucketConfigArea,
        **kwargs: Any,
    ) -> None:
        mutation = get_bucket_config_delete_mutation(config_area)
        assert mutation.delete_action is not None
        assert mutation.manager_delete_audit_action is not None
        bucket_config_actions.apply_bucket_config_delete(
            service=self.configuration_service,
            context=context,
            bucket_name=bucket_name,
            action=mutation.delete_action,
            audit_recorder=lambda _metadata: self._record(
                actor=actor,
                context=context,
                bucket_name=bucket_name,
                audit_action=mutation.manager_delete_audit_action,
                metadata=None,
            ),
            **kwargs,
        )
