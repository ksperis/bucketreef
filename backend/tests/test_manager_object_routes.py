# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.routers.manager import objects as manager_objects
from app.services.s3_client import S3OperationError
from app.services.s3_execution_context import S3ExecutionContext
from tests.router_test_utils import effective_routes


def _context() -> S3ExecutionContext:
    return S3ExecutionContext(
        context_id="test",
        context_kind="account",
        name="objects-account",
        access_key=None,
        secret_key=None,
    )


def test_manager_object_router_only_exposes_listing() -> None:
    routes = {(route.path, route.methods) for route in effective_routes(manager_objects.router)}

    assert routes == {
        (
            "/manager/buckets/{bucket_name}/objects",
            frozenset({"GET"}),
        )
    }


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/manager/buckets/demo/objects/upload"),
        ("post", "/api/manager/buckets/demo/objects/folders"),
        ("post", "/api/manager/buckets/demo/objects/delete"),
        ("get", "/api/manager/buckets/demo/objects/download?key=test.txt"),
    ],
)
def test_removed_manager_object_data_plane_routes_return_not_found(client, method: str, path: str) -> None:
    response = getattr(client, method)(path)

    assert response.status_code == 404


def test_manager_object_listing_maps_expected_s3_errors() -> None:
    class FailedService:
        @staticmethod
        def list_objects(*_args, **_kwargs):
            raise S3OperationError("S3 listing unavailable")

    with pytest.raises(HTTPException) as exc_info:
        manager_objects.list_objects(
            "bucket-1",
            context=_context(),
            service=FailedService(),
            _=None,
        )

    assert exc_info.value.status_code == 502


def test_manager_object_listing_does_not_mask_unexpected_runtime_errors() -> None:
    class BrokenService:
        @staticmethod
        def list_objects(*_args, **_kwargs):
            raise RuntimeError("unexpected object listing bug")

    with pytest.raises(RuntimeError, match="unexpected object listing bug"):
        manager_objects.list_objects(
            "bucket-1",
            context=_context(),
            service=BrokenService(),
            _=None,
        )
