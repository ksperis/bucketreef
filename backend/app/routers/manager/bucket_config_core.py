# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Core bucket configuration endpoints for the Manager workspace."""

from fastapi import APIRouter, Depends, Response, status

from app.models.access_context import ManagerActor
from app.models.bucket import (
    BucketEncryptionConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketProperties,
    BucketVersioningStatus,
    BucketVersioningUpdate,
)
from app.services.storage_endpoint_feature_guards import require_sse_feature
from app.routers.dependencies import get_s3_execution_context, get_current_account_admin
from app.routers.manager.bucket_config_common import get_manager_bucket_config_mutation_service
from app.services import bucket_config_actions
from app.services.bucket_config_mutation_service import BucketConfigMutationService
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(tags=["manager-buckets"])


@router.get("/{bucket_name}/properties", response_model=BucketProperties)
def bucket_properties(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketProperties:
    return bucket_config_actions.get_bucket_properties_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.get("/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_versioning(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketVersioningStatus:
    return bucket_config_actions.get_bucket_versioning_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put(
    "/{bucket_name}/versioning",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def update_versioning(
    bucket_name: str,
    payload: BucketVersioningUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="versioning",
        payload=payload,
    )


@router.get("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_object_lock(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketObjectLock:
    return bucket_config_actions.get_bucket_object_lock_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_object_lock(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketObjectLock:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="object_lock",
        payload=payload,
    )


@router.get("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketEncryptionConfiguration:
    require_sse_feature(context.storage_endpoint)
    return bucket_config_actions.get_bucket_encryption_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketEncryptionConfiguration:
    require_sse_feature(context.storage_endpoint)
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="encryption",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/encryption",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_bucket_encryption(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    require_sse_feature(context.storage_endpoint)
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="encryption",
    )
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Core bucket configuration endpoints for the Manager workspace."""
