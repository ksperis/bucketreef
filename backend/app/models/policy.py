# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional
from pydantic import field_validator

from app.models.base import ApiModel
from app.utils.resource_names import validate_iam_name


class Policy(ApiModel):
    name: str
    arn: str
    path: Optional[str] = None
    default_version_id: Optional[str] = None
    document: Optional[dict] = None


class PolicyCreate(ApiModel):
    name: str
    document: dict

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return validate_iam_name(value, "policy")


class InlinePolicy(ApiModel):
    name: str
    document: dict
