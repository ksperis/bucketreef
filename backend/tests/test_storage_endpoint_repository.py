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


def test_optional_endpoint_lookups_return_default_and_match_url(db_session):
    default_endpoint = StorageEndpoint(
        name="repository-default",
        endpoint_url="https://repository-default.example.test",
        provider="other",
        is_default=True,
    )
    other_endpoint = StorageEndpoint(
        name="repository-other",
        endpoint_url="https://repository-other.example.test",
        provider="other",
        is_default=False,
    )
    db_session.add_all([default_endpoint, other_endpoint])
    db_session.commit()

    repository = StorageEndpointRepository(db_session)

    assert repository.get_default() is default_endpoint
    assert repository.find_by_url(other_endpoint.endpoint_url) is other_endpoint
    assert repository.find_by_url("https://missing.example.test") is None
