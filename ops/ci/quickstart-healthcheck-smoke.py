#!/usr/bin/env python3
"""Seed/check a disposable endpoint inside the isolated bundle-smoke backend."""
from __future__ import annotations

import argparse

from app.core.database import SessionLocal
from app.db import EndpointHealthLatest, StorageEndpoint
from app.services.app_settings_service import load_app_settings

PROBE_NAME = "QuickStart scheduled healthcheck smoke"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("seed", "check"))
    action = parser.parse_args().action
    with SessionLocal() as db:
        if action == "seed":
            assert load_app_settings().general.endpoint_status_enabled
            # Bypass the Admin creation hook to prove that the actual cron runs.
            db.add(StorageEndpoint(
                name=PROBE_NAME, endpoint_url="http://frontend:8080", provider="other",
                is_default=False, is_editable=True,
            ))
            db.commit()
            return 0
        latest = (
            db.query(EndpointHealthLatest)
            .join(StorageEndpoint, StorageEndpoint.id == EndpointHealthLatest.storage_endpoint_id)
            .filter(StorageEndpoint.name == PROBE_NAME)
            .first()
        )
        return 0 if latest is not None and latest.status == "up" else 1


if __name__ == "__main__":
    raise SystemExit(main())
