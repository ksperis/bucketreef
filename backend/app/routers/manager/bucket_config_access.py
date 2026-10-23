# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket access configuration endpoints for the Manager workspace."""

from fastapi import APIRouter, Depends, Response, status

from app.models.access_context import ManagerActor
from app.models.bucket import (
    BucketAcl,
    BucketAclUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketPublicAccessBlock,
)
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


@router.get("/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_policy(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketPolicyOut:
    return bucket_config_actions.get_bucket_policy_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.get("/{bucket_name}/acl", response_model=BucketAcl)
def get_acl(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketAcl:
    return bucket_config_actions.get_bucket_acl_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/acl", response_model=BucketAcl)
def put_acl(
    bucket_name: str,
    payload: BucketAclUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketAcl:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="acl",
        payload=payload,
    )


@router.get("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_public_access_block(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketPublicAccessBlock:
    return bucket_config_actions.get_bucket_public_access_block_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def put_public_access_block(
    bucket_name: str,
    payload: BucketPublicAccessBlock,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketPublicAccessBlock:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="public_access_block",
        payload=payload,
    )


@router.put("/{bucket_name}/policy", response_model=BucketPolicyOut)
def put_policy(
    bucket_name: str,
    payload: BucketPolicyIn,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketPolicyOut:
    return mutation.update(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="policy",
        payload=payload,
    )


@router.delete(
    "/{bucket_name}/policy",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_policy(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> Response:
    return mutation.delete(
        actor=current_user,
        context=context,
        bucket_name=bucket_name,
        config_area="policy",
    )
