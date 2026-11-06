# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import NoReturn

from fastapi.exceptions import RequestValidationError

from app.core.domain_errors import ResourceNameValidationError
from app.services.resource_name_validation import (
    validate_inline_policy_request as validate_inline_policy_request_service,
    validate_inline_policy_requests as validate_inline_policy_requests_service,
    validate_topic_request as validate_topic_request_service,
)
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.resource_names import IAMEntity


def raise_resource_name_validation_error(exc: ResourceNameValidationError) -> NoReturn:
    raise RequestValidationError(
        [{"type": "value_error", "loc": exc.loc, "msg": str(exc)}]
    ) from exc


def validate_inline_policy_request(
    name: str,
    entity: IAMEntity,
    context: S3ExecutionTarget,
    *,
    loc: tuple = ("body", "name"),
) -> None:
    try:
        validate_inline_policy_request_service(name, entity, context, loc=loc)
    except ResourceNameValidationError as exc:
        raise_resource_name_validation_error(exc)


def validate_inline_policy_requests(
    policies: list,
    entity: IAMEntity,
    context: S3ExecutionTarget,
) -> None:
    try:
        validate_inline_policy_requests_service(policies, entity, context)
    except ResourceNameValidationError as exc:
        raise_resource_name_validation_error(exc)


def validate_topic_request(
    name: str,
    configuration: dict | None,
    context: S3ExecutionTarget,
) -> None:
    try:
        validate_topic_request_service(name, configuration, context)
    except ResourceNameValidationError as exc:
        raise_resource_name_validation_error(exc)
