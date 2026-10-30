# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
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


def _validate_filter_rule_value(
    op: CephAdminFilterOp,
    value: Optional[CephAdminFilterValue],
    *,
    subject: str,
) -> None:
    if op not in ("is_null", "not_null") and value is None:
        raise ValueError(f"{subject} filter rule requires value.")


class CephAdminUserFilterRule(ApiModel):
    field: UserFilterField
    op: CephAdminFilterOp
    value: Optional[CephAdminFilterValue] = None

    @model_validator(mode="after")
    def validate_rule(self):
        _validate_filter_rule_value(self.op, self.value, subject="User")
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
        _validate_filter_rule_value(self.op, self.value, subject="Account")
        return self


class CephAdminAccountFilterQuery(ApiModel):
    match: CephAdminFilterMatch = "all"
    rules: list[CephAdminAccountFilterRule] = Field(default_factory=list)
