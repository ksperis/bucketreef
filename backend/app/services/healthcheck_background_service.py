# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from app.core.database import SessionLocal
from app.core.sensitive_data import sanitized_error_log_detail
from app.services.app_settings_service import load_app_settings
from app.services.healthcheck_service import HealthCheckService
from app.services.operation_lease_service import (
    HEALTHCHECK_RUN_OPERATION,
    OperationLeaseService,
    default_operation_lease_ttl_seconds,
)

logger = logging.getLogger(__name__)


def run_initial_healthchecks(*, endpoint_id: int | None = None) -> None:
    """Probe after the HTTP response; scheduled checks remain the retry mechanism."""
    try:
        # Never retain a request session or an ORM endpoint in a background task.
        with SessionLocal() as db:
            if not load_app_settings().general.endpoint_status_enabled:
                return
            leases = OperationLeaseService(db)
            lease = leases.acquire(
                HEALTHCHECK_RUN_OPERATION,
                ttl_seconds=default_operation_lease_ttl_seconds(),
                lease_context={"source": "initial", "endpoint_id": endpoint_id},
            )
            if lease is None:
                logger.info("Initial endpoint healthcheck deferred to the scheduler: checks already running")
                return
            try:
                HealthCheckService(db).run_checks(endpoint_id=endpoint_id)
            except Exception:
                db.rollback()
                raise
            finally:
                leases.release(lease)
    except Exception as exc:
        # Saving settings or an endpoint has already succeeded. Keep the failure
        # observable without turning that successful write into a request error.
        logger.error("Initial endpoint healthcheck failed: %s", sanitized_error_log_detail(exc))
