# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, wait
from copy import deepcopy
from hashlib import sha256
from threading import Lock
from time import monotonic, perf_counter
from typing import Callable
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import StorageEndpoint
from app.models.ceph_multisite import (
    BilogInfo, BucketDiagnostic, BucketIdentity, Capabilities, EndpointReference,
    Family, Flow, LocalZoneConfiguration, MultisiteState, Observation, Operation,
    Overview, Provenance, SyncStatus, Topology,
)
from app.services.ceph_admin_endpoint_service import (
    CephAdminEndpointService, CephAdminEndpointProviderError, CephAdminEndpointUnavailableError,
)
from app.services.ceph_multisite_normalize import (
    MultisiteContractError, normalize_bilog_info, normalize_log, normalize_period,
    normalize_sync, obj, project,
)
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
from app.utils.time import utcnow


# Bounded process-local cache. Keys include identity/configuration and the exact
# scope. Every endpoint is authorized again before a key can be looked up.
_CACHE: dict[tuple, tuple[float, Observation]] = {}
_CACHE_LOCK = Lock()


def reset_multisite_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


class CephMultisiteService:
    def __init__(self, db: Session, endpoint_id: int, *, actor_id: int | None = None):
        self.db = db
        self.actor_id = actor_id
        self.endpoints = CephAdminEndpointService(db)
        self.entry = self.resolve(endpoint_id)
        self.collection_id = str(uuid4())
        self.settings = get_settings()
        self.deadline = monotonic() + self.settings.ceph_multisite_deadline_seconds
        self.calls = 0
        self.budget_lock = Lock()
        self.local_zones: dict[int, LocalZoneConfiguration] = {}

    def resolve(self, endpoint_id: int) -> StorageEndpoint:
        # Use precisely the workspace's endpoint authority for secondary targets.
        try:
            endpoint = self.endpoints.get_configured_endpoint(endpoint_id)
        except StorageEndpointNotFoundError:
            raise HTTPException(404, "Storage endpoint not found")
        except CephAdminEndpointProviderError:
            raise HTTPException(400, "Storage endpoint is not a Ceph provider")
        except CephAdminEndpointUnavailableError:
            raise HTTPException(403, "Ceph Admin is not active on this endpoint")
        identity = endpoint.service_identity("ceph_admin")
        if identity is None or not identity.access_key or not identity.secret_key:
            raise HTTPException(403, "Ceph Admin credentials are not configured")
        return endpoint

    def client(self, endpoint):
        identity = endpoint.service_identity("ceph_admin")
        return get_rgw_admin_client(
            endpoint=resolve_rgw_admin_api_endpoint(endpoint), region=endpoint.region,
            verify_tls=endpoint.verify_tls, access_key=identity.access_key, secret_key=identity.secret_key,
            request_timeout_seconds=max(.1, min(self.settings.ceph_multisite_timeout_seconds, self.deadline - monotonic())),
        )

    def _key(self, endpoint, operation: Operation, scope: tuple) -> tuple:
        identity = endpoint.service_identity("ceph_admin")
        fingerprint = sha256(repr((
            identity.access_key, identity.secret_key, endpoint.endpoint_url,
            endpoint.features_config, endpoint.region, endpoint.verify_tls,
        )).encode()).hexdigest()
        return self.actor_id, endpoint.id, fingerprint, operation, scope

    def missing(self, endpoint, operation: Operation, reason: str, *, availability="not_observed", source=None) -> Observation:
        local = self.local_zones.get(endpoint.id)
        return Observation(
            availability=availability, collected_at=utcnow().isoformat(), reason_code=reason,
            provenance=Provenance(endpoint_id=endpoint.id,
                                  realm_id=local.realm_id if local else None,
                                  local_zone_id=local.id if local else None,
                                  source_zone_id=source, operation=operation, collection_id=self.collection_id),
        )

    def observe(self, endpoint, operation: Operation, read: Callable, normalize: Callable,
                *, scope: tuple = (), source: str | None = None, ttl: float = 10) -> Observation:
        key = self._key(endpoint, operation, scope)
        now = monotonic()
        with _CACHE_LOCK:
            previous = _CACHE.get(key) if ttl > 0 else None
            if previous and now - previous[0] < ttl:
                return deepcopy(previous[1])
        observation = self.missing(endpoint, operation, "collection_not_started", source=source)
        with self.budget_lock:
            if self.calls >= self.settings.ceph_multisite_call_budget or now >= self.deadline:
                observation.reason_code = "collection_budget_exhausted"
                return observation
            self.calls += 1
        start = perf_counter()
        try:
            payload = read(self.client(endpoint))
            observation.data = normalize(payload)
            observation.availability = "available"
            observation.provenance.http_status = 200
            observation.last_success_at = observation.collected_at
            observation.reason_code = None
        except RGWAdminError as exc:
            code = exc.status_code
            observation.provenance.http_status = code
            observation.availability = (
                "denied" if code in (401, 403) else "not_found" if code == 404 else
                "unsupported" if code in (405, 501) else "unavailable"
            )
            # Provider text can contain credentials or arbitrary object contents.
            observation.reason_code = (
                "invalid_response_contract" if exc.error_code == "InvalidJSON" else
                "response_too_large" if exc.error_code == "ResponseTooLarge" else "rgw_read_failed"
            )
        except (MultisiteContractError, ValueError, TypeError, KeyError, AttributeError):
            observation.availability = "unavailable"
            observation.reason_code = "invalid_response_contract"
        observation.provenance.duration_ms = round((perf_counter() - start) * 1000, 2)
        if observation.availability == "available" and ttl > 0:
            with _CACHE_LOCK:
                if len(_CACHE) >= 256:
                    del _CACHE[min(_CACHE, key=lambda k: _CACHE[k][0])]
                _CACHE[key] = monotonic(), deepcopy(observation)
        elif (observation.availability == "unavailable" and previous
              and monotonic() - previous[0] <= 1800):
            observation.data = deepcopy(previous[1].data)
            observation.last_success_at = previous[1].last_success_at
            observation.stale = True
        return observation

    def local_zone(self, endpoint) -> Observation[LocalZoneConfiguration]:
        observation = self.observe(
            endpoint,
            "zone_configuration",
            lambda client: client.get_zone_configuration(),
            LocalZoneConfiguration.model_validate,
            ttl=60,
        )
        if observation.availability == "available" and observation.data is not None:
            self.local_zones[endpoint.id] = observation.data
            observation.provenance.realm_id = observation.data.realm_id
            observation.provenance.local_zone_id = observation.data.id
        else:
            self.local_zones.pop(endpoint.id, None)
        return observation

    def state(self) -> MultisiteState:
        observation = self.local_zone(self.entry)
        if observation.availability != "available" or observation.data is None:
            return MultisiteState(
                status="unknown",
                checked_at=observation.collected_at,
                availability=observation.availability,
                reason_code=observation.reason_code,
            )
        local = observation.data
        return MultisiteState(
            status="active" if local.realm_id else "inactive",
            realm_id=local.realm_id,
            local_zone_id=local.id,
            checked_at=observation.collected_at,
            availability=observation.availability,
            reason_code=None,
        )

    def topology(self) -> Topology:
        local_zone = self.local_zone(self.entry)
        if local_zone.availability != "available" or local_zone.data is None:
            return Topology(
                local_zone=local_zone,
                period=self.missing(
                    self.entry,
                    "period",
                    "configuration_unavailable",
                    availability="not_observed",
                ),
                configured=None,
                configuration_reason="configuration_unavailable",
            )
        local = local_zone.data
        if local.realm_id is None:
            return Topology(
                local_zone=local_zone,
                period=self.missing(
                    self.entry,
                    "period",
                    "multisite_not_configured",
                    availability="not_applicable",
                ),
                configured=False,
                configuration_reason="multisite_not_configured",
            )

        period = self.observe(
            self.entry,
            "period",
            lambda c: c.get_period(realm_id=local.realm_id),
            normalize_period,
            scope=(local.realm_id,),
            ttl=60,
        )
        topology = Topology(local_zone=local_zone, period=period, configured=True)
        topology.realm = self.observe(
            self.entry,
            "realm",
            lambda c: c.get_realm(local.realm_id),
            lambda payload: project(obj(payload)),
            scope=(local.realm_id,),
            ttl=60,
        )
        if period.data is None:
            topology.configuration_reason = "period_unavailable"
            return topology
        data = period.data
        if data.realm_id != local.realm_id:
            topology.configuration_reason = "realm_mismatch"
            return topology
        if not any(zone.id == local.id for zone in data.zones):
            topology.configuration_reason = "local_zone_not_in_period"
            return topology

        # The catalogue and execution share CephAdminEndpointService. Never
        # connect to the untrusted endpoint URLs published in the period.
        for ref in self.endpoints.list_endpoints():
            try:
                endpoint = self.resolve(ref.id)
            except HTTPException:
                # A secondary endpoint may be withdrawn between catalogue and
                # resolution. It no longer contributes a usable association.
                continue
            discovered = self.local_zone(endpoint)
            if (
                discovered.availability != "available"
                or discovered.data is None
                or discovered.data.realm_id != data.realm_id
            ):
                continue
            zone = next((candidate for candidate in data.zones if candidate.id == discovered.data.id), None)
            if zone is not None:
                zone.endpoints.append(EndpointReference(
                    id=endpoint.id,
                    name=endpoint.name,
                    diagnostic=False,
                ))
        for zone in data.zones:
            if len(zone.endpoints) == 1:
                zone.endpoints[0].diagnostic = True
                zone.diagnostic_endpoint_id = zone.endpoints[0].id
            else:
                zone.diagnostic_endpoint_id = None
        return topology

    def validated_zone(self, topology: Topology, endpoint):
        data = topology.period.data
        if data is None:
            return None
        local = self.local_zones.get(endpoint.id)
        if local is None:
            observation = self.local_zone(endpoint)
            local = observation.data
        if local and local.realm_id == data.realm_id:
            return next((zone for zone in data.zones if zone.id == local.id), None)
        return None

    def flow(self, topology: Topology, destination, source_zone_id: str, family: Family) -> Flow:
        zone = self.validated_zone(topology, destination)
        operation = "metadata_status" if family == "metadata" else "data_status"
        source = next((z for z in topology.period.data.zones if z.id == source_zone_id), None) if topology.period.data else None
        if topology.configuration_reason or zone is None or source is None:
            status = self.missing(destination, operation, "zone_mapping_unavailable", availability="misconfigured", source=source_zone_id)
        elif family == "metadata" and zone.metadata_master:
            # Ceph may also return a default 200 on the metadata master; its
            # known role takes precedence over the empty structure.
            status = self.missing(destination, operation, "metadata_master", availability="not_applicable", source=source_zone_id)
        elif family == "metadata" and source_zone_id != topology.period.data.master_zone:
            raise HTTPException(422, "Metadata source must be the configured master zone")
        elif family == "data" and source_zone_id == zone.id:
            raise HTTPException(422, "Source and destination zones must differ")
        else:
            status = self.observe(destination, operation,
                                  lambda c: c.get_metadata_sync_status() if family == "metadata" else c.get_data_sync_status(source_zone_id),
                                  lambda p: normalize_sync(p, family),
                                  scope=(source_zone_id, topology.period.data.id, topology.period.data.epoch), source=source_zone_id)
        return Flow(destination_endpoint_id=destination.id, destination_zone_id=zone.id if zone else "",
                    source_zone_id=source_zone_id, status=status,
                    scope_requires_confirmation=zone.policy_requires_confirmation if zone else False)

    def overview(self, offset: int = 0) -> Overview:
        topology = self.topology()
        result = Overview(topology=topology, metadata=[], data=[], uncollected=[])
        if not topology.period.data or topology.configuration_reason:
            return result
        zones = topology.period.data.zones
        selected_zones = zones[offset:offset + 8]
        result.next_offset = offset + 8 if len(zones) > offset + 8 else None
        jobs = []
        for zone in selected_zones:
            if zone.diagnostic_endpoint_id is None:
                result.uncollected.append(zone.id)
                continue
            try:
                dest = self.resolve(zone.diagnostic_endpoint_id)
            except HTTPException:
                result.uncollected.append(zone.id)
                continue
            if topology.period.data.master_zone:
                jobs.append(("metadata", dest, topology.period.data.master_zone))
            for source in zones:
                if source.id == zone.id:
                    continue
                if zone.sync_from_all is False and not zone.policy_requires_confirmation and source.name not in zone.sync_from and source.id not in zone.sync_from:
                    continue
                jobs.append(("data", dest, source.id))
        # Read metadata for every destination first, then spread the remaining
        # budget across destinations for each candidate source.
        jobs.sort(key=lambda job: (job[0] != "metadata", job[2], job[1].id))
        # ORM reads and endpoint authorization stay on the calling DB thread.
        # Workers receive only resolved endpoints, and execute fixed GET methods.
        executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="multisite")
        futures = {executor.submit(self.flow, topology, dest, source, family): (family, dest, source)
                   for family, dest, source in jobs[:self.settings.ceph_multisite_call_budget]}
        done, pending = wait(futures, timeout=max(0, self.deadline - monotonic()))
        for future in done:
            family, dest, source = futures[future]
            try:
                flow = future.result()
            except Exception:
                local = self.local_zones.get(dest.id)
                flow = Flow(destination_endpoint_id=dest.id, destination_zone_id=local.id if local else "",
                            source_zone_id=source, status=self.missing(dest, "metadata_status" if family == "metadata" else "data_status",
                                                                     "collection_failed", availability="unavailable", source=source))
            getattr(result, family).append(flow)
            if flow.status.reason_code == "collection_budget_exhausted":
                result.uncollected.append(flow.destination_zone_id)
        for future in pending:
            future.cancel()
            _, dest, _ = futures[future]
            local = self.local_zones.get(dest.id)
            result.uncollected.append(local.id if local else str(dest.id))
        result.uncollected.extend(
            (self.local_zones.get(dest.id).id if self.local_zones.get(dest.id) else str(dest.id))
            for _, dest, _ in jobs[self.settings.ceph_multisite_call_budget:]
        )
        result.uncollected = sorted(set(result.uncollected))
        result.metadata.sort(key=lambda f: (f.destination_zone_id, f.source_zone_id))
        result.data.sort(key=lambda f: (f.destination_zone_id, f.source_zone_id))
        executor.shutdown(wait=False, cancel_futures=True)
        return result

    def capabilities(self) -> Capabilities:
        overview = self.overview()
        local = next((flow.status for flow in overview.metadata if flow.destination_endpoint_id == self.entry.id), None)
        return Capabilities(topology=overview.topology,
                            metadata=local or self.missing(self.entry, "metadata_status", "local_zone_not_observed"), data=overview.data,
                            bucket_index=self.missing(self.entry, "bilog_info", "explicit_bucket_scope_required"))

    def bucket_identity(self, endpoint, name: str, tenant: str | None) -> Observation[BucketIdentity]:
        def normalize(payload):
            payload = obj(payload)
            instance = payload.get("id")
            if not isinstance(instance, str) or not instance:
                raise MultisiteContractError("Bucket instance is unavailable")
            # Cross-check returned identity when the provider supplies it.
            if payload.get("bucket") not in (None, name) or (payload.get("tenant") or None) != (tenant or None):
                raise MultisiteContractError("Bucket identity mismatch")
            return BucketIdentity(name=name, tenant=tenant, instance_id=instance)
        return self.observe(endpoint, "bucket_instance", lambda c: c.get_multisite_bucket_info(name, tenant=tenant),
                            normalize, scope=(tenant, name))

    def bucket(self, *, source_endpoint_id: int, destination_endpoint_id: int, source_zone_id: str,
               bucket: str, source_bucket: str, tenant: str | None = None, source_tenant: str | None = None) -> BucketDiagnostic:
        source_endpoint = self.resolve(source_endpoint_id)
        destination_endpoint = self.resolve(destination_endpoint_id)
        topology = self.topology()
        src_zone = self.validated_zone(topology, source_endpoint)
        dst_zone = self.validated_zone(topology, destination_endpoint)
        if (topology.configuration_reason or src_zone is None or dst_zone is None
                or src_zone.id != source_zone_id or src_zone.id == dst_zone.id):
            raise HTTPException(422, "Source and destination require distinct, verified zone mappings")
        source = self.bucket_identity(source_endpoint, source_bucket, source_tenant)
        destination = self.bucket_identity(destination_endpoint, bucket, tenant)
        if source.data and destination.data and not source.stale and not destination.stale:
            src, dst = source.data, destination.data
            def key(ref):
                return f"{ref.tenant + '/' if ref.tenant else ''}{ref.name}:{ref.instance_id}"
            status = self.observe(destination_endpoint, "bucket_status",
                                  lambda c: c.get_bucket_sync_status(bucket=key(dst), source_bucket=key(src), source_zone_id=source_zone_id),
                                  lambda p: normalize_sync(p, "bucket-index"),
                                  scope=(key(src), key(dst), source_zone_id), source=source_zone_id)
        else:
            status = self.missing(destination_endpoint, "bucket_status", "bucket_instance_not_observed", source=source_zone_id)
        if source.data and not source.stale:
            bilog = self.observe(source_endpoint, "bilog_info",
                                 lambda c: c.get_bilog_info(bucket=source.data.name, instance_id=source.data.instance_id, tenant=source.data.tenant),
                                 normalize_bilog_info, scope=(source_tenant, source_bucket, source.data.instance_id))
        else:
            bilog = self.missing(source_endpoint, "bilog_info", "bucket_instance_not_observed")
        return BucketDiagnostic(source=source, destination=destination, status=status, bilog=bilog)

    def bilog_info(self, target_endpoint_id: int, bucket: str, tenant: str | None = None):
        endpoint = self.resolve(target_endpoint_id)
        identity = self.bucket_identity(endpoint, bucket, tenant)
        if identity.data is None or identity.stale:
            return self.missing(endpoint, "bilog_info", "bucket_instance_not_observed")
        return self.observe(endpoint, "bilog_info", lambda c: c.get_bilog_info(
            bucket=bucket, instance_id=identity.data.instance_id, tenant=tenant), normalize_bilog_info,
            scope=(tenant, bucket, identity.data.instance_id))

    def logs(self, family: Family, *, target_endpoint_id: int, shard: int | None = None,
             period: str | None = None, bucket: str | None = None, tenant: str | None = None,
             instance_id: str | None = None, generation: str | None = None,
             cursor: str | None = None, limit: int = 100):
        endpoint = self.resolve(target_endpoint_id)
        scope = dict(endpoint_id=endpoint.id, shard=shard, period=period, bucket=bucket, tenant=tenant,
                     instance_id=instance_id, generation=generation)
        if family == "metadata":
            if shard is None or not period:
                raise HTTPException(422, "Metadata logs require an explicit period and shard")
            read = lambda c: c.list_mdlog(period=period, shard_id=shard, marker=cursor, max_entries=limit)
            operation = "metadata_log"
        elif family == "data":
            if shard is None:
                raise HTTPException(422, "Data logs require an explicit shard")
            read = lambda c: c.list_datalog(shard_id=shard, marker=cursor, max_entries=limit)
            operation = "data_log"
        else:
            if not bucket or generation is None:
                raise HTTPException(422, "Bucket index logs require a bucket and generation")
            identity = self.bucket_identity(endpoint, bucket, tenant)
            if identity.data is None or identity.stale:
                return self.missing(endpoint, "bilog", "bucket_instance_not_observed")
            if instance_id and identity.data.instance_id != instance_id:
                raise HTTPException(409, "Bucket instance changed; reload the diagnostic")
            scope["instance_id"] = identity.data.instance_id
            read = lambda c: c.list_bilog(bucket=bucket, tenant=tenant, instance_id=identity.data.instance_id,
                                          generation=int(generation), shard_id=shard, marker=cursor, max_entries=limit)
            operation = "bilog"
        return self.observe(endpoint, operation, read, lambda p: normalize_log(p, family, scope, cursor),
                            scope=tuple(scope.values()) + (cursor, limit), ttl=0)

    def shard_info(self, *, target_endpoint_id: int, family: str, shard: int, period: str | None = None):
        endpoint = self.resolve(target_endpoint_id)
        if family == "metadata" and not period:
            raise HTTPException(422, "Metadata shard information requires a period")
        operation = "metadata_shard_info" if family == "metadata" else "data_shard_info"
        return self.observe(endpoint, operation, lambda c: c.get_mdlog_shard_info(period=period, shard_id=shard)
                            if family == "metadata" else c.get_datalog_shard_info(shard_id=shard),
                            lambda p: project(obj(p)), scope=(period, shard), ttl=0)
