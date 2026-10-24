# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Write-side naming contracts. Never apply these to externally stored read models."""
from __future__ import annotations

import re
from typing import Literal

NamingValidationProfile = Literal["ceph", "standard"]
IAMEntity = Literal["user", "group", "role", "policy"]

_RESERVED_S3_BUCKET_PREFIXES = ("xn--", "sthree-", "amzn-s3-demo-")
_RESERVED_S3_BUCKET_SUFFIXES = (
    "-s3alias",
    "--ol-s3",
    ".mrap",
    "--x-s3",
    "--table-s3",
)


def validate_s3_bucket_name(name: str) -> str:
    if (
        not 3 <= len(name) <= 63
        or not re.fullmatch(r"[a-z0-9][a-z0-9.-]*[a-z0-9]", name)
        or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label) for label in name.split("."))
        or re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{1,3}){3}", name)
        or name.startswith(_RESERVED_S3_BUCKET_PREFIXES)
        or name.endswith(_RESERVED_S3_BUCKET_SUFFIXES)
    ):
        raise ValueError("Invalid bucket name. Use 3–63 lowercase letters, digits, dots or hyphens in DNS-compatible form.")
    return name


def validate_iam_name(name: str, entity: IAMEntity) -> str:
    limit = 64 if entity in ("user", "role") else 128
    if not name or len(name) > limit or not re.fullmatch(r"[A-Za-z0-9_+=,.@-]+", name):
        raise ValueError(f"IAM {entity} name must contain 1–{limit} ASCII letters, digits or _+=,.@-.")
    return name


def validate_inline_policy_name(
    name: str, entity: IAMEntity, profile: NamingValidationProfile,
) -> str:
    # Tentacle uses distinct validators for PutUser/GroupPolicy and PutRolePolicy.
    if profile == "ceph":
        if entity == "role":
            if not name:
                raise ValueError("Inline policy name is required.")
            return name
        if not name or len(name) > 128 or not re.fullmatch(r"[A-Za-z0-9:=,.@-]+", name):
            raise ValueError("Ceph inline policy name must contain 1–128 ASCII letters, digits or :=,.@-.")
        return name
    return validate_iam_name(name, "policy")


def validate_topic_name(name: str, *, provider: str | None = None, configuration: dict | None = None) -> str:
    fifo_value = (configuration or {}).get("FifoTopic", False)
    if not (isinstance(fifo_value, bool) or isinstance(fifo_value, str) and fifo_value in ("true", "false")):
        raise ValueError("FifoTopic must be true or false.")
    fifo = fifo_value is True or fifo_value == "true"
    base = name
    if fifo:
        if provider != "aws" or not name.endswith(".fifo"):
            raise ValueError("AWS FIFO topic names must end with '.fifo' and require FifoTopic=true.")
        base = name[:-5]
    if not base or len(name) > 256 or not re.fullmatch(r"[A-Za-z0-9_-]+", base):
        raise ValueError("Topic name must contain 1–256 ASCII letters, digits, underscores or hyphens.")
    return name
