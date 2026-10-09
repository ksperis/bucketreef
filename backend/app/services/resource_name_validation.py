# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi.exceptions import RequestValidationError

from app.utils.resource_names import IAMEntity, NamingValidationProfile, validate_inline_policy_name, validate_topic_name
from app.utils.s3_connection_endpoint import resolve_connection_details


def execution_context_provider(account: object) -> str | None:
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is not None:
        return endpoint.provider
    connection = getattr(account, "source_connection", None)
    if connection is not None:
        return resolve_connection_details(connection).provider
    return None


def naming_validation_profile(account: object) -> NamingValidationProfile:
    return "ceph" if execution_context_provider(account) == "ceph" else "standard"


def validate_inline_policy_request(name: str, entity: IAMEntity, account: object, *, loc: tuple = ("body", "name")) -> None:
    try:
        validate_inline_policy_name(name, entity, naming_validation_profile(account))
    except ValueError as exc:
        raise RequestValidationError([{"type": "value_error", "loc": loc, "msg": str(exc)}]) from exc


def validate_inline_policy_requests(policies: list | None, entity: IAMEntity, account: object) -> None:
    for index, policy in enumerate(policies or []):
        validate_inline_policy_request(policy.name, entity, account, loc=("body", "inline_policies", index, "name"))


def validate_topic_request(name: str, configuration: dict | None, account: object) -> None:
    try:
        validate_topic_name(name, provider=execution_context_provider(account), configuration=configuration)
    except ValueError as exc:
        raise RequestValidationError([{"type": "value_error", "loc": ("body", "name"), "msg": str(exc)}]) from exc
