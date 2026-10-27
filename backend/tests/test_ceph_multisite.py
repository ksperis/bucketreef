# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from time import monotonic
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.db import StorageEndpoint, StorageProvider, User, UserRole
from app.models.ceph_multisite import (
    Flow,
    LocalZoneConfiguration,
    Observation,
    Overview,
    Period,
    Provenance,
    Topology,
    Zone,
)
from app.models.session import ManagerSessionPrincipal, SessionCapabilities
from app.routers import dependencies
from app.routers.ceph_admin import multisite as multisite_router
from app.services import ceph_multisite_service as multisite_service_module
from app.services.ceph_multisite_normalize import (
    MultisiteContractError,
    normalize_bilog_info,
    normalize_log,
    normalize_period,
    normalize_sync,
    project,
)
from app.services.ceph_multisite_service import CephMultisiteService, reset_multisite_cache
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from tests.service_identity_helpers import service_identity


@pytest.fixture(autouse=True)
def _reset_multisite_cache():
    reset_multisite_cache()
    yield
    reset_multisite_cache()


def _endpoint(
    db_session,
    *,
    endpoint_id: int,
    zone: str,
) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        id=endpoint_id,
        name=f"ceph-{zone}",
        endpoint_url=f"https://{zone}.example.test",
        provider=StorageProvider.CEPH.value,
        region="us-east-1",
        verify_tls=True,
        ceph_admin_allowed=True,
    )
    endpoint.service_identities.append(
        service_identity("ceph_admin", f"AK-{zone}", f"SK-{zone}")
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


def _local_zone_observation(
    endpoint_id: int,
    zone: str,
    *,
    realm_id: str | None = "realm-a",
) -> Observation[LocalZoneConfiguration]:
    return Observation(
        availability="available",
        data=LocalZoneConfiguration(
            id=zone,
            name=zone,
            realm_id=realm_id,
            placements=[],
            storage_classes=["STANDARD"],
        ),
        collected_at="2026-10-27T10:00:00+00:00",
        last_success_at="2026-10-27T10:00:00+00:00",
        provenance=Provenance(
            endpoint_id=endpoint_id,
            realm_id=realm_id,
            local_zone_id=zone,
            operation="zone_configuration",
            http_status=200,
            collection_id="test-collection",
        ),
    )


def _period_observation(endpoint_id: int, zones: list[Zone]) -> Observation[Period]:
    return Observation(
        availability="available",
        data=Period(
            id="period-a",
            realm_id="realm-a",
            epoch="42",
            realm_epoch="7",
            master_zone="zone-a",
            zones=zones,
            details={},
        ),
        collected_at="2026-10-27T10:00:00+00:00",
        last_success_at="2026-10-27T10:00:00+00:00",
        provenance=Provenance(
            endpoint_id=endpoint_id,
            realm_id="realm-a",
            local_zone_id="zone-a",
            operation="period",
            http_status=200,
            collection_id="test-collection",
        ),
    )


def _topology(endpoint_id: int, zones: list[Zone]) -> Topology:
    local = next(
        (zone for zone in zones if zone.diagnostic_endpoint_id == endpoint_id),
        zones[0],
    )
    return Topology(
        local_zone=_local_zone_observation(endpoint_id, local.id),
        period=_period_observation(endpoint_id, zones),
        configured=True,
    )


def _zone(zone_id: str, endpoint_id: int, *, master: bool = False) -> Zone:
    return Zone(
        id=zone_id,
        name=zone_id,
        zonegroup_id="zg-a",
        zonegroup_name="zg-a",
        metadata_master=master,
        sync_from_all=False,
        sync_from=[],
        diagnostic_endpoint_id=endpoint_id,
    )


def test_normalization_preserves_unknown_phases_and_uint64_as_strings() -> None:
    status = normalize_sync(
        {
            "info": {"status": "future-global-phase", "num_shards": 1},
            "markers": [
                {
                    "key": 0,
                    "val": {
                        "status": "future-shard-phase",
                        "marker": 18446744073709551615,
                    },
                }
            ],
        },
        "data",
    )
    bucket = normalize_sync(
        {
            "sync_status": {
                "state": "incremental-sync",
                "incremental_gen": 18446744073709551615,
            },
            "inc_status": [],
        },
        "bucket-index",
    )
    bilog = normalize_bilog_info(
        {
            "oldest_gen": 18446744073709551614,
            "latest_gen": 18446744073709551615,
            "generations": [
                {"gen": 18446744073709551615, "num_shards": 11}
            ],
        }
    )

    assert status.phase == "unknown"
    assert status.raw_status == "future-global-phase"
    assert status.shards[0].phase == "unknown"
    assert status.shards[0].raw_status == "future-shard-phase"
    assert status.shards[0].marker == "18446744073709551615"
    assert bucket.generation == "18446744073709551615"
    assert bilog.latest_gen == "18446744073709551615"
    assert bilog.generations[0]["gen"] == "18446744073709551615"


@pytest.mark.parametrize("zone_count", [0, 1, 30])
def test_normalize_period_real_zonegroups_shape_and_mismatch_does_not_attribute(
    db_session,
    zone_count: int,
) -> None:
    payload = {
        "id": "period-a",
        "realm_id": "realm-a",
        "epoch": 42,
        "realm_epoch": 7,
        "master_zone": "zone-0" if zone_count else None,
        "period_map": {
            "zonegroups": [
                {
                    "id": "zg-a",
                    "name": "zg-a",
                    "sync_policy": {"groups": []},
                    "zones": [
                        {
                            "id": f"zone-{index}",
                            "name": f"zone-{index}",
                            "read_only": False,
                            "sync_from_all": True,
                            "sync_from": [],
                        }
                        for index in range(zone_count)
                    ],
                }
            ]
        },
    }

    period = normalize_period(payload)

    assert len(period.zones) == zone_count
    assert period.epoch == "42"
    assert period.realm_epoch == "7"
    if zone_count:
        assert period.zones[0].metadata_master is True
        assert period.zones[-1].id == f"zone-{zone_count - 1}"

    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-0")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    service.local_zones[endpoint.id] = LocalZoneConfiguration(
        id="zone-missing",
        name="zone-missing",
        realm_id="realm-a",
    )
    topology = Topology(
        local_zone=_local_zone_observation(endpoint.id, "zone-missing"),
        period=Observation(
            availability="available",
            data=period,
            collected_at="2026-10-27T10:00:00+00:00",
            provenance=Provenance(
                endpoint_id=endpoint.id,
                realm_id="realm-a",
                local_zone_id="zone-0",
                operation="period",
                collection_id="test-collection",
            ),
        ),
        configured=True,
        configuration_reason="local_zone_not_in_period",
    )

    assert service.validated_zone(topology, endpoint) is None


def test_log_cursor_must_advance_and_next_log_generation_is_string() -> None:
    with pytest.raises(MultisiteContractError, match="cursor did not advance"):
        normalize_log(
            {
                "entries": [{"op_id": "cursor-a", "object": "obj"}],
                "truncated": True,
            },
            "bucket-index",
            {"bucket": "bucket-a"},
            "cursor-a",
        )

    page = normalize_log(
        {
            "entries": [{"op_id": "cursor-b", "object": "obj"}],
            "truncated": True,
            "next_log": {
                "generation": 18446744073709551615,
                "num_shards": 17,
            },
        },
        "bucket-index",
        {"bucket": "bucket-a"},
        "cursor-a",
    )

    assert page.next_cursor == "cursor-b"
    assert page.next_log == {
        "generation": "18446744073709551615",
        "num_shards": 17,
    }


def test_details_and_provider_errors_do_not_expose_secrets(db_session, monkeypatch) -> None:
    projected = project(
        {
            "id": "safe-id",
            "access_key": "AKIA-SHOULD-NOT-LEAK",
            "secret_key": "SECRET-SHOULD-NOT-LEAK",
            "password": "PASSWORD-SHOULD-NOT-LEAK",
            "data": {
                "name": "safe-name",
                "token": "TOKEN-SHOULD-NOT-LEAK",
            },
        }
    )
    assert projected == {"id": "safe-id", "data": {"name": "safe-name"}}

    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    monkeypatch.setattr(service, "client", lambda _endpoint: object())

    def fail(_client):
        raise RGWAdminError(
            "upstream secret=SECRET-SHOULD-NOT-LEAK",
            status_code=500,
            error_code="ProviderFailure",
        )

    observation = service.observe(endpoint, "realm", fail, lambda payload: payload)
    rendered = observation.model_dump_json()

    assert observation.availability == "unavailable"
    assert observation.reason_code == "rgw_read_failed"
    assert "SECRET-SHOULD-NOT-LEAK" not in rendered
    assert "ProviderFailure" not in rendered


def test_observe_transient_failure_reuses_stale_data_but_403_does_not(db_session, monkeypatch) -> None:
    clock = [100.0]
    monkeypatch.setattr(multisite_service_module, "monotonic", lambda: clock[0])
    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    monkeypatch.setattr(service, "client", lambda _endpoint: object())

    first = service.observe(
        endpoint,
        "realm",
        lambda _client: {"id": "realm-a", "name": "safe"},
        lambda payload: payload,
        ttl=10,
    )
    clock[0] += 11

    transient = service.observe(
        endpoint,
        "realm",
        lambda _client: (_ for _ in ()).throw(
            RGWAdminError("temporary provider failure", status_code=503)
        ),
        lambda payload: payload,
        ttl=10,
    )
    clock[0] += 1

    denied = service.observe(
        endpoint,
        "realm",
        lambda _client: (_ for _ in ()).throw(
            RGWAdminError("access denied SECRET-SHOULD-NOT-LEAK", status_code=403)
        ),
        lambda payload: payload,
        ttl=10,
    )

    assert first.last_success_at is not None
    assert transient.availability == "unavailable"
    assert transient.stale is True
    assert transient.data == first.data
    assert transient.last_success_at == first.last_success_at
    assert denied.availability == "denied"
    assert denied.stale is False
    assert denied.data is None
    assert denied.last_success_at is None
    assert "SECRET-SHOULD-NOT-LEAK" not in denied.model_dump_json()


def test_observe_cache_isolated_after_ceph_admin_credentials_change(db_session, monkeypatch) -> None:
    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    monkeypatch.setattr(service, "client", lambda _endpoint: object())
    reads: list[str] = []

    def read(_client):
        reads.append(endpoint.service_identity("ceph_admin").access_key)
        return {"id": f"realm-{len(reads)}"}

    first = service.observe(endpoint, "realm", read, lambda payload: payload, ttl=60)
    identity = endpoint.service_identity("ceph_admin")
    identity.access_key = "AK-ROTATED"
    identity.secret_key = "SK-ROTATED"
    second = service.observe(endpoint, "realm", read, lambda payload: payload, ttl=60)

    assert first.data == {"id": "realm-1"}
    assert second.data == {"id": "realm-2"}
    assert reads == ["AK-zone-a", "AK-ROTATED"]


def test_multisite_state_is_inactive_only_after_successful_local_zone_read(
    db_session,
    monkeypatch,
) -> None:
    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    monkeypatch.setattr(
        service,
        "local_zone",
        lambda _endpoint: _local_zone_observation(endpoint.id, "zone-a", realm_id=None),
    )

    state = service.state()

    assert state.status == "inactive"
    assert state.realm_id is None
    assert state.local_zone_id == "zone-a"
    assert state.availability == "available"


def test_multisite_state_keeps_menu_available_when_zone_read_is_denied(
    db_session,
    monkeypatch,
) -> None:
    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    denied = service.missing(
        endpoint,
        "zone_configuration",
        "rgw_read_failed",
        availability="denied",
    )
    monkeypatch.setattr(service, "local_zone", lambda _endpoint: denied)

    state = service.state()

    assert state.status == "unknown"
    assert state.availability == "denied"
    assert state.reason_code == "rgw_read_failed"


def test_topology_discovers_endpoint_zone_mapping_and_leaves_ambiguous_zone_unselected(
    db_session,
    monkeypatch,
) -> None:
    local = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    secondary_a = _endpoint(db_session, endpoint_id=2, zone="zone-b")
    secondary_b = _endpoint(db_session, endpoint_id=3, zone="zone-b-duplicate")
    service = CephMultisiteService(db_session, local.id, actor_id=10)
    endpoints = {endpoint.id: endpoint for endpoint in (local, secondary_a, secondary_b)}
    period = _period_observation(
        local.id,
        [_zone("zone-a", local.id, master=True), _zone("zone-b", secondary_a.id)],
    )
    realm = Observation(
        availability="available",
        data={"id": "realm-a", "name": "realm-a"},
        collected_at="2026-10-27T10:00:00+00:00",
        provenance=Provenance(
            endpoint_id=local.id,
            realm_id="realm-a",
            local_zone_id="zone-a",
            operation="realm",
            collection_id="test-collection",
        ),
    )
    monkeypatch.setattr(
        service,
        "observe",
        lambda _endpoint, operation, *_args, **_kwargs: period if operation == "period" else realm,
    )
    monkeypatch.setattr(
        service.endpoints,
        "list_endpoints",
        lambda: [SimpleNamespace(id=endpoint.id) for endpoint in endpoints.values()],
    )
    monkeypatch.setattr(service, "resolve", lambda endpoint_id: endpoints[endpoint_id])

    def local_zone(endpoint):
        zone_id = "zone-a" if endpoint.id == local.id else "zone-b"
        observation = _local_zone_observation(endpoint.id, zone_id)
        service.local_zones[endpoint.id] = observation.data
        return observation

    monkeypatch.setattr(service, "local_zone", local_zone)

    topology = service.topology()

    zone_a = next(zone for zone in topology.period.data.zones if zone.id == "zone-a")
    zone_b = next(zone for zone in topology.period.data.zones if zone.id == "zone-b")
    assert topology.configured is True
    assert topology.configuration_reason is None
    assert zone_a.diagnostic_endpoint_id == local.id
    assert [ref.id for ref in zone_a.endpoints] == [local.id]
    assert zone_b.diagnostic_endpoint_id is None
    assert [ref.id for ref in zone_b.endpoints] == [secondary_a.id, secondary_b.id]
    assert all(ref.diagnostic is False for ref in zone_b.endpoints)


def test_topology_skips_secondary_when_live_zone_read_is_denied(db_session, monkeypatch) -> None:
    local = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    secondary = _endpoint(db_session, endpoint_id=2, zone="zone-b")
    service = CephMultisiteService(db_session, local.id, actor_id=10)
    period = _period_observation(
        local.id,
        [_zone("zone-a", local.id, master=True), _zone("zone-b", secondary.id)],
    )
    realm = Observation(
        availability="available",
        data={"id": "realm-a", "name": "realm-a"},
        collected_at="2026-10-27T10:00:00+00:00",
        provenance=Provenance(
            endpoint_id=local.id,
            realm_id="realm-a",
            local_zone_id="zone-a",
            operation="realm",
            collection_id="test-collection",
        ),
    )
    monkeypatch.setattr(
        service,
        "observe",
        lambda _endpoint, operation, *_args, **_kwargs: period if operation == "period" else realm,
    )
    monkeypatch.setattr(
        service.endpoints,
        "list_endpoints",
        lambda: [SimpleNamespace(id=local.id), SimpleNamespace(id=secondary.id)],
    )
    monkeypatch.setattr(
        service,
        "resolve",
        lambda endpoint_id: local if endpoint_id == local.id else secondary,
    )

    def local_zone(endpoint):
        if endpoint.id == local.id:
            observation = _local_zone_observation(local.id, "zone-a")
            service.local_zones[local.id] = observation.data
            return observation
        return service.missing(
            secondary,
            "zone_configuration",
            "rgw_read_failed",
            availability="denied",
        )

    monkeypatch.setattr(service, "local_zone", local_zone)

    topology = service.topology()

    zone_b = next(zone for zone in topology.period.data.zones if zone.id == "zone-b")
    assert zone_b.endpoints == []
    assert zone_b.diagnostic_endpoint_id is None


def test_topology_does_not_map_secondary_from_stale_zone_configuration(
    db_session,
    monkeypatch,
) -> None:
    local = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    secondary = _endpoint(db_session, endpoint_id=2, zone="zone-b")
    service = CephMultisiteService(db_session, local.id, actor_id=10)
    period = _period_observation(
        local.id,
        [_zone("zone-a", local.id, master=True), _zone("zone-b", secondary.id)],
    )
    realm = Observation(
        availability="available",
        data={"id": "realm-a", "name": "realm-a"},
        collected_at="2026-10-27T10:00:00+00:00",
        provenance=Provenance(
            endpoint_id=local.id,
            realm_id="realm-a",
            local_zone_id="zone-a",
            operation="realm",
            collection_id="test-collection",
        ),
    )
    monkeypatch.setattr(
        service,
        "observe",
        lambda _endpoint, operation, *_args, **_kwargs: period if operation == "period" else realm,
    )
    monkeypatch.setattr(
        service.endpoints,
        "list_endpoints",
        lambda: [SimpleNamespace(id=local.id), SimpleNamespace(id=secondary.id)],
    )
    monkeypatch.setattr(
        service,
        "resolve",
        lambda endpoint_id: local if endpoint_id == local.id else secondary,
    )
    stale_secondary = _local_zone_observation(secondary.id, "zone-b")
    stale_secondary.availability = "unavailable"
    stale_secondary.stale = True

    def local_zone(endpoint):
        if endpoint.id == local.id:
            observation = _local_zone_observation(local.id, "zone-a")
            service.local_zones[local.id] = observation.data
            return observation
        service.local_zones.pop(secondary.id, None)
        return stale_secondary

    monkeypatch.setattr(service, "local_zone", local_zone)

    topology = service.topology()

    zone_b = next(zone for zone in topology.period.data.zones if zone.id == "zone-b")
    assert zone_b.endpoints == []
    assert zone_b.diagnostic_endpoint_id is None
    assert secondary.id not in service.local_zones


@pytest.mark.parametrize("provider_convention", ["empty-200", "not-found-404"])
def test_metadata_master_role_is_not_applicable_before_provider_read(
    db_session,
    monkeypatch,
    provider_convention: str,
) -> None:
    destination = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, destination.id, actor_id=10)
    topology = _topology(
        destination.id,
        [
            _zone("zone-a", destination.id, master=True),
            _zone("zone-b", 2),
        ],
    )
    service.local_zones[destination.id] = topology.local_zone.data
    attempted: list[str] = []

    class ProviderClient:
        def get_metadata_sync_status(self):
            attempted.append(provider_convention)
            if provider_convention == "not-found-404":
                raise RGWAdminError("not found", status_code=404)
            return {"info": {"status": "sync", "num_shards": 0}, "markers": []}

    monkeypatch.setattr(service, "client", lambda _endpoint: ProviderClient())

    flow = service.flow(topology, destination, "zone-a", "metadata")

    assert attempted == []
    assert flow.status.availability == "not_applicable"
    assert flow.status.reason_code == "metadata_master"
    assert flow.status.provenance.http_status is None


def test_capabilities_exposes_bucket_index_as_explicit_bucket_scope(db_session, monkeypatch) -> None:
    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    topology = _topology(endpoint.id, [_zone("zone-a", endpoint.id, master=True)])
    monkeypatch.setattr(
        service,
        "overview",
        lambda: Overview(topology=topology, metadata=[], data=[], uncollected=[]),
    )

    capabilities = service.capabilities()

    assert capabilities.bucket_index.availability == "not_observed"
    assert capabilities.bucket_index.reason_code == "explicit_bucket_scope_required"
    assert capabilities.bucket_index.provenance.operation == "bilog_info"


def test_bucket_identity_cache_keeps_tenants_and_instances_distinct(db_session, monkeypatch) -> None:
    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    calls: list[tuple[str, str | None]] = []

    class Client:
        def get_multisite_bucket_info(self, bucket: str, tenant: str | None = None):
            calls.append((bucket, tenant))
            return {
                "id": f"instance-{tenant or 'root'}",
                "bucket": bucket,
                "tenant": tenant,
            }

    monkeypatch.setattr(service, "client", lambda _endpoint: Client())

    tenant_a = service.bucket_identity(endpoint, "shared-name", "tenant-a")
    tenant_b = service.bucket_identity(endpoint, "shared-name", "tenant-b")
    tenant_a_cached = service.bucket_identity(endpoint, "shared-name", "tenant-a")

    assert tenant_a.data.instance_id == "instance-tenant-a"
    assert tenant_b.data.instance_id == "instance-tenant-b"
    assert tenant_a_cached.data.instance_id == "instance-tenant-a"
    assert calls == [
        ("shared-name", "tenant-a"),
        ("shared-name", "tenant-b"),
    ]


def test_bucket_log_converts_uint64_generation_to_int_for_client(db_session, monkeypatch) -> None:
    endpoint = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    service = CephMultisiteService(db_session, endpoint.id, actor_id=10)
    seen: dict[str, object] = {}

    class Client:
        def get_multisite_bucket_info(self, bucket: str, tenant: str | None = None):
            return {"id": "instance-a", "bucket": bucket, "tenant": tenant}

        def list_bilog(self, **kwargs):
            seen.update(kwargs)
            return {"entries": [], "truncated": False}

    monkeypatch.setattr(service, "client", lambda _endpoint: Client())
    generation = "18446744073709551615"

    result = service.logs(
        "bucket-index",
        target_endpoint_id=endpoint.id,
        bucket="bucket-a",
        tenant="tenant-a",
        generation=generation,
        shard=3,
    )

    assert result.availability == "available"
    assert seen["generation"] == 18446744073709551615
    assert isinstance(seen["generation"], int)
    assert result.data.scope["generation"] == generation
    assert result.data.scope["instance_id"] == "instance-a"


def test_secondary_endpoint_is_reauthorized_before_cached_bucket_reads(db_session, monkeypatch) -> None:
    local = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    secondary = _endpoint(db_session, endpoint_id=2, zone="zone-b")
    service = CephMultisiteService(db_session, local.id, actor_id=10)
    calls: list[str] = []

    class Client:
        def get_multisite_bucket_info(self, bucket: str, tenant: str | None = None):
            calls.append("bucket-info")
            return {"id": "instance-b", "bucket": bucket, "tenant": tenant}

        def get_bilog_info(self, bucket: str, instance_id: str, tenant: str | None = None):
            calls.append("bilog-info")
            return {"oldest_gen": 1, "latest_gen": 1, "generations": []}

    monkeypatch.setattr(service, "client", lambda _endpoint: Client())

    first = service.bilog_info(secondary.id, "bucket-a", "tenant-a")
    assert first.availability == "available"
    assert calls == ["bucket-info", "bilog-info"]

    secondary.ceph_admin_allowed = False
    db_session.flush()

    with pytest.raises(HTTPException) as raised:
        service.bilog_info(secondary.id, "bucket-a", "tenant-a")

    assert raised.value.status_code == 403
    assert calls == ["bucket-info", "bilog-info"]


def test_topology_and_overview_tolerate_secondary_revoked_after_listing(db_session, monkeypatch) -> None:
    local = _endpoint(db_session, endpoint_id=1, zone="zone-a")
    _endpoint(db_session, endpoint_id=2, zone="zone-b")
    service = CephMultisiteService(db_session, local.id, actor_id=10)
    zones = [
        _zone("zone-a", local.id, master=True),
        _zone("zone-b", 2),
    ]
    period = _period_observation(local.id, zones)
    realm = Observation(
        availability="available",
        data={"id": "realm-a", "name": "realm-a"},
        collected_at="2026-10-27T10:00:00+00:00",
        provenance=Provenance(
            endpoint_id=local.id,
            realm_id="realm-a",
            local_zone_id="zone-a",
            operation="realm",
            collection_id="test-collection",
        ),
    )
    monkeypatch.setattr(
        service,
        "observe",
        lambda _endpoint, operation, *_args, **_kwargs: period if operation == "period" else realm,
    )
    def local_zone(endpoint):
        observation = _local_zone_observation(endpoint.id, "zone-a" if endpoint.id == local.id else "zone-b")
        service.local_zones[endpoint.id] = observation.data
        return observation
    monkeypatch.setattr(service, "local_zone", local_zone)
    monkeypatch.setattr(
        service.endpoints,
        "list_endpoints",
        lambda: [SimpleNamespace(id=local.id), SimpleNamespace(id=2)],
    )

    def resolve(endpoint_id: int):
        if endpoint_id == local.id:
            return local
        raise HTTPException(403, "Ceph Admin is not active on this endpoint")

    monkeypatch.setattr(service, "resolve", resolve)

    topology = service.topology()

    zone_a = next(zone for zone in topology.period.data.zones if zone.id == "zone-a")
    zone_b = next(zone for zone in topology.period.data.zones if zone.id == "zone-b")
    assert topology.configured is True
    assert topology.configuration_reason is None
    assert zone_a.diagnostic_endpoint_id == local.id
    assert zone_b.endpoints == []
    assert zone_b.diagnostic_endpoint_id is None

    monkeypatch.setattr(service, "topology", lambda: topology)
    overview = service.overview(offset=1)

    assert overview.uncollected == ["zone-b"]
    assert overview.metadata == []
    assert overview.data == []


def _auth_app(db_session) -> FastAPI:
    app = FastAPI()
    app.include_router(multisite_router.router)

    def override_db():
        yield db_session

    app.dependency_overrides[multisite_router.get_db] = override_db
    return app


def test_multisite_routes_require_authentication(db_session) -> None:
    app = _auth_app(db_session)
    with TestClient(app) as client:
        response = client.get("/ceph-admin/endpoints/1/multisite/topology")

    assert response.status_code == 401


def test_multisite_routes_reject_manager_without_ceph_admin_authority(db_session) -> None:
    manager = User(
        email="manager-no-ceph@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(manager)
    db_session.flush()
    app = _auth_app(db_session)
    app.dependency_overrides[dependencies.get_current_actor] = lambda: manager

    with TestClient(app) as client:
        response = client.get("/ceph-admin/endpoints/1/multisite/topology")

    assert response.status_code == 403


def test_multisite_routes_reject_portal_s3_session(db_session) -> None:
    portal = ManagerSessionPrincipal(
        session_id="session-1",
        access_key="AK-PORTAL",
        secret_key="SK-PORTAL",
        actor_type="s3",
        account_id="RGWACCOUNT000000001",
        account_name="Portal",
        user_uid="portal-user",
        capabilities=SessionCapabilities(),
    )
    app = _auth_app(db_session)
    app.dependency_overrides[dependencies.get_current_actor] = lambda: portal

    with TestClient(app) as client:
        response = client.get("/ceph-admin/endpoints/1/multisite/topology")

    assert response.status_code == 403
    assert response.json()["detail"] == "S3 session not allowed for this endpoint"


class _FakeFuture:
    def __init__(self, value=None) -> None:
        self.value = value
        self.cancelled = False

    def result(self):
        return self.value

    def cancel(self):
        self.cancelled = True
        return True


class _ImmediateExecutor:
    def __init__(self) -> None:
        self.futures: list[_FakeFuture] = []

    def submit(self, fn, *args):
        future = _FakeFuture(fn(*args))
        self.futures.append(future)
        return future

    def shutdown(self, **_kwargs):
        return None


class _PendingExecutor:
    def __init__(self) -> None:
        self.futures: list[_FakeFuture] = []

    def submit(self, _fn, *_args):
        future = _FakeFuture()
        self.futures.append(future)
        return future

    def shutdown(self, **_kwargs):
        return None


def _overview_fixture(db_session, monkeypatch):
    endpoints = [
        _endpoint(db_session, endpoint_id=1, zone="zone-a"),
        _endpoint(db_session, endpoint_id=2, zone="zone-b"),
        _endpoint(db_session, endpoint_id=3, zone="zone-c"),
    ]
    zones = [
        _zone("zone-a", 1, master=True),
        _zone("zone-b", 2),
        _zone("zone-c", 3),
    ]
    topology = _topology(1, zones)
    service = CephMultisiteService(db_session, 1, actor_id=10)
    monkeypatch.setattr(service, "topology", lambda: topology)
    by_id = {endpoint.id: endpoint for endpoint in endpoints}
    service.local_zones.update(
        {
            endpoint.id: LocalZoneConfiguration(
                id=zone.id,
                name=zone.name,
                realm_id="realm-a",
            )
            for endpoint, zone in zip(endpoints, zones, strict=True)
        }
    )
    monkeypatch.setattr(service, "resolve", lambda endpoint_id: by_id[endpoint_id])

    def flow(_topology, destination, source_zone_id, family):
        destination_zone = next(
            zone
            for zone in _topology.period.data.zones
            if zone.diagnostic_endpoint_id == destination.id
        )
        return Flow(
            destination_endpoint_id=destination.id,
            destination_zone_id=destination_zone.id,
            source_zone_id=source_zone_id,
            status=service.missing(
                destination,
                "metadata_status" if family == "metadata" else "data_status",
                "test-observation",
                source=source_zone_id,
            ),
        )

    monkeypatch.setattr(service, "flow", flow)
    return service


def test_overview_marks_jobs_beyond_call_budget_as_uncollected(db_session, monkeypatch) -> None:
    service = _overview_fixture(db_session, monkeypatch)
    monkeypatch.setattr(service.settings, "ceph_multisite_call_budget", 1)
    executor = _ImmediateExecutor()
    monkeypatch.setattr(
        multisite_service_module,
        "ThreadPoolExecutor",
        lambda *args, **kwargs: executor,
    )
    monkeypatch.setattr(
        multisite_service_module,
        "wait",
        lambda futures, timeout: (set(futures), set()),
    )

    overview = service.overview()

    assert len(overview.metadata) == 1
    assert overview.data == []
    assert overview.uncollected == ["zone-b", "zone-c"]


def test_overview_deadline_returns_pending_destinations_as_uncollected(db_session, monkeypatch) -> None:
    service = _overview_fixture(db_session, monkeypatch)
    monkeypatch.setattr(service.settings, "ceph_multisite_call_budget", 3)
    service.deadline = monotonic() - 1
    executor = _PendingExecutor()
    timeouts: list[float] = []
    monkeypatch.setattr(
        multisite_service_module,
        "ThreadPoolExecutor",
        lambda *args, **kwargs: executor,
    )

    def no_completed(futures, timeout):
        timeouts.append(timeout)
        return set(), set(futures)

    monkeypatch.setattr(multisite_service_module, "wait", no_completed)

    overview = service.overview()

    assert timeouts == [0]
    assert overview.metadata == []
    assert overview.data == []
    assert overview.uncollected == ["zone-a", "zone-b", "zone-c"]
    assert all(future.cancelled for future in executor.futures)


def test_streaming_transport_aborts_when_real_download_exceeds_limit(monkeypatch) -> None:
    client = RGWAdminClient(
        access_key="AK-TEST",
        secret_key="SK-TEST",
        endpoint="https://rgw.example.test",
        region="us-east-1",
    )
    request_kwargs: dict[str, object] = {}

    class StreamingResponse:
        status_code = 200
        headers: dict[str, str] = {}

        def __init__(self) -> None:
            self.closed = False

        def iter_content(self, chunk_size: int):
            assert chunk_size == 65536
            yield b"123"
            yield b"45"

        def close(self):
            self.closed = True

    response = StreamingResponse()

    def request(*args, **kwargs):
        request_kwargs.update(kwargs)
        return response

    monkeypatch.setattr(client.session, "request", request)

    with pytest.raises(RGWAdminError) as raised:
        client._send_request("GET", "/admin/log", max_response_bytes=4)

    assert raised.value.error_code == "ResponseTooLarge"
    assert request_kwargs["stream"] is True
    assert request_kwargs["allow_redirects"] is False
    assert response.closed is True
