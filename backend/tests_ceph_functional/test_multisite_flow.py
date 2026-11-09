# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import io
import time
import uuid
from typing import Any, Callable

import pytest

from .clients import BackendAPIError, BackendSession
from .config import CephTestSettings
from .conftest import CephAdminEndpointTestContext
from .resources import ResourceTracker


def _wait_for_value(
    label: str,
    read: Callable[[], Any],
    predicate: Callable[[Any], bool],
    *,
    timeout: float = 180.0,
    interval: float = 2.0,
) -> Any:
    deadline = time.monotonic() + timeout
    last_value: Any = None
    last_error: BackendAPIError | None = None
    while time.monotonic() < deadline:
        try:
            last_value = read()
            last_error = None
        except BackendAPIError as exc:
            if exc.status_code not in {404, 502, 503, 504}:
                raise
            last_error = exc
        else:
            if predicate(last_value):
                return last_value
        time.sleep(interval)
    if last_error is not None:
        raise AssertionError(f"Timed out waiting for {label}: {last_error}") from last_error
    raise AssertionError(f"Timed out waiting for {label}; last value={last_value!r}")


def _multisite_topology(
    session: BackendSession,
    endpoint_id: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    state = session.get(f"/ceph-admin/endpoints/{endpoint_id}/multisite/state")
    if state.get("status") != "active":
        pytest.skip(f"Endpoint {endpoint_id} is not attached to an active RGW multisite realm")
    topology = session.get(f"/ceph-admin/endpoints/{endpoint_id}/multisite/topology")
    return state, topology


def _declared_multisite_pair(
    session: BackendSession,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    endpoints = session.get("/admin/storage-endpoints")
    origin = next(
        (
            endpoint
            for endpoint in endpoints
            if endpoint.get("is_default") and endpoint.get("provider") == "ceph"
        ),
        None,
    )
    if origin is None:
        pytest.skip("RGW multisite switching requires a default Ceph endpoint")

    realm_id = str(origin.get("realm_id") or "").strip()
    zonegroup_id = str(origin.get("zonegroup_id") or "").strip()
    if not realm_id or not zonegroup_id:
        pytest.skip("Default Ceph endpoint does not declare RGW multisite realm/zonegroup metadata")

    destination = next(
        (
            endpoint
            for endpoint in endpoints
            if int(endpoint["id"]) != int(origin["id"])
            and endpoint.get("provider") == "ceph"
            and str(endpoint.get("realm_id") or "").strip() == realm_id
            and str(endpoint.get("zonegroup_id") or "").strip() == zonegroup_id
        ),
        None,
    )
    if destination is None:
        pytest.skip("No compatible peer Ceph endpoint declares the same realm and zonegroup")
    return endpoints, origin, destination


@pytest.mark.ceph_functional
def test_ceph_admin_multisite_topology_is_observable(
    super_admin_session: BackendSession,
    ceph_admin_endpoint: CephAdminEndpointTestContext,
) -> None:
    state, topology = _multisite_topology(super_admin_session, ceph_admin_endpoint.endpoint_id)

    assert state["availability"] == "available"
    assert state["realm_id"]
    assert state["local_zone_id"]
    assert topology["configured"] is True
    assert topology["configuration_reason"] is None
    assert topology["local_zone"]["availability"] == "available"
    assert topology["local_zone"]["data"]["id"] == state["local_zone_id"]
    assert topology["local_zone"]["data"]["realm_id"] == state["realm_id"]
    assert topology["period"]["availability"] == "available"
    assert topology["period"]["data"]["realm_id"] == state["realm_id"]
    assert any(zone["id"] == state["local_zone_id"] for zone in topology["period"]["data"]["zones"])


@pytest.mark.ceph_functional
def test_ceph_admin_multisite_peer_overview_uses_configured_diagnostic_endpoints(
    super_admin_session: BackendSession,
    ceph_admin_endpoint: CephAdminEndpointTestContext,
) -> None:
    state, topology = _multisite_topology(super_admin_session, ceph_admin_endpoint.endpoint_id)
    zones = topology["period"]["data"]["zones"]
    diagnostic_endpoint_ids = {
        int(zone["diagnostic_endpoint_id"])
        for zone in zones
        if zone.get("diagnostic_endpoint_id") is not None
    }
    if len(diagnostic_endpoint_ids) < 2:
        pytest.skip("RGW multisite peer diagnostics require at least two mapped Ceph endpoints")

    overview = super_admin_session.get(
        f"/ceph-admin/endpoints/{ceph_admin_endpoint.endpoint_id}/multisite/overview"
    )
    assert overview["topology"]["configuration_reason"] is None
    assert overview["topology"]["period"]["data"]["realm_id"] == state["realm_id"]
    assert overview["data"], "Expected at least one cross-zone data synchronization flow"
    assert {
        int(flow["destination_endpoint_id"])
        for flow in overview["data"]
    }.issubset(diagnostic_endpoint_ids)
    for flow in overview["data"]:
        assert flow["source_zone_id"] != flow["destination_zone_id"]
        assert flow["status"]["provenance"]["endpoint_id"] == flow["destination_endpoint_id"]
        assert flow["status"]["provenance"]["source_zone_id"] == flow["source_zone_id"]


@pytest.mark.ceph_functional
def test_manager_multisite_destination_switching_uses_selected_endpoint(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    endpoints, origin, destination = _declared_multisite_pair(super_admin_session)
    realm_id = str(origin["realm_id"])
    zonegroup_id = str(origin["zonegroup_id"])

    account_id = provisioned_account.account_id
    manager_session: BackendSession = provisioned_account.manager_session
    destination_id = int(destination["id"])

    contexts = manager_session.get("/me/execution-contexts", params={"workspace": "manager"})
    account_context = next(item for item in contexts if item["id"] == str(account_id))
    assert account_context["destination_switching_allowed"] is True
    assert {int(item["endpoint_id"]) for item in account_context["execution_destinations"]} >= {
        int(origin["id"]),
        destination_id,
    }

    incompatible = next(
        (
            endpoint
            for endpoint in endpoints
            if int(endpoint["id"]) != int(origin["id"])
            and (
                endpoint.get("provider") != "ceph"
                or str(endpoint.get("realm_id") or "").strip() != realm_id
                or str(endpoint.get("zonegroup_id") or "").strip() != zonegroup_id
            )
        ),
        None,
    )
    if incompatible is not None:
        manager_session.request(
            "GET",
            "/manager/buckets",
            params={"context_id": account_id, "execution_endpoint_id": int(incompatible["id"])},
            expected_status=400,
        )

    bucket_name = f"{ceph_test_settings.test_prefix}-{uuid.uuid4().hex[:8]}-multisite"
    object_key = f"multisite/{uuid.uuid4().hex}.txt"
    object_body = f"bucketreef multisite {uuid.uuid4().hex}\n".encode("utf-8")
    destination_params = {
        "context_id": account_id,
        "execution_endpoint_id": destination_id,
    }
    destination_ready = _wait_for_value(
        "fresh account credentials to propagate to the selected multisite destination",
        lambda: manager_session.request(
            "GET",
            "/manager/buckets",
            params=destination_params,
            expected_status=(200, 403),
        ),
        lambda response: response.status_code == 200,
        timeout=30.0,
        interval=0.5,
    )
    destination_ready.close()
    manager_session.post(
        "/manager/buckets",
        params=destination_params,
        json={"name": bucket_name, "versioning": False},
        expected_status=201,
    )
    resource_tracker.track_bucket(
        account_id,
        bucket_name,
        execution_endpoint_id=destination_id,
        cleanup_session=manager_session,
    )

    destination_buckets = manager_session.get("/manager/buckets", params=destination_params)
    assert any(item.get("name") == bucket_name for item in destination_buckets)
    uploaded = False
    try:
        upload = manager_session.request(
            "POST",
            f"/browser/buckets/{bucket_name}/proxy-upload",
            params=destination_params,
            data={"key": object_key, "content_type": "text/plain"},
            files={"file": ("multisite.txt", io.BytesIO(object_body), "text/plain")},
            expected_status=200,
        )
        upload.close()
        uploaded = True

        metadata = manager_session.get(
            f"/browser/buckets/{bucket_name}/object-meta",
            params={**destination_params, "key": object_key},
        )
        assert metadata["key"] == object_key
        assert int(metadata["size"]) == len(object_body)

        download = manager_session.request(
            "GET",
            f"/browser/buckets/{bucket_name}/download",
            params={**destination_params, "key": object_key},
            expected_status=200,
            stream=True,
        )
        try:
            assert download.content == object_body
        finally:
            download.close()
    finally:
        if uploaded:
            manager_session.post(
                f"/browser/buckets/{bucket_name}/delete",
                params=destination_params,
                json={"objects": [{"key": object_key}]},
                expected_status=200,
            )
