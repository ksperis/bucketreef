# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_admin_multisite import (
    _MULTISITE_MAX_BODY_BYTES,
    RGWAdminMultisiteOperations,
)

FIXTURES = Path(__file__).parent / "fixtures" / "ceph_multisite" / "tentacle"


class _Response:
    def __init__(
        self,
        *,
        status_code: int = 200,
        content: bytes = b"{}",
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.content = content
        self.text = content.decode("utf-8", errors="replace")
        self.headers = headers or {}

    def json(self):
        return json.loads(self.content)


def _client() -> RGWAdminClient:
    return RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
    )


def _capture(monkeypatch, client: RGWAdminClient, payload: bytes = b"{}"):
    calls: list[dict[str, object]] = []

    def send(method: str, path: str, **kwargs):
        calls.append(
            {
                "method": method,
                "path": path,
                "params": kwargs.get("params"),
                "timeout": kwargs.get("timeout"),
                "data": kwargs.get("data"),
            }
        )
        return _Response(content=payload)

    monkeypatch.setattr(client, "_send_request", send)
    return calls


def test_multisite_operations_are_integrated_as_dedicated_mixin() -> None:
    assert issubclass(RGWAdminClient, RGWAdminMultisiteOperations)
    assert (
        RGWAdminClient.get_metadata_sync_status.__module__
        == "app.services.rgw_admin_multisite"
    )


def test_explicit_signatures_build_only_allowlisted_get_queries(monkeypatch) -> None:
    client = _client()
    calls = _capture(monkeypatch, client)
    uint64 = 18446744073709551615

    client.get_realm("realm-a")
    client.get_period("realm-a")
    client.get_metadata_sync_status()
    client.get_data_sync_status("zone-source")
    client.get_bucket_sync_status(
        "tenant-a/destination:dest-instance",
        "tenant-a/source:source-instance",
        "zone-source",
    )
    client.get_bilog_info("bucket-a", "instance-a", tenant="tenant-a")
    client.list_mdlog("period-a", 3, marker="", max_entries=100)
    client.list_datalog(4, marker="data-marker", max_entries=200)
    client.list_bilog(
        "bucket-a",
        "instance-a",
        uint64,
        tenant="tenant-a",
        shard_id=7,
        marker="bilog-marker",
        max_entries=500,
    )
    client.get_mdlog_shard_info("period-a", 8)
    client.get_datalog_shard_info(9)
    client.get_multisite_bucket_info("bucket-a", tenant="tenant-a")

    assert len(calls) == 12
    assert {call["method"] for call in calls} == {"GET"}
    assert {call["path"] for call in calls} <= {
        "/admin/realm",
        "/admin/realm/period",
        "/admin/log",
        "/admin/bucket",
    }
    assert {call["timeout"] for call in calls} == {8.0}
    assert {call["data"] for call in calls} == {None}

    assert calls[2]["params"] == {
        "type": "metadata",
        "status": "",
        "format": "json",
    }
    assert calls[4]["params"] == {
        "type": "bucket-index",
        "status": "",
        "bucket": "tenant-a/destination:dest-instance",
        "source-bucket": "tenant-a/source:source-instance",
        "source-zone": "zone-source",
        "version": "2",
        "format": "json",
    }
    assert calls[5]["params"] == {
        "type": "bucket-index",
        "info": "",
        "tenant": "tenant-a",
        "bucket": "bucket-a",
        "bucket-instance": "bucket-a:instance-a",
        "format": "json",
    }
    assert calls[6]["params"]["marker"] == ""
    assert calls[7]["params"]["extra-info"] == "true"
    assert calls[8]["params"]["bucket-instance"] == "bucket-a:instance-a:7"
    assert calls[8]["params"]["generation"] == uint64
    assert calls[8]["params"]["format-ver"] == "2"
    assert calls[9]["params"]["info"] == ""
    assert calls[10]["params"]["info"] == ""
    assert calls[11]["params"] == {
        "bucket": "tenant-a/bucket-a",
        "stats": "true",
        "format": "json",
    }


def test_optional_params_are_omitted_without_changing_contract(monkeypatch) -> None:
    client = _client()
    calls = _capture(monkeypatch, client)

    client.get_period()
    client.get_bilog_info("bucket-a", "instance-a")
    client.list_bilog("bucket-a", "instance-a", 3)

    assert calls[0]["params"] == {"format": "json"}
    assert "tenant" not in calls[1]["params"]
    assert calls[1]["params"]["bucket-instance"] == "bucket-a:instance-a"
    assert "tenant" not in calls[2]["params"]
    assert "marker" not in calls[2]["params"]
    assert calls[2]["params"]["bucket-instance"] == "bucket-a:instance-a"


def test_zone_configuration_is_allowlisted_and_projects_only_safe_fields(monkeypatch) -> None:
    client = _client()
    payload = {
        "id": "zone-a",
        "name": "Paris",
        "realm_id": "realm-a",
        "system_key": {
            "access_key": "SYNC-ACCESS-SHOULD-NOT-LEAK",
            "secret_key": "SYNC-SECRET-SHOULD-NOT-LEAK",
        },
        "placement_pools": [
            {
                "key": "default-placement",
                "val": {
                    "storage_classes": {
                        "STANDARD": {"data_pool": "default.rgw.buckets.data"},
                        "COLD": {"data_pool": "default.rgw.buckets.cold"},
                    },
                },
            }
        ],
    }
    calls = _capture(monkeypatch, client, json.dumps(payload).encode())

    projected = client.get_zone_configuration()

    assert calls == [
        {
            "method": "GET",
            "path": "/admin/config",
            "params": {"type": "zone", "format": "json"},
            "timeout": 8.0,
            "data": None,
        }
    ]
    assert projected == {
        "id": "zone-a",
        "name": "Paris",
        "realm_id": "realm-a",
        "placements": [
            {
                "name": "default-placement",
                "storage_classes": ["COLD", "STANDARD"],
            }
        ],
        "storage_classes": ["COLD", "STANDARD"],
    }
    rendered = json.dumps(projected)
    assert "SYNC-ACCESS-SHOULD-NOT-LEAK" not in rendered
    assert "SYNC-SECRET-SHOULD-NOT-LEAK" not in rendered
    assert "system_key" not in rendered


def test_zone_configuration_error_body_is_never_exposed(monkeypatch) -> None:
    client = _client()
    monkeypatch.setattr(
        client,
        "_send_request",
        lambda *args, **kwargs: _Response(
            status_code=403,
            content=(
                b'{"system_key":{"access_key":"SYNC-ACCESS-SHOULD-NOT-LEAK",'
                b'"secret_key":"SYNC-SECRET-SHOULD-NOT-LEAK"},"Message":"denied"}'
            ),
        ),
    )

    with pytest.raises(RGWAdminError) as raised:
        client.get_zone_configuration()

    assert raised.value.status_code == 403
    assert str(raised.value) == "RGW zone configuration read failed"
    assert "SYNC-ACCESS-SHOULD-NOT-LEAK" not in str(raised.value)
    assert "SYNC-SECRET-SHOULD-NOT-LEAK" not in str(raised.value)


def test_internal_allowlist_rejects_unknown_operation_and_parameter() -> None:
    client = _client()
    with pytest.raises(ValueError, match="Unsupported RGW multisite read operation"):
        client._multisite_get("notify", {})
    with pytest.raises(ValueError, match="Unsupported RGW multisite query parameter"):
        client._multisite_get(
            "bucket_info",
            {"bucket": "bucket-a", "format": "json", "fix": "true"},
        )


@pytest.mark.parametrize("status_code", [403, 404, 500, 503])
def test_http_errors_remain_explicit(monkeypatch, status_code: int) -> None:
    client = _client()
    monkeypatch.setattr(
        client,
        "_send_request",
        lambda *args, **kwargs: _Response(
            status_code=status_code,
            content=b'{"Code":"UpstreamFailure","Message":"failed"}',
        ),
    )

    with pytest.raises(RGWAdminError) as raised:
        client.get_metadata_sync_status()

    assert raised.value.status_code == status_code
    assert raised.value.error_code == "UpstreamFailure"


def test_truncated_json_is_rejected_as_contract_error(monkeypatch) -> None:
    client = _client()
    _capture(monkeypatch, client, b'{"info":{"status":"sync"}')

    with pytest.raises(RGWAdminError) as raised:
        client.get_metadata_sync_status()

    assert raised.value.error_code == "InvalidJSON"


def test_non_object_json_root_is_rejected(monkeypatch) -> None:
    client = _client()
    _capture(monkeypatch, client, b"[]")

    with pytest.raises(RGWAdminError) as raised:
        client.get_metadata_sync_status()

    assert raised.value.error_code == "InvalidJSON"


@pytest.mark.parametrize("constant", [b"NaN", b"Infinity", b"-Infinity"])
def test_non_finite_json_numbers_are_rejected(monkeypatch, constant: bytes) -> None:
    client = _client()
    _capture(monkeypatch, client, b'{"value":' + constant + b"}")

    with pytest.raises(RGWAdminError) as raised:
        client.get_metadata_sync_status()

    assert raised.value.error_code == "InvalidJSON"


def test_body_over_four_mib_is_rejected_before_json_parse(monkeypatch) -> None:
    client = _client()
    _capture(monkeypatch, client, b"{" + (b" " * _MULTISITE_MAX_BODY_BYTES) + b"}")

    with pytest.raises(RGWAdminError) as raised:
        client.get_metadata_sync_status()

    assert raised.value.error_code == "ResponseTooLarge"


@pytest.mark.parametrize(
    ("filename", "expected_key", "expected_value"),
    [
        ("metadata_sync_status.synthetic.json", "info", {"status": "sync"}),
        (
            "bucket_sync_status.synthetic.json",
            "sync_status",
            {"state": "incremental-sync"},
        ),
        (
            "bilog_info_uint64.synthetic.json",
            "latest_gen",
            18446744073709551615,
        ),
        ("datalog_page.synthetic.json", "truncated", False),
    ],
)
def test_synthetic_tentacle_fixtures_parse_completely(
    monkeypatch,
    filename: str,
    expected_key: str,
    expected_value,
) -> None:
    client = _client()
    payload = (FIXTURES / filename).read_bytes()
    _capture(monkeypatch, client, payload)

    parsed = client.get_metadata_sync_status()

    if isinstance(expected_value, dict):
        for key, value in expected_value.items():
            assert parsed[expected_key][key] == value
    else:
        assert parsed[expected_key] == expected_value
    if filename == "bilog_info_uint64.synthetic.json":
        assert isinstance(parsed["latest_gen"], int)
        assert parsed["latest_gen"] > 2**53


@pytest.mark.parametrize("max_entries", [0, 501])
def test_log_page_size_is_bounded(max_entries: int) -> None:
    client = _client()
    with pytest.raises(ValueError, match="max_entries"):
        client.list_datalog(0, max_entries=max_entries)


def test_invalid_instance_and_shard_are_rejected_before_transport(monkeypatch) -> None:
    client = _client()
    calls = _capture(monkeypatch, client)

    with pytest.raises(ValueError, match="instance_id"):
        client.get_bilog_info("bucket-a", "")
    with pytest.raises(ValueError, match="shard_id"):
        client.list_bilog("bucket-a", "instance-a", 1, shard_id=-1)

    assert calls == []
