# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Exercise multisite normalization with intentionally synthetic contract fixtures."""

import json
from pathlib import Path

import pytest

from app.services.ceph_multisite_normalize import normalize_bilog_info, normalize_log, normalize_period, normalize_sync


FIXTURES = Path(__file__).parent / "fixtures" / "ceph_multisite" / "contracts"


def read(name):
    return json.loads((FIXTURES / name).read_text())


def test_synthetic_topology_retains_roles_and_zonegroup_associations():
    period = normalize_period(read("period.synthetic.json"))
    assert len(period.zones) == 2
    assert sum(zone.metadata_master for zone in period.zones) == 1
    assert next(zone.id for zone in period.zones if zone.metadata_master) == period.master_zone
    assert len({zone.zonegroup_id for zone in period.zones}) == 1


def test_master_init_is_distinct_from_replica_sync():
    master = normalize_sync(read("metadata-master.synthetic.json"), "metadata")
    replica = normalize_sync(read("metadata-replica.synthetic.json"), "metadata")
    data = normalize_sync(read("data-replica.synthetic.json"), "data")

    assert (master.phase, master.expected_shards, len(master.shards)) == ("init", 0, 0)
    assert (replica.phase, replica.expected_shards, len(replica.shards)) == ("sync", 2, 2)
    assert (data.phase, data.expected_shards, len(data.shards)) == ("sync", 3, 3)


def test_bucket_position_and_generation_zero_are_preserved():
    status = normalize_sync(read("bucket-sync.synthetic.json"), "bucket-index")
    info = normalize_bilog_info(read("bilog-info.synthetic.json"))

    assert status.phase == "incremental-sync"
    assert status.generation == info.latest_gen == "0"
    assert len(status.shards) == 3
    assert info.generations == [{"gen": "0", "num_shards": 3}]
    assert status.details["bucket"] == "demo-bucket"
    assert status.details["sync_status"]["full"]["position"] == {"name": "samples/object.txt"}
    assert info.details["max_marker"] == "0#synthetic-a,1#synthetic-b,2#synthetic-c"


@pytest.mark.parametrize(
    ("family", "name"),
    [
        ("metadata", "metadata-log-empty.synthetic.json"),
        ("data", "data-log-empty.synthetic.json"),
        ("bucket-index", "bilog-empty.synthetic.json"),
    ],
)
def test_empty_logs_have_no_false_cursor(family, name):
    page = normalize_log(read(name), family, {"shard": 0}, None)

    assert page.entries == []
    assert page.next_cursor is None
    assert page.truncated is False


def test_fixture_payloads_are_explicitly_synthetic_and_secret_free():
    readme = (FIXTURES / "README.md").read_text()
    assert "intentionally synthetic" in readme

    forbidden = (
        "secret_key",
        "access_key",
        "Authorization",
        "X-Amz-Signature",
    )
    for path in FIXTURES.glob("*.json"):
        payload = path.read_text()
        assert all(value not in payload for value in forbidden)
