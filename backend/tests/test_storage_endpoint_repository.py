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


def test_ordered_and_preferred_endpoint_queries_preserve_catalog_semantics(db_session):
    endpoints = [
        StorageEndpoint(
            name="Zulu",
            endpoint_url="https://zulu.example.test",
            provider="other",
            is_default=True,
        ),
        StorageEndpoint(
            name="alpha",
            endpoint_url="https://alpha.example.test",
            provider="other",
            is_default=False,
        ),
        StorageEndpoint(
            name="Beta",
            endpoint_url="https://beta.example.test",
            provider="other",
            is_default=False,
        ),
    ]
    db_session.add_all(endpoints)
    db_session.commit()

    repository = StorageEndpointRepository(db_session)

    assert [endpoint.name for endpoint in repository.list_ordered()] == ["alpha", "Beta", "Zulu"]
    assert repository.get_default_or_first() is endpoints[0]


def test_preferred_endpoint_falls_back_to_first_name_when_no_default_exists(db_session):
    beta = StorageEndpoint(
        name="beta",
        endpoint_url="https://beta.example.test",
        provider="other",
        is_default=False,
    )
    alpha = StorageEndpoint(
        name="Alpha",
        endpoint_url="https://alpha.example.test",
        provider="other",
        is_default=False,
    )
    db_session.add_all([beta, alpha])
    db_session.commit()

    repository = StorageEndpointRepository(db_session)

    assert repository.get_default_or_first() is alpha
