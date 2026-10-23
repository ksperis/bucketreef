# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, status

from app.models.access_context import ManagerActor
from app.services.s3_execution_context import S3ExecutionContext
from app.models.topic import Topic, TopicConfiguration, TopicCreate, TopicPolicy
from app.routers.dependencies import (
    get_s3_execution_context,
    get_audit_service,
    get_current_account_admin,
    require_sns_capable_manager,
)
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_bad_request_from_value_error
from app.services.audit_service import AuditService
from app.services.resource_name_validation import validate_topic_request
from app.services.topics_service import TopicsService, get_topics_service

router = APIRouter(prefix="/manager/topics", tags=["manager-topics"])


@router.get("", response_model=list[Topic])
def list_topics(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: TopicsService = Depends(get_topics_service),
    _sns_guard: ManagerActor = Depends(require_sns_capable_manager),
    _actor: ManagerActor = Depends(get_current_account_admin),
) -> list[Topic]:
    try:
        return service.list_topics(context)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("", response_model=Topic, status_code=status.HTTP_201_CREATED)
def create_topic(
    payload: TopicCreate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: TopicsService = Depends(get_topics_service),
    _: ManagerActor = Depends(require_sns_capable_manager),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> Topic:
    validate_topic_request(payload.name, payload.configuration, context)
    try:
        topic = service.create_topic(
            context,
            payload.name,
            configuration=payload.configuration,
        )
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_topic",
            entity_type="sns_topic",
            entity_id=topic.arn,
            execution_context=context,
            metadata={
                "name": payload.name,
                "configuration_keys": sorted((payload.configuration or {}).keys()),
            },
        )
        return topic
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.delete("/{topic_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def delete_topic(
    topic_arn: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: TopicsService = Depends(get_topics_service),
    _: ManagerActor = Depends(require_sns_capable_manager),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    try:
        service.delete_topic(context, topic_arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_topic",
            entity_type="sns_topic",
            entity_id=topic_arn,
            execution_context=context,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{topic_arn:path}/policy", response_model=TopicPolicy)
def get_topic_policy(
    topic_arn: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: TopicsService = Depends(get_topics_service),
    _sns_guard: ManagerActor = Depends(require_sns_capable_manager),
    _actor: ManagerActor = Depends(get_current_account_admin),
) -> TopicPolicy:
    try:
        policy = service.get_topic_policy(context, topic_arn)
        return TopicPolicy(policy=policy or {})
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/{topic_arn:path}/policy", response_model=TopicPolicy)
def put_topic_policy(
    topic_arn: str,
    payload: TopicPolicy,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: TopicsService = Depends(get_topics_service),
    _: ManagerActor = Depends(require_sns_capable_manager),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> TopicPolicy:
    try:
        updated = service.set_topic_policy(context, topic_arn, payload.policy)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_topic_policy",
            entity_type="sns_topic",
            entity_id=topic_arn,
            execution_context=context,
            metadata={"policy_length": len(payload.policy)},
        )
        return TopicPolicy(policy=updated)
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{topic_arn:path}/configuration", response_model=TopicConfiguration)
def get_topic_configuration(
    topic_arn: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: TopicsService = Depends(get_topics_service),
    _sns_guard: ManagerActor = Depends(require_sns_capable_manager),
    _actor: ManagerActor = Depends(get_current_account_admin),
) -> TopicConfiguration:
    try:
        configuration = service.get_topic_configuration(context, topic_arn)
        return TopicConfiguration(configuration=configuration)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/{topic_arn:path}/configuration", response_model=TopicConfiguration)
def put_topic_configuration(
    topic_arn: str,
    payload: TopicConfiguration,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: TopicsService = Depends(get_topics_service),
    _: ManagerActor = Depends(require_sns_capable_manager),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> TopicConfiguration:
    try:
        updated = service.set_topic_configuration(context, topic_arn, payload.configuration)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_topic_configuration",
            entity_type="sns_topic",
            entity_id=topic_arn,
            execution_context=context,
            metadata={"configuration_keys": sorted(updated.keys())},
        )
        return TopicConfiguration(configuration=updated)
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
