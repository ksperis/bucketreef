# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from dataclasses import dataclass
from typing import Any, Optional, Protocol

from app.models.bucket import BucketLoggingConfiguration, BucketProperties, BucketTag
from app.models.bucket_compare import BucketConfigDiff, BucketConfigDiffSection
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.jsonable import model_to_jsonable


class BucketConfigurationReader(Protocol):
    def get_bucket_properties(self, name: str, execution_context: S3ExecutionTarget) -> BucketProperties: ...

    def get_policy(self, name: str, execution_context: S3ExecutionTarget) -> Optional[dict]: ...

    def get_bucket_logging(self, name: str, execution_context: S3ExecutionTarget) -> BucketLoggingConfiguration: ...

    def get_bucket_tags(self, name: str, execution_context: S3ExecutionTarget) -> list[BucketTag]: ...


_ALLOWED_SECTION_KEYS = frozenset(
    {
        "versioning_status",
        "object_lock",
        "public_access_block",
        "lifecycle_rules",
        "cors_rules",
        "bucket_policy",
        "access_logging",
        "tags",
    }
)
_PROPERTY_SECTION_KEYS = frozenset(
    {"versioning_status", "object_lock", "public_access_block", "lifecycle_rules", "cors_rules"}
)


@dataclass(frozen=True)
class _ConfigurationValues:
    source_properties: Optional[BucketProperties] = None
    target_properties: Optional[BucketProperties] = None
    source_policy: Optional[dict] = None
    target_policy: Optional[dict] = None
    source_logging: Any = None
    target_logging: Any = None
    source_tags: tuple[dict[str, str], ...] = ()
    target_tags: tuple[dict[str, str], ...] = ()


def _selected_sections(include_sections: Optional[set[str]]) -> set[str]:
    if include_sections is None:
        return set(_ALLOWED_SECTION_KEYS)
    return {key for key in include_sections if key in _ALLOWED_SECTION_KEYS}


def _read_configuration_values(
    reader: BucketConfigurationReader,
    source_bucket: str,
    source_context: S3ExecutionTarget,
    target_bucket: str,
    target_context: S3ExecutionTarget,
    selected_sections: set[str],
) -> _ConfigurationValues:
    source_properties: Optional[BucketProperties] = None
    target_properties: Optional[BucketProperties] = None
    if selected_sections & _PROPERTY_SECTION_KEYS:
        source_properties = reader.get_bucket_properties(source_bucket, source_context)
        target_properties = reader.get_bucket_properties(target_bucket, target_context)

    source_policy: Optional[dict] = None
    target_policy: Optional[dict] = None
    if "bucket_policy" in selected_sections:
        source_policy = reader.get_policy(source_bucket, source_context)
        target_policy = reader.get_policy(target_bucket, target_context)

    source_logging: Any = None
    target_logging: Any = None
    if "access_logging" in selected_sections:
        source_logging = model_to_jsonable(reader.get_bucket_logging(source_bucket, source_context))
        target_logging = model_to_jsonable(reader.get_bucket_logging(target_bucket, target_context))

    source_tags: tuple[dict[str, str], ...] = ()
    target_tags: tuple[dict[str, str], ...] = ()
    if "tags" in selected_sections:
        source_tags = tuple(_normalize_tags(reader.get_bucket_tags(source_bucket, source_context)))
        target_tags = tuple(_normalize_tags(reader.get_bucket_tags(target_bucket, target_context)))

    return _ConfigurationValues(
        source_properties=source_properties,
        target_properties=target_properties,
        source_policy=source_policy,
        target_policy=target_policy,
        source_logging=source_logging,
        target_logging=target_logging,
        source_tags=source_tags,
        target_tags=target_tags,
    )


def _configuration_sections(
    selected_sections: set[str],
    values: _ConfigurationValues,
) -> list[tuple[str, str, Any, Any]]:
    source_properties = values.source_properties
    target_properties = values.target_properties
    sections: list[tuple[str, str, Any, Any]] = []
    if selected_sections & _PROPERTY_SECTION_KEYS:
        assert source_properties is not None
        assert target_properties is not None
    if "versioning_status" in selected_sections:
        sections.append(
            ("versioning_status", "Versioning", source_properties.versioning_status, target_properties.versioning_status)
        )
    if "object_lock" in selected_sections:
        sections.append(
            (
                "object_lock",
                "Object lock",
                model_to_jsonable(source_properties.object_lock),
                model_to_jsonable(target_properties.object_lock),
            )
        )
    if "public_access_block" in selected_sections:
        sections.append(
            (
                "public_access_block",
                "Public access block",
                model_to_jsonable(source_properties.public_access_block),
                model_to_jsonable(target_properties.public_access_block),
            )
        )
    if "lifecycle_rules" in selected_sections:
        sections.append(
            (
                "lifecycle_rules",
                "Lifecycle rules",
                [model_to_jsonable(rule) for rule in source_properties.lifecycle_rules],
                [model_to_jsonable(rule) for rule in target_properties.lifecycle_rules],
            )
        )
    if "cors_rules" in selected_sections:
        sections.append(
            ("cors_rules", "CORS rules", source_properties.cors_rules or [], target_properties.cors_rules or [])
        )
    if "bucket_policy" in selected_sections:
        sections.append(("bucket_policy", "Bucket policy", values.source_policy, values.target_policy))
    if "access_logging" in selected_sections:
        sections.append(("access_logging", "Access logging", values.source_logging, values.target_logging))
    if "tags" in selected_sections:
        sections.append(("tags", "Tags", list(values.source_tags), list(values.target_tags)))
    return sections


def _build_configuration_diff(sections_data: list[tuple[str, str, Any, Any]]) -> BucketConfigDiff:
    sections: list[BucketConfigDiffSection] = []
    for key, label, source_value, target_value in sections_data:
        section_changed = _stable_value(source_value) != _stable_value(target_value)
        sections.append(
            BucketConfigDiffSection(
                key=key,
                label=label,
                source=source_value,
                target=target_value,
                changed=section_changed,
            )
        )
    return BucketConfigDiff(
        changed=any(section.changed for section in sections),
        sections=sections,
    )


def compare_bucket_configuration(
    reader: BucketConfigurationReader,
    source_bucket: str,
    source_context: S3ExecutionTarget,
    target_bucket: str,
    target_context: S3ExecutionTarget,
    *,
    include_sections: Optional[set[str]] = None,
) -> BucketConfigDiff:
    selected_sections = _selected_sections(include_sections)
    if not selected_sections:
        return BucketConfigDiff(changed=False, sections=[])
    values = _read_configuration_values(
        reader,
        source_bucket,
        source_context,
        target_bucket,
        target_context,
        selected_sections,
    )
    return _build_configuration_diff(_configuration_sections(selected_sections, values))


def _normalize_tags(tags: list[BucketTag]) -> list[dict[str, str]]:
    return sorted(
        [{"key": (tag.key or "").strip(), "value": tag.value or ""} for tag in tags if (tag.key or "").strip()],
        key=lambda item: (item["key"], item["value"]),
    )


def _stable_value(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)
    except TypeError:
        return str(value)
