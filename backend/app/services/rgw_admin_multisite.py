# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping

from app.services.rgw_admin_transport import RGWAdminError

_MULTISITE_TIMEOUT_SECONDS = 8.0
_MULTISITE_MAX_BODY_BYTES = 4 * 1024 * 1024
_MULTISITE_MAX_LOG_ENTRIES = 500


def _reject_json_constant(_value: str):
    raise ValueError("Non-finite JSON number")


@dataclass(frozen=True)
class _ReadOperation:
    path: str
    allowed_params: frozenset[str]


_READ_OPERATIONS: dict[str, _ReadOperation] = {
    "realm": _ReadOperation("/admin/realm", frozenset({"id", "format"})),
    "period": _ReadOperation(
        "/admin/realm/period",
        frozenset({"realm_id", "format"}),
    ),
    "metadata_sync_status": _ReadOperation(
        "/admin/log",
        frozenset({"type", "status", "format"}),
    ),
    "data_sync_status": _ReadOperation(
        "/admin/log",
        frozenset({"type", "status", "source-zone", "format"}),
    ),
    "bucket_sync_status": _ReadOperation(
        "/admin/log",
        frozenset(
            {
                "type",
                "status",
                "bucket",
                "source-bucket",
                "source-zone",
                "version",
                "format",
            }
        ),
    ),
    "bilog_info": _ReadOperation(
        "/admin/log",
        frozenset({"type", "info", "tenant", "bucket", "bucket-instance", "format"}),
    ),
    "mdlog": _ReadOperation(
        "/admin/log",
        frozenset({"type", "period", "id", "max-entries", "marker", "format"}),
    ),
    "datalog": _ReadOperation(
        "/admin/log",
        frozenset(
            {
                "type",
                "id",
                "max-entries",
                "extra-info",
                "marker",
                "format",
            }
        ),
    ),
    "bilog": _ReadOperation(
        "/admin/log",
        frozenset(
            {
                "type",
                "tenant",
                "bucket",
                "bucket-instance",
                "generation",
                "max-entries",
                "format-ver",
                "marker",
                "format",
            }
        ),
    ),
    "mdlog_shard_info": _ReadOperation(
        "/admin/log",
        frozenset({"type", "period", "id", "info", "format"}),
    ),
    "datalog_shard_info": _ReadOperation(
        "/admin/log",
        frozenset({"type", "id", "info", "format"}),
    ),
    "bucket_info": _ReadOperation(
        "/admin/bucket",
        frozenset({"bucket", "stats", "format"}),
    ),
}


def _required_text(value: str, name: str) -> str:
    normalized = str(value).strip()
    if not normalized:
        raise ValueError(f"{name} is required")
    return normalized


def _shard_id(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("shard_id must be a non-negative integer")
    return value


def _generation(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 2**64 - 1:
        raise ValueError("generation must be a uint64 integer")
    return value


def _max_entries(value: int) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > _MULTISITE_MAX_LOG_ENTRIES
    ):
        raise ValueError(
            f"max_entries must be between 1 and {_MULTISITE_MAX_LOG_ENTRIES}"
        )
    return value


class RGWAdminMultisiteOperations:
    """Strictly read-only RGW multisite diagnostics."""

    def _multisite_get(
        self,
        operation_name: str,
        params: Mapping[str, Any],
    ) -> dict[str, Any]:
        operation = _READ_OPERATIONS.get(operation_name)
        if operation is None:
            raise ValueError("Unsupported RGW multisite read operation")

        unexpected = set(params) - operation.allowed_params
        if unexpected:
            raise ValueError(
                "Unsupported RGW multisite query parameter(s): "
                + ", ".join(sorted(unexpected))
            )

        # Use the existing SigV4/TLS/no-redirect transport. There is deliberately
        # no generic method/path argument exposed by this mixin.
        response = self._send_request(
            "GET",
            operation.path,
            params=dict(params),
            timeout=min(_MULTISITE_TIMEOUT_SECONDS, self.request_timeout_seconds),
            max_response_bytes=_MULTISITE_MAX_BODY_BYTES,
        )

        raw_content = getattr(response, "content", b"") or b""
        if isinstance(raw_content, str):
            raw_content = raw_content.encode("utf-8")
        if len(raw_content) > _MULTISITE_MAX_BODY_BYTES:
            raise RGWAdminError(
                "RGW multisite response exceeds the 4 MiB parsing limit",
                status_code=getattr(response, "status_code", None),
                error_code="ResponseTooLarge",
            )

        if response.status_code >= 400:
            return self._request_error_result(
                response,
                allow_conflict=False,
                allow_not_found=False,
                allow_not_implemented=False,
            )

        if not raw_content:
            return {}
        try:
            payload = json.loads(raw_content, parse_constant=_reject_json_constant)
        except (UnicodeDecodeError, ValueError) as exc:
            raise RGWAdminError(
                "Unexpected or incomplete RGW multisite JSON response",
                status_code=response.status_code,
                error_code="InvalidJSON",
            ) from exc
        if not isinstance(payload, dict):
            raise RGWAdminError(
                "Unexpected RGW multisite JSON root type",
                status_code=response.status_code,
                error_code="InvalidJSON",
            )
        return payload

    def get_realm(self, realm_id: str) -> dict[str, Any]:
        return self._multisite_get(
            "realm",
            {
                "id": _required_text(realm_id, "realm_id"),
                "format": "json",
            },
        )

    def get_period(self, realm_id: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"format": "json"}
        if realm_id is not None:
            params["realm_id"] = _required_text(realm_id, "realm_id")
        return self._multisite_get("period", params)

    def get_metadata_sync_status(self) -> dict[str, Any]:
        return self._multisite_get(
            "metadata_sync_status",
            {"type": "metadata", "status": "", "format": "json"},
        )

    def get_data_sync_status(self, source_zone_id: str) -> dict[str, Any]:
        return self._multisite_get(
            "data_sync_status",
            {
                "type": "data",
                "status": "",
                "source-zone": _required_text(source_zone_id, "source_zone_id"),
                "format": "json",
            },
        )

    def get_bucket_sync_status(
        self,
        bucket: str,
        source_bucket: str,
        source_zone_id: str,
    ) -> dict[str, Any]:
        return self._multisite_get(
            "bucket_sync_status",
            {
                "type": "bucket-index",
                "status": "",
                "bucket": _required_text(bucket, "bucket"),
                "source-bucket": _required_text(source_bucket, "source_bucket"),
                "source-zone": _required_text(source_zone_id, "source_zone_id"),
                "version": "2",
                "format": "json",
            },
        )

    def get_bilog_info(
        self,
        bucket: str,
        instance_id: str,
        tenant: str | None = None,
    ) -> dict[str, Any]:
        bucket_name = _required_text(bucket, "bucket")
        params: dict[str, Any] = {
            "type": "bucket-index",
            "info": "",
            "bucket": bucket_name,
            "bucket-instance": (
                f"{bucket_name}:{_required_text(instance_id, 'instance_id')}"
            ),
            "format": "json",
        }
        if tenant is not None:
            params["tenant"] = _required_text(tenant, "tenant")
        return self._multisite_get("bilog_info", params)

    def list_mdlog(
        self,
        period: str,
        shard_id: int,
        marker: str | None = None,
        max_entries: int = 100,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "type": "metadata",
            "period": _required_text(period, "period"),
            "id": _shard_id(shard_id),
            "max-entries": _max_entries(max_entries),
            "format": "json",
        }
        if marker is not None:
            params["marker"] = marker
        return self._multisite_get("mdlog", params)

    def list_datalog(
        self,
        shard_id: int,
        marker: str | None = None,
        max_entries: int = 100,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "type": "data",
            "id": _shard_id(shard_id),
            "max-entries": _max_entries(max_entries),
            "extra-info": "true",
            "format": "json",
        }
        if marker is not None:
            params["marker"] = marker
        return self._multisite_get("datalog", params)

    def list_bilog(
        self,
        bucket: str,
        instance_id: str,
        generation: int,
        tenant: str | None = None,
        shard_id: int | None = None,
        marker: str | None = None,
        max_entries: int = 100,
    ) -> dict[str, Any]:
        bucket_name = _required_text(bucket, "bucket")
        instance = _required_text(instance_id, "instance_id")
        bucket_instance = f"{bucket_name}:{instance}"
        if shard_id is not None:
            bucket_instance += f":{_shard_id(shard_id)}"
        params: dict[str, Any] = {
            "type": "bucket-index",
            "bucket": bucket_name,
            "bucket-instance": bucket_instance,
            "generation": _generation(generation),
            "max-entries": _max_entries(max_entries),
            "format-ver": "2",
            "format": "json",
        }
        if tenant is not None:
            params["tenant"] = _required_text(tenant, "tenant")
        if marker is not None:
            params["marker"] = marker
        return self._multisite_get("bilog", params)

    def get_mdlog_shard_info(
        self,
        period: str,
        shard_id: int,
    ) -> dict[str, Any]:
        return self._multisite_get(
            "mdlog_shard_info",
            {
                "type": "metadata",
                "period": _required_text(period, "period"),
                "id": _shard_id(shard_id),
                "info": "",
                "format": "json",
            },
        )

    def get_datalog_shard_info(self, shard_id: int) -> dict[str, Any]:
        return self._multisite_get(
            "datalog_shard_info",
            {
                "type": "data",
                "id": _shard_id(shard_id),
                "info": "",
                "format": "json",
            },
        )

    def get_multisite_bucket_info(
        self,
        bucket: str,
        tenant: str | None = None,
    ) -> dict[str, Any]:
        bucket_name = _required_text(bucket, "bucket")
        if tenant is not None:
            normalized_tenant = _required_text(tenant, "tenant")
            prefix = f"{normalized_tenant}/"
            if not bucket_name.startswith(prefix):
                bucket_name = f"{prefix}{bucket_name}"
        return self._multisite_get(
            "bucket_info",
            {
                "bucket": bucket_name,
                "stats": "true",
                "format": "json",
            },
        )
