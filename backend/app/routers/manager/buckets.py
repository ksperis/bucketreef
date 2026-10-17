# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from functools import partial

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import User
from app.models.access_context import ManagerActor
from app.models.bucket import Bucket, BucketCreate, BucketQuotaUpdate
from app.models.manager_bucket_compare import (
    ManagerBucketCompareActionRequest,
    ManagerBucketCompareActionResult,
    ManagerBucketCompareRequest,
    ManagerBucketCompareResult,
)
from app.models.bucket_purge import (
    BucketDeleteWithPurgeRequest,
    BucketPurgeResult,
    bucket_delete_with_purge_confirmation_phrase,
)
from app.routers.bucket_purge_stream import stream_bucket_purge
from app.services.bucket_purge_audit import (
    BucketPurgeAuditLifecycle,
    record_bucket_purge_audit,
)
from app.routers.manager import bucket_config
from app.services.audit_service import AuditService
from app.services.bucket_comparison_service import (
    BucketComparisonService,
    get_bucket_comparison_service,
)
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.s3_execution_context import S3ExecutionContext
from app.services import bucket_config_actions
from app.services.bucket_purge_service import (
    BucketPurgeOptions,
    BucketPurgeResolvedTarget,
    BucketPurgeService,
)
from app.services.bucket_listing_cache import (
    get_cached_bucket_listing_for_context,
    invalidate_bucket_listing_cache_for_context,
)
from app.services.bucket_listing_shared import parse_includes
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.storage_ops_bucket_listing_service import resolve_storage_ops_context_tenant
from app.services.manager_bucket_compare_service import (
    InvalidManagerBucketComparisonError,
    compare_manager_buckets,
    remediate_manager_bucket_comparison,
)
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_bad_request_from_value_error
from app.routers.manager.access import require_bucket_management_context
from app.routers.dependencies import (
    get_s3_execution_context,
    get_audit_service,
    get_current_account_admin,
    get_current_user,
    require_bucket_compare_enabled,
    require_bucket_purge_enabled,
    require_manager_bucket_quota,
)

router = APIRouter(prefix="/manager/buckets", tags=["manager-buckets"])
router.include_router(bucket_config.router)
logger = logging.getLogger(__name__)


def _invalidate_bucket_listing_for_context(context: S3ExecutionContext) -> None:
    invalidate_bucket_listing_cache_for_context(context)


@router.get("", response_model=list[Bucket])
def list_buckets(
    include: list[str] = Query(default=[], description="Optional extra fields to include (e.g. tags, versioning, cors)"),
    with_stats: bool = Query(True, description="Include usage/quota stats from admin listing"),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> list[Bucket]:
    try:
        include_set = parse_includes(include)
        return get_cached_bucket_listing_for_context(
            context=context,
            include=include_set,
            with_stats=with_stats,
            builder=lambda: service.list_buckets(context, include=include_set, with_stats=with_stats),
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{bucket_name}/stats", response_model=Bucket)
def get_bucket_stats(
    bucket_name: str,
    with_stats: bool = Query(True, description="Include usage/quota stats when available"),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> Bucket:
    try:
        return service.get_bucket_stats(bucket_name, context, with_stats=with_stats)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/{bucket_name}/quota", status_code=status.HTTP_200_OK)
def update_quota(
    bucket_name: str,
    payload: BucketQuotaUpdate,
    context: S3ExecutionContext = Depends(require_manager_bucket_quota),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, str]:
    response, audit_metadata = bucket_config_actions.update_bucket_quota_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_context(context)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_quota",
        entity_type="bucket",
        entity_id=bucket_name,
        execution_context=context,
        metadata=audit_metadata,
    )
    return response


@router.post("/compare", response_model=ManagerBucketCompareResult)
def compare_bucket_pair(
    payload: ManagerBucketCompareRequest,
    request: Request,
    db: Session = Depends(get_db),
    _tool_user: User = Depends(require_bucket_compare_enabled),
    source_context: S3ExecutionContext = Depends(get_s3_execution_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    service: BucketComparisonService = Depends(get_bucket_comparison_service),
) -> ManagerBucketCompareResult:
    target_context = get_s3_execution_context(
        request=request,
        context_ref=payload.target_context_id,
        actor=actor,
        db=db,
    )

    try:
        return compare_manager_buckets(
            service=service,
            payload=payload,
            source_context=source_context,
            target_context=target_context,
        )
    except InvalidManagerBucketComparisonError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/compare/action", response_model=ManagerBucketCompareActionResult)
def run_compare_bucket_action(
    payload: ManagerBucketCompareActionRequest,
    request: Request,
    db: Session = Depends(get_db),
    _tool_user: User = Depends(require_bucket_compare_enabled),
    source_context: S3ExecutionContext = Depends(get_s3_execution_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    service: BucketComparisonService = Depends(get_bucket_comparison_service),
    audit_service: AuditService = Depends(get_audit_service),
) -> ManagerBucketCompareActionResult:
    target_context = get_s3_execution_context(
        request=request,
        context_ref=payload.target_context_id,
        actor=actor,
        db=db,
    )

    try:
        outcome = remediate_manager_bucket_comparison(
            service=service,
            payload=payload,
            source_context=source_context,
            target_context=target_context,
        )
    except InvalidManagerBucketComparisonError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)

    _invalidate_bucket_listing_for_context(source_context)
    _invalidate_bucket_listing_for_context(target_context)
    audit_service.record_action(
        user=actor,
        scope="manager",
        action="bucket_compare_remediation",
        entity_type="bucket",
        entity_id=payload.target_bucket,
        execution_context=source_context,
        metadata=outcome.audit_metadata,
    )
    return outcome.result




@router.post("", status_code=status.HTTP_201_CREATED)
def create_bucket(
    payload: BucketCreate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    response, audit_metadata = bucket_config_actions.create_bucket_config(
        service=service,
        context=context,
        payload=payload,
    )
    _invalidate_bucket_listing_for_context(context)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="create_bucket",
        entity_type="bucket",
        entity_id=payload.name,
        execution_context=context,
        metadata=audit_metadata,
    )
    return response


@router.delete("/{bucket_name}")
def delete_bucket(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    response, _audit_metadata = bucket_config_actions.delete_bucket_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_context(context)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket",
        entity_type="bucket",
        entity_id=bucket_name,
        execution_context=context,
    )
    endpoint_id = int(context.storage_endpoint_id or 0)
    if endpoint_id > 0:
        tag_service = BucketUiTagsService(audit_service.db)
        with tag_service.transaction():
            tag_service.remove_all_namespaces_for_bucket(
                PhysicalBucketTarget.create(
                    endpoint_id,
                    resolve_storage_ops_context_tenant(context),
                    bucket_name,
                )
            )
    return response


@router.post("/{bucket_name}/delete/stream")
def stream_delete_bucket_with_purge(
    bucket_name: str,
    payload: BucketDeleteWithPurgeRequest,
    request: Request,
    tool_user: User = Depends(require_bucket_purge_enabled),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> StreamingResponse:
    expected = bucket_delete_with_purge_confirmation_phrase(bucket_name)
    if (payload.confirmation or "").strip() != expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Confirmation must be exactly '{expected}'.")
    require_bucket_management_context(context)
    options = BucketPurgeOptions(parallelism=payload.parallelism, include_versions=True)
    target = BucketPurgeResolvedTarget(
        context=context,
        bucket_name=bucket_name,
        context_id=context.context_id,
        context_name=context.name,
    )
    service = BucketPurgeService()
    base_metadata = {
        "bucket_name": bucket_name,
        "context_id": context.context_id,
        "parallelism": options.parallelism,
        "include_versions": True,
        "confirmation": "matched",
    }
    endpoint_id = int(context.storage_endpoint_id or 0)
    deleted_bucket_target = (
        PhysicalBucketTarget.create(
            endpoint_id,
            resolve_storage_ops_context_tenant(context),
            bucket_name,
        )
        if endpoint_id > 0
        else None
    )

    def after_result(result: BucketPurgeResult) -> None:
        if result.bucket_deleted:
            _invalidate_bucket_listing_for_context(context)
            if deleted_bucket_target is not None:
                cleanup_db = SessionLocal()
                try:
                    tag_service = BucketUiTagsService(cleanup_db)
                    with tag_service.transaction():
                        tag_service.remove_all_namespaces_for_bucket(deleted_bucket_target)
                finally:
                    cleanup_db.close()

    def result_succeeded(result: BucketPurgeResult) -> bool:
        return result.status == "completed" and result.bucket_deleted

    def result_metadata(result: BucketPurgeResult) -> dict[str, object]:
        return {
            "result_status": result.status,
            "listed_objects": result.listed_objects,
            "listed_versions": result.listed_versions,
            "deleted_objects": result.deleted_objects,
            "deleted_versions": result.deleted_versions,
            "failed_count": result.failed_count,
            "bucket_deleted": result.bucket_deleted,
        }

    audit = BucketPurgeAuditLifecycle(
        record=partial(
            record_bucket_purge_audit,
            user_id=int(tool_user.id),
            user_email=str(tool_user.email),
            user_role=str(tool_user.role),
            scope="manager",
            entity_type="bucket",
            entity_id=bucket_name,
            execution_context=context,
        ),
        base_metadata=base_metadata,
        start_action="start_bucket_delete_with_purge",
        result_action="finish_bucket_delete_with_purge",
        cancel_action="cancel_bucket_delete_with_purge",
        error_action="fail_bucket_delete_with_purge",
        cancel_message="Bucket deletion canceled",
        result_failure_action="fail_bucket_delete_with_purge",
        result_succeeded=result_succeeded,
        result_metadata=result_metadata,
        after_result=after_result,
    )

    return stream_bucket_purge(
        request,
        run_purge=lambda progress_callback, cancel_check: service.run_delete_bucket_with_purge(
            target,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Manager bucket deletion failed.",
        on_start=audit.on_start,
        on_result=audit.on_result,
        on_cancel=audit.on_cancel,
        on_error=audit.on_error,
    )
