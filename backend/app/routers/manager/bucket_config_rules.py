# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket rule configuration endpoints for the Manager workspace."""

from fastapi import APIRouter, Depends, Response, status

from app.models.access_context import ManagerActor
from app.models.bucket import (
    BucketCors,
    BucketCorsUpdate,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketReplicationConfiguration,
    BucketTags,
    BucketTagsUpdate,
    BucketWebsiteConfiguration,
)
from app.services.storage_endpoint_feature_guards import require_replication_feature
from app.routers.dependencies import get_s3_execution_context, get_current_account_admin
from app.routers.manager.bucket_config_core import get_manager_bucket_config_mutation_service
from app.services import bucket_config_actions
from app.services.bucket_config_mutation_service import BucketConfigMutationService
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(tags=["manager-buckets"])


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketLifecycleConfig:
    return bucket_config_actions.get_bucket_lifecycle_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_lifecycle(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketLifecycleConfig:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="lifecycle",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/lifecycle",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_lifecycle(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="lifecycle",
    )


@router.get("/{bucket_name}/cors", response_model=BucketCors)
def get_cors(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketCors:
    return bucket_config_actions.get_bucket_cors_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/cors", response_model=BucketCors)
def put_cors(
    bucket_name: str,
    payload: BucketCorsUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketCors:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="cors",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/cors",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_cors(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="cors",
    )


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketNotificationConfiguration:
    return bucket_config_actions.get_bucket_notifications_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_notifications(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketNotificationConfiguration:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="notifications",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/notifications",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_notifications(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="notifications",
    )


@router.get("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_replication(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketReplicationConfiguration:
    require_replication_feature(context.storage_endpoint)
    return bucket_config_actions.get_bucket_replication_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_replication(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketReplicationConfiguration:
    require_replication_feature(context.storage_endpoint)
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="replication",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/replication",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_replication(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    require_replication_feature(context.storage_endpoint)
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="replication",
    )


@router.get("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_logging(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketLoggingConfiguration:
    return bucket_config_actions.get_bucket_logging_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_logging(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketLoggingConfiguration:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="logging",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/logging",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_logging(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="logging",
    )


@router.get("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_website(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketWebsiteConfiguration:
    return bucket_config_actions.get_bucket_website_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_website(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketWebsiteConfiguration:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="website",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/website",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_website(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="website",
    )


@router.get("/{bucket_name}/tags", response_model=BucketTags)
def get_tags(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketTags:
    return bucket_config_actions.get_bucket_tags_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/tags", response_model=BucketTags)
def put_tags(
    bucket_name: str,
    payload: BucketTagsUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketTags:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="tags",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/tags",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_tags(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="tags",
    )
