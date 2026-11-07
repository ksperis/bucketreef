# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import StorageEndpoint
from app.services.storage_endpoint_repository import StorageEndpointRepository


def test_get_returns_required_endpoint_and_types_missing_resource(db_session):
    endpoint = StorageEndpoint(
        name="repository-endpoint",
        endpoint_url="https://repository-endpoint.example.test",
        provider="other",
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    repository = StorageEndpointRepository(db_session)

    assert repository.get(endpoint.id) is endpoint
    with pytest.raises(StorageEndpointNotFoundError, match=r"^Endpoint not found\.$"):
        repository.get(999999)
