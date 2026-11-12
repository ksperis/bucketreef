# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from collections.abc import Set
from typing import Literal, Optional, Union

from pydantic import Field, model_validator

from app.models.base import ApiModel


UserFilterField = Literal[
    "uid",
    "tenant",
    "account_id",
    "account_name",
    "full_name",
    "email",
    "suspended",
    "max_buckets",
    "quota_max_size_bytes",
    "quota_max_objects",
    "quota_usage_size_percent",
    "quota_usage_object_percent",
]
AccountFilterField = Literal[
    "account_id",
    "account_name",
    "email",
    "max_users",
    "max_buckets",
    "quota_max_size_bytes",
    "quota_max_objects",
    "quota_usage_size_percent",
    "quota_usage_object_percent",
    "bucket_count",
    "user_count",
]
CephAdminFilterMatch = Literal["all", "any"]
CephAdminFilterOp = Literal[
    "eq",
    "neq",
    "contains",
    "starts_with",
    "ends_with",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "not_in",
    "is_null",
    "not_null",
]
CephAdminFilterValue = Union[
    str,
    int,
    float,
    bool,
    list[str],
    list[int],
    list[float],
    list[bool],
]
USER_TEXT_FILTER_FIELDS: frozenset[UserFilterField] = frozenset(
    {"uid", "tenant", "account_id", "account_name", "full_name", "email"}
)
USER_BOOLEAN_FILTER_FIELDS: frozenset[UserFilterField] = frozenset({"suspended"})
USER_NUMERIC_FILTER_FIELDS: frozenset[UserFilterField] = frozenset(
    {
        "max_buckets",
        "quota_max_size_bytes",
        "quota_max_objects",
        "quota_usage_size_percent",
        "quota_usage_object_percent",
    }
)
ACCOUNT_TEXT_FILTER_FIELDS: frozenset[AccountFilterField] = frozenset(
    {"account_id", "account_name", "email"}
)
ACCOUNT_NUMERIC_FILTER_FIELDS: frozenset[AccountFilterField] = frozenset(
    {
        "max_users",
        "max_buckets",
        "quota_max_size_bytes",
        "quota_max_objects",
        "quota_usage_size_percent",
        "quota_usage_object_percent",
        "bucket_count",
        "user_count",
    }
)
CEPH_ADMIN_TEXT_FILTER_OPS: frozenset[CephAdminFilterOp] = frozenset(
    {"eq", "neq", "contains", "starts_with", "ends_with", "in", "not_in", "is_null", "not_null"}
)
CEPH_ADMIN_BOOLEAN_FILTER_OPS: frozenset[CephAdminFilterOp] = frozenset(
    {"eq", "neq", "in", "not_in", "is_null", "not_null"}
)
CEPH_ADMIN_NUMERIC_FILTER_OPS: frozenset[CephAdminFilterOp] = frozenset(
    {"eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "is_null", "not_null"}
)


def _validate_filter_rule(
    field: str,
    op: CephAdminFilterOp,
    value: Optional[CephAdminFilterValue],
    *,
    subject: str,
    text_fields: Set[str],
    numeric_fields: Set[str],
    boolean_fields: Set[str] = frozenset(),
) -> None:
    if field in text_fields:
        allowed_ops = CEPH_ADMIN_TEXT_FILTER_OPS
    elif field in boolean_fields:
        allowed_ops = CEPH_ADMIN_BOOLEAN_FILTER_OPS
    elif field in numeric_fields:
        allowed_ops = CEPH_ADMIN_NUMERIC_FILTER_OPS
    else:
        raise ValueError(f"{subject} field '{field}' has no filter contract.")
    if op not in allowed_ops:
        raise ValueError(f"{subject} field '{field}' does not support op '{op}'.")
    if op in {"is_null", "not_null"}:
        if value is not None:
            raise ValueError(f"{subject} null-check filter rule does not accept value.")
        return
    if value is None:
        raise ValueError(f"{subject} filter rule requires value.")
    if op in {"in", "not_in"}:
        if not isinstance(value, list):
            raise ValueError(f"{subject} in/not_in filter rule requires a list value.")
    elif isinstance(value, list):
        raise ValueError(f"{subject} scalar filter rule does not accept a list value.")


class CephAdminUserFilterRule(ApiModel):
    field: UserFilterField
    op: CephAdminFilterOp
    value: Optional[CephAdminFilterValue] = None

    @model_validator(mode="after")
    def validate_rule(self):
        _validate_filter_rule(
            self.field,
            self.op,
            self.value,
            subject="User",
            text_fields=USER_TEXT_FILTER_FIELDS,
            numeric_fields=USER_NUMERIC_FILTER_FIELDS,
            boolean_fields=USER_BOOLEAN_FILTER_FIELDS,
        )
        return self


class CephAdminUserFilterQuery(ApiModel):
    match: CephAdminFilterMatch = "all"
    rules: list[CephAdminUserFilterRule] = Field(default_factory=list)


class CephAdminAccountFilterRule(ApiModel):
    field: AccountFilterField
    op: CephAdminFilterOp
    value: Optional[CephAdminFilterValue] = None

    @model_validator(mode="after")
    def validate_rule(self):
        _validate_filter_rule(
            self.field,
            self.op,
            self.value,
            subject="Account",
            text_fields=ACCOUNT_TEXT_FILTER_FIELDS,
            numeric_fields=ACCOUNT_NUMERIC_FILTER_FIELDS,
        )
        return self


class CephAdminAccountFilterQuery(ApiModel):
    match: CephAdminFilterMatch = "all"
    rules: list[CephAdminAccountFilterRule] = Field(default_factory=list)
