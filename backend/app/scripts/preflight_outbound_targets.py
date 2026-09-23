# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Inventory persisted outbound hosts that are not covered by operator allowlists.

Run from ``backend`` with ``python -m app.scripts.preflight_outbound_targets``.
Only hostnames are emitted; URLs, paths, query strings, credentials, and secrets
are deliberately excluded from the output.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.deployment_checks import find_uncovered_outbound_targets, run_outbound_target_preflight


run_preflight = run_outbound_target_preflight


def main() -> int:
    db = SessionLocal()
    try:
        return run_preflight(db, get_settings())
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
