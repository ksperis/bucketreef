# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import add_and_flush_in_savepoint
from app.core.domain_errors import ResourceConflictError
from app.db import DeploymentConfiguration

DEPLOYMENT_CONFIGURATION_KEY = "installation"
DEPLOYMENT_CONFIGURATION_SOURCE = "deployment"


def get_deployment_configuration(db: Session) -> DeploymentConfiguration | None:
    return db.get(DeploymentConfiguration, DEPLOYMENT_CONFIGURATION_KEY, populate_existing=True)


def lock_deployment_configuration(db: Session) -> DeploymentConfiguration:
    """Serialize local writes to the installation configuration."""
    statement = select(DeploymentConfiguration).where(
        DeploymentConfiguration.key == DEPLOYMENT_CONFIGURATION_KEY
    ).execution_options(populate_existing=True)
    if db.get_bind().dialect.name == "sqlite":
        db.execute(
            update(DeploymentConfiguration)
            .where(DeploymentConfiguration.key == DEPLOYMENT_CONFIGURATION_KEY)
            .values(revision=DeploymentConfiguration.revision)
        )
    else:
        statement = statement.with_for_update()
    state = db.scalar(statement)
    if state is None:
        # Metadata-only test databases may start without the migration's seed row.
        try:
            state = DeploymentConfiguration(key=DEPLOYMENT_CONFIGURATION_KEY)
            add_and_flush_in_savepoint(db, state)
        except IntegrityError:
            state = db.scalars(statement).one()
    return state


def require_editable_storage_endpoints(state: DeploymentConfiguration | None) -> None:
    if state is not None and state.storage_endpoints_managed:
        raise ValueError("Storage endpoints are managed by the deployment.")


class DeploymentConfigurationBusyError(ResourceConflictError):
    pass


@contextmanager
def deployment_configuration_operation(db: Session) -> Iterator[None]:
    """Coordinate configuration changes spanning a database commit or remote I/O."""
    from app.services.operation_lease_service import OperationLeaseService

    with OperationLeaseService(db).hold(
        "deployment-configuration:write", ttl_seconds=1800
    ) as handle:
        if handle is None:
            raise DeploymentConfigurationBusyError("Another deployment configuration operation is running. Retry shortly.")
        yield
