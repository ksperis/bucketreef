# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import dataclass
from typing import Any

from app.core.sensitive_data import sanitized_error_log_detail


@dataclass(frozen=True)
class ObjectDeletionFailure:
    key: str
    version_id: str | None
    message: str


def parse_delete_objects_failures(
    response: Any, *, bucket_name: str, items: list[dict]
) -> list[ObjectDeletionFailure]:
    """Resolve provider errors to requested entries without normalizing their identity.

    Errors may omit VersionId only when the key identifies a single target.
    Repeated provider errors count once per requested entry, including when
    callers submitted the same entry more than once.
    """
    invalid_response = f"Invalid DeleteObjects response for bucket '{bucket_name}'"
    if not isinstance(response, dict) or not isinstance(response.get("Errors", []), list):
        raise RuntimeError(invalid_response)

    versions_by_key: dict[str, set[str | None]] = {}
    for item in items:
        versions_by_key.setdefault(item["Key"], set()).add(item.get("VersionId"))

    failures: dict[tuple[str, str | None], ObjectDeletionFailure] = {}
    for error in response.get("Errors", []):
        key = error.get("Key") if isinstance(error, dict) else None
        if not isinstance(key, str) or key not in versions_by_key:
            raise RuntimeError(invalid_response)
        versions = versions_by_key[key]
        version_id = error.get("VersionId")
        if version_id is None:
            if len(versions) != 1:
                raise RuntimeError(invalid_response)
            version_id = next(iter(versions))
        elif not isinstance(version_id, str) or version_id not in versions:
            raise RuntimeError(invalid_response)

        identity = (key, version_id)
        if identity not in failures:
            code = str(error.get("Code") or "Error")
            message = str(error.get("Message") or "")
            failures[identity] = ObjectDeletionFailure(
                key=key,
                version_id=version_id,
                message=sanitized_error_log_detail(f"{code}: {message}" if message else code),
            )

    return [
        failures[identity]
        for item in items
        if (identity := (item["Key"], item.get("VersionId"))) in failures
    ]
