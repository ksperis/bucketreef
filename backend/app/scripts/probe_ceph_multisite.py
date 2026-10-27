# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Explicit, read-only laboratory capture; never changes RGW configuration."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Callable

from dotenv import dotenv_values

from app.services.ceph_multisite_normalize import project
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.time import utcnow


def probe(args: argparse.Namespace) -> int:
    values = dotenv_values(args.env_file)
    endpoints = json.loads(values.get("ENV_STORAGE_ENDPOINTS") or "[]")
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    report = {"captured_at": utcnow().isoformat(), "fixture_kind": "laboratory_capture", "results": []}
    for index, endpoint in enumerate(endpoints):
        if endpoint.get("provider") != "ceph" or not endpoint.get("ceph_admin_access_key"):
            continue
        client = RGWAdminClient(
            endpoint=endpoint["endpoint_url"], region=endpoint.get("region"),
            access_key=endpoint["ceph_admin_access_key"], secret_key=endpoint["ceph_admin_secret_key"],
            verify_tls=endpoint.get("verify_tls", True), request_timeout_seconds=8,
        )

        def capture(operation: str, read: Callable):
            result = {"endpoint_index": index, "operation": operation}
            try:
                payload = read()
                filename = f"endpoint-{index}-{operation}.json"
                # Only projected fields enter a fixture. No headers, URLs,
                # credentials or arbitrary provider error messages are saved.
                (output / filename).write_text(json.dumps(project(payload), indent=2) + "\n")
                result.update(http_status=200, file=filename)
                report["results"].append(result)
                return payload
            except RGWAdminError as exc:
                result.update(http_status=exc.status_code, error_code=exc.error_code or "read_failed")
                report["results"].append(result)
                return None

        period = capture("period", client.get_period)
        if not period:
            continue
        if period.get("realm_id"):
            capture("realm", lambda: client.get_realm(period["realm_id"]))
        capture("metadata-status", client.get_metadata_sync_status)
        zones = [zone for group in period.get("period_map", {}).get("zonegroups", []) for zone in group.get("zones", [])]
        for zone_index, zone in enumerate(zones[:8]):
            capture(f"data-status-source-{zone_index}", lambda: client.get_data_sync_status(zone["id"]))
        capture("metadata-log", lambda: client.list_mdlog(period["id"], args.shard))
        capture("data-log", lambda: client.list_datalog(args.shard))
        if args.bucket:
            identity = capture("bucket-instance", lambda: client.get_multisite_bucket_info(args.bucket, tenant=args.tenant))
            if identity and identity.get("id"):
                info = capture("bilog-info", lambda: client.get_bilog_info(args.bucket, identity["id"], tenant=args.tenant))
                if info and info.get("latest_gen") is not None:
                    capture("bilog", lambda: client.list_bilog(args.bucket, identity["id"], int(info["latest_gen"]),
                                                              tenant=args.tenant, shard_id=args.shard))
    (output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    for result in report["results"]:
        print(json.dumps({key: value for key, value in result.items() if key != "file"}))
    return 0 if any(result.get("http_status") == 200 for result in report["results"]) else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--bucket")
    parser.add_argument("--tenant")
    parser.add_argument("--shard", type=int, default=0)
    args = parser.parse_args()
    if args.shard < 0:
        parser.error("--shard must be non-negative")
    return probe(args)


if __name__ == "__main__":
    raise SystemExit(main())
