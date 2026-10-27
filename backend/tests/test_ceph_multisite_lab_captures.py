# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Replay anonymized GET captures. This suite does not connect to a live RGW."""
from hashlib import sha256
import json
from pathlib import Path

import pytest

from app.services.ceph_multisite_normalize import normalize_bilog_info, normalize_log, normalize_period, normalize_sync

CAPTURES = Path(__file__).parent / "fixtures" / "ceph_multisite" / "lab"


def read(name):
    return json.loads((CAPTURES / name).read_text())


def test_captured_topology_retains_roles_and_zonegroup_associations():
    period = normalize_period(read("period.captured.json"))
    assert len(period.zones) == 2
    assert sum(zone.metadata_master for zone in period.zones) == 1
    assert next(zone.id for zone in period.zones if zone.metadata_master) == period.master_zone
    assert len({zone.zonegroup_id for zone in period.zones}) == 1


def test_captured_master_default_is_distinct_from_secondary_sync():
    master = normalize_sync(read("metadata-master.captured.json"), "metadata")
    secondary = normalize_sync(read("metadata-replica.captured.json"), "metadata")
    data = normalize_sync(read("data-replica.captured.json"), "data")
    # The service uses the known role to mark the default master result N/A;
    # a raw init/zero dump alone must never be interpreted as synchronized.
    assert (master.phase, master.expected_shards, len(master.shards)) == ("init", 0, 0)
    assert (secondary.phase, secondary.expected_shards, len(secondary.shards)) == ("sync", 64, 64)
    assert (data.phase, data.expected_shards, len(data.shards)) == ("sync", 128, 128)


def test_captured_bucket_full_position_and_generation_zero_are_preserved():
    status = normalize_sync(read("bucket-sync.captured.json"), "bucket-index")
    info = normalize_bilog_info(read("bilog-info.captured.json"))
    assert status.phase == "incremental-sync"
    assert status.generation == info.latest_gen == "0"
    assert len(status.shards) == 11
    assert info.generations == [{"gen": "0", "num_shards": 11}]
    assert status.details["sync_status"]["full"]["position"] == {"name": "replication/object-1.txt"}
    assert info.details["max_marker"].startswith("0#,1#")


@pytest.mark.parametrize("family,name", [
    ("metadata", "metadata-log-empty.captured.json"),
    ("data", "data-log-empty.captured.json"),
    ("bucket-index", "bilog-empty.captured.json"),
])
def test_captured_empty_logs_remain_descriptive_without_a_false_cursor(family, name):
    page = normalize_log(read(name), family, {"shard": 0}, None)
    assert page.entries == []
    assert page.next_cursor is None
    assert page.truncated is False


def test_capture_manifest_is_consistent_and_contains_no_credential_fields():
    manifest = read("manifest.json")
    assert manifest["fixture_kind"] == "anonymized_lab_capture"
    assert manifest["server_version"] is None
    assert manifest["remote_mutations"] == 0
    for name, metadata in manifest["files"].items():
        contents = (CAPTURES / name).read_bytes()
        assert sha256(contents).hexdigest() == metadata["sha256"]
        payload = contents.decode()
        assert all(key not in payload for key in ("secret_key", "access_key", "Authorization", "X-Amz-Signature", "lab.ksperis.com"))
