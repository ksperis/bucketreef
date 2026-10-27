# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Tentacle dumps to diagnostic DTOs. Unknown states never become healthy ones."""
from __future__ import annotations

from typing import Any

from app.models.ceph_multisite import BilogInfo, Family, LogPage, Period, Shard, SyncStatus, Zone


class MultisiteContractError(ValueError):
    pass


# Details are projections of the examined dumps, never arbitrary provider JSON.
DETAIL_FIELDS = frozenset({
    "id", "name", "epoch", "realm_id", "realm_epoch", "master_zone", "master_zonegroup",
    "period_map", "zonegroups", "zones", "api_name", "is_master", "read_only",
    "sync_from_all", "sync_from", "sync_policy", "groups", "flows", "pipes", "status",
    "symmetrical", "directional", "source_zone", "dest_zone", "source", "dest", "bucket",
    "tenant", "bucket_id", "info", "markers", "key", "val", "state", "num_shards",
    "period", "instance_id", "marker", "next_step_marker", "total_entries", "pos",
    "timestamp", "sync_status", "full", "position", "count", "incremental_gen",
    "inc_status", "inc_marker", "bucket_ver", "master_ver", "max_marker", "syncstopped",
    "oldest_gen", "latest_gen", "generations", "gen", "generation", "entries", "truncated",
    "next_log", "last_update", "op_id", "op", "object", "object_instance", "versioned",
    "index_ver", "tag", "zones_trace", "bilog_flags", "ver", "pool", "entity_type",
    "log_id", "log_timestamp", "entry", "section", "data", "read_version", "write_version",
    "num_objects", "max_time", "max_marker", "total_entries", "header", "tail_marker",
})


def project(value: Any, *, depth: int = 0) -> Any:
    if depth > 24:
        raise MultisiteContractError("Response nesting exceeds the diagnostic limit")
    if isinstance(value, dict):
        return {key: project(item, depth=depth + 1) for key, item in value.items() if key in DETAIL_FIELDS}
    if isinstance(value, list):
        return [project(item, depth=depth + 1) for item in value]
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 2**53 - 1:
        return str(value)
    return value


def obj(value: Any) -> dict:
    if not isinstance(value, dict):
        raise MultisiteContractError("Expected a JSON object")
    return value


def array(value: Any) -> list:
    if not isinstance(value, list):
        raise MultisiteContractError("Expected a JSON array")
    return value


def text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (str, int)) and not isinstance(value, bool):
        return str(value)
    raise MultisiteContractError("Expected an identifier or position")


def timestamp(value: Any) -> str | None:
    raw = text(value)
    if not raw or raw.startswith(("1970-01-01", "0000-00-00")):
        return None
    return raw


def uint(value: Any) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise MultisiteContractError("Expected an unsigned integer")
    return value


def normalize_period(payload: Any) -> Period:
    payload = obj(payload)
    if not payload.get("id") or not payload.get("realm_id"):
        raise MultisiteContractError("Missing period or realm identifier")
    period_map = obj(payload.get("period_map"))
    zones = []
    for group in array(period_map.get("zonegroups")):
        group = obj(group)
        if not group.get("id") or not group.get("name"):
            raise MultisiteContractError("Missing zonegroup identity")
        for zone in array(group.get("zones")):
            zone = obj(zone)
            if not zone.get("id") or not zone.get("name"):
                raise MultisiteContractError("Missing zone identity")
            zones.append(Zone(
                id=str(zone["id"]), name=str(zone["name"]), zonegroup_id=str(group["id"]),
                zonegroup_name=str(group["name"]), metadata_master=zone["id"] == payload.get("master_zone"),
                read_only=zone.get("read_only"), sync_from_all=zone.get("sync_from_all"),
                sync_from=array(zone.get("sync_from", [])),
                policy_requires_confirmation=bool(obj(group.get("sync_policy", {})).get("groups")),
            ))
    if len({z.id for z in zones}) != len(zones):
        raise MultisiteContractError("Duplicate zone identity")
    return Period(
        id=str(payload["id"]), realm_id=str(payload["realm_id"]), epoch=text(payload.get("epoch")),
        realm_epoch=text(payload.get("realm_epoch")), master_zone=text(payload.get("master_zone")),
        zones=zones, details=project(payload),
    )


GLOBAL_PHASES = {"init", "building-full-sync-maps", "sync"}
SHARD_PHASES = {"init", "full-sync", "incremental-sync", "stopped"}


def normalize_sync(payload: Any, family: Family) -> SyncStatus:
    payload = obj(payload)
    shards = []
    if family == "bucket-index":
        info = obj(payload.get("sync_status"))
        raw = text(info.get("state"))
        if raw is None:
            raise MultisiteContractError("Missing bucket sync state")
        for index, shard in enumerate(array(payload.get("inc_status"))):
            shard = obj(shard)
            marker = obj(shard.get("inc_marker"))
            state = text(shard.get("status"))
            if state is None:
                raise MultisiteContractError("Missing shard status")
            shards.append(Shard(shard_id=index, phase=state if state in SHARD_PHASES else "unknown",
                                raw_status=state, marker=text(marker.get("position")),
                                timestamp=timestamp(marker.get("timestamp")), details=project(shard)))
        return SyncStatus(family=family, phase=raw if raw in SHARD_PHASES else "unknown", raw_status=raw,
                          generation=text(info.get("incremental_gen")), shards=shards, details=project(payload))
    info = obj(payload.get("info"))
    raw = text(info.get("status"))
    if raw is None:
        raise MultisiteContractError("Missing sync phase")
    for entry in array(payload.get("markers")):
        entry = obj(entry)
        shard_id = uint(entry.get("key"))
        if shard_id is None:
            raise MultisiteContractError("Missing shard identifier")
        value = obj(entry.get("val"))
        state = value.get("state") if family == "metadata" else text(value.get("status"))
        phase = {0: "full-sync", 1: "incremental-sync"}.get(state, "unknown") if family == "metadata" else state
        shards.append(Shard(shard_id=shard_id, phase=phase if phase in SHARD_PHASES else "unknown",
                            raw_status=state, marker=text(value.get("marker")),
                            timestamp=timestamp(value.get("timestamp")), details=project(value)))
    if len({s.shard_id for s in shards}) != len(shards):
        raise MultisiteContractError("Duplicate shard identifier")
    return SyncStatus(family=family, phase=raw if raw in GLOBAL_PHASES else "unknown", raw_status=raw,
                      expected_shards=uint(info.get("num_shards")), period=text(info.get("period")),
                      realm_epoch=text(info.get("realm_epoch")), instance_id=text(info.get("instance_id")),
                      shards=shards, details=project(payload))


def normalize_bilog_info(payload: Any) -> BilogInfo:
    payload = obj(payload)
    generations = []
    for entry in array(payload.get("generations")):
        entry = obj(entry)
        if "gen" not in entry or "num_shards" not in entry:
            raise MultisiteContractError("Missing generation fields")
        generations.append({"gen": text(entry["gen"]), "num_shards": uint(entry["num_shards"])})
    return BilogInfo(latest_gen=text(payload.get("latest_gen")), oldest_gen=text(payload.get("oldest_gen")),
                     generations=generations, details=project(payload))


def normalize_log(payload: Any, family: Family, scope: dict, cursor: str | None) -> LogPage:
    payload = obj(payload)
    entries = [project(obj(entry)) for entry in array(payload.get("entries"))]
    if not isinstance(payload.get("truncated"), bool):
        raise MultisiteContractError("Missing pagination flag")
    truncated = payload["truncated"]
    marker = text(entries[-1].get("op_id")) if family == "bucket-index" and entries else text(payload.get("marker"))
    if truncated and (not marker or marker == cursor):
        raise MultisiteContractError("Pagination cursor did not advance")
    next_log = project(obj(payload["next_log"])) if payload.get("next_log") is not None else None
    if next_log is not None:
        if "generation" not in next_log or "num_shards" not in next_log:
            raise MultisiteContractError("Missing next log generation fields")
        next_log = {"generation": text(next_log["generation"]), "num_shards": uint(next_log["num_shards"])}
    return LogPage(family=family, scope=scope, entries=entries, truncated=truncated,
                   next_cursor=marker if truncated else None, next_log=next_log,
                   last_update=timestamp(payload.get("last_update")))
