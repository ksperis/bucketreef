# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from typing import Any, Optional, Protocol

from app.models.bucket import BucketLoggingConfiguration, BucketProperties, BucketTag
from app.models.bucket_compare import BucketConfigDiff, BucketConfigDiffSection
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.jsonable import model_to_jsonable


class BucketConfigurationReader(Protocol):
    def get_bucket_properties(self, name: str, execution_context: S3ExecutionContext) -> BucketProperties: ...

    def get_policy(self, name: str, execution_context: S3ExecutionContext) -> Optional[dict]: ...

    def get_bucket_logging(self, name: str, execution_context: S3ExecutionContext) -> BucketLoggingConfiguration: ...

    def get_bucket_tags(self, name: str, execution_context: S3ExecutionContext) -> list[BucketTag]: ...


_SECTION_SPECS = (
    ("versioning_status", "Versioning"),
    ("object_lock", "Object lock"),
    ("public_access_block", "Public access block"),
    ("lifecycle_rules", "Lifecycle rules"),
    ("cors_rules", "CORS rules"),
    ("bucket_policy", "Bucket policy"),
    ("access_logging", "Access logging"),
    ("tags", "Tags"),
)
_ALLOWED_SECTION_KEYS = frozenset(key for key, _label in _SECTION_SPECS)
_PROPERTY_SECTION_KEYS = frozenset(
    {"versioning_status", "object_lock", "public_access_block", "lifecycle_rules", "cors_rules"}
)


def _selected_sections(include_sections: Optional[set[str]]) -> set[str]:
    if include_sections is None:
        return set(_ALLOWED_SECTION_KEYS)
    return {key for key in include_sections if key in _ALLOWED_SECTION_KEYS}


def _read_configuration_values(
    reader: BucketConfigurationReader,
    source_bucket: str,
    source_context: S3ExecutionContext,
    target_bucket: str,
    target_context: S3ExecutionContext,
    selected_sections: set[str],
) -> dict[str, tuple[Any, Any]]:
    values: dict[str, tuple[Any, Any]] = {}
    if selected_sections & _PROPERTY_SECTION_KEYS:
        source_properties = reader.get_bucket_properties(source_bucket, source_context)
        target_properties = reader.get_bucket_properties(target_bucket, target_context)
        values.update(
            {
                "versioning_status": (
                    source_properties.versioning_status,
                    target_properties.versioning_status,
                ),
                "object_lock": (
                    model_to_jsonable(source_properties.object_lock),
                    model_to_jsonable(target_properties.object_lock),
                ),
                "public_access_block": (
                    model_to_jsonable(source_properties.public_access_block),
                    model_to_jsonable(target_properties.public_access_block),
                ),
                "lifecycle_rules": (
                    [model_to_jsonable(rule) for rule in source_properties.lifecycle_rules],
                    [model_to_jsonable(rule) for rule in target_properties.lifecycle_rules],
                ),
                "cors_rules": (
                    source_properties.cors_rules or [],
                    target_properties.cors_rules or [],
                ),
            }
        )

    if "bucket_policy" in selected_sections:
        values["bucket_policy"] = (
            reader.get_policy(source_bucket, source_context),
            reader.get_policy(target_bucket, target_context),
        )

    if "access_logging" in selected_sections:
        values["access_logging"] = (
            model_to_jsonable(reader.get_bucket_logging(source_bucket, source_context)),
            model_to_jsonable(reader.get_bucket_logging(target_bucket, target_context)),
        )

    if "tags" in selected_sections:
        values["tags"] = (
            _normalize_tags(reader.get_bucket_tags(source_bucket, source_context)),
            _normalize_tags(reader.get_bucket_tags(target_bucket, target_context)),
        )

    return values


def _build_configuration_diff(
    selected_sections: set[str],
    values: dict[str, tuple[Any, Any]],
) -> BucketConfigDiff:
    sections: list[BucketConfigDiffSection] = []
    for key, label in _SECTION_SPECS:
        if key not in selected_sections:
            continue
        source_value, target_value = values[key]
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
    source_context: S3ExecutionContext,
    target_bucket: str,
    target_context: S3ExecutionContext,
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
    return _build_configuration_diff(selected_sections, values)


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
