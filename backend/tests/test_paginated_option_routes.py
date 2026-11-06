# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from types import SimpleNamespace

from app.db.openstack import OpenStackCloud
from app.main import app
from app.models.admin_listing import AdminOptionListingRequest, AdminPaginatedListingRequest
from app.models.execution_context import ExecutionContextOptionListingRequest
from app.models.pagination import OptionListingRequest
from app.routers import execution_contexts as execution_contexts_router
from app.routers.admin import groups as groups_router
from app.routers.admin import openstack as openstack_router
from app.routers.admin import users as users_router
from app.routers.manager import buckets as buckets_router
from app.services.buckets_service import BucketsService
from app.services.execution_context_catalog_service import ExecutionContextCatalogService


def test_manager_bucket_options_search_sort_and_paginate(monkeypatch):
    monkeypatch.setattr(
        buckets_router,
        "get_cached_bucket_listing_for_context",
        lambda **_kwargs: [
            SimpleNamespace(name="zeta"),
            SimpleNamespace(name="Alpha"),
            SimpleNamespace(name="alphabet"),
            SimpleNamespace(name="Alpha"),
        ],
    )

    response = buckets_router.list_bucket_options(
        query=OptionListingRequest(page=2, page_size=1, search="ALP"),
        context=object(),
        service=BucketsService(),
        _=object(),
    )

    assert [item.name for item in response.items] == ["alphabet"]
    assert response.total == 2
    assert response.page == 2
    assert response.page_size == 1
    assert response.has_next is False


def test_execution_context_options_filter_search_exclude_and_paginate(monkeypatch):
    contexts = [
        SimpleNamespace(
            kind="account",
            id="account-admin",
            display_name="Alpha account",
            manager_role="account_administrator",
            endpoint_id=1,
            endpoint_name="Primary RGW",
            endpoint_url="https://primary.example.test",
        ),
        SimpleNamespace(
            kind="account",
            id="account-member",
            display_name="Beta account",
            manager_role=None,
            endpoint_id=2,
            endpoint_name="Secondary RGW",
            endpoint_url="https://secondary.example.test",
        ),
        SimpleNamespace(
            kind="connection",
            id="connection-alpha",
            display_name="Alpha connection",
            manager_role=None,
            endpoint_id=3,
            endpoint_name="Archive RGW",
            endpoint_url="https://archive.example.test",
        ),
    ]

    service = ExecutionContextCatalogService.__new__(ExecutionContextCatalogService)
    monkeypatch.setattr(
        service,
        "list_contexts",
        lambda _user, *, workspace=None: contexts if workspace == "manager" else [],
    )
    query = ExecutionContextOptionListingRequest(
        workspace="manager",
        page=1,
        page_size=1,
        search="alpha",
        exclude_id="connection-alpha",
        manager_account_admin_only=True,
    )

    response = service.list_context_options(object(), query)

    assert [item.id for item in response.items] == ["account-admin"]
    assert response.total == 1
    assert response.has_next is False


def test_execution_context_options_route_forwards_request(monkeypatch):
    calls = []
    expected = SimpleNamespace(total=1)

    class FakeCatalog:
        def __init__(self, _db, _session_id):
            pass

        def list_context_options(self, user, query):
            calls.append((user, query))
            return expected

    monkeypatch.setattr(execution_contexts_router, "ExecutionContextCatalogService", FakeCatalog)
    query = ExecutionContextOptionListingRequest(search="alpha")
    user = object()

    response = execution_contexts_router.list_execution_context_options(
        query=query,
        request=None,
        user=user,
        db=object(),
    )

    assert response is expected
    assert calls == [(user, query)]


def test_manager_and_execution_context_option_queries_remain_flat_in_openapi():
    expected_common = {
        "page": {"type": "integer", "minimum": 1, "default": 1, "title": "Page"},
        "page_size": {
            "type": "integer",
            "maximum": 100,
            "minimum": 1,
            "default": 25,
            "title": "Page Size",
        },
        "search": {
            "type": "string",
            "maxLength": 256,
            "default": "",
            "title": "Search",
        },
    }

    paths = app.openapi()["paths"]
    bucket_parameters = {
        parameter["name"]: parameter["schema"]
        for parameter in paths["/api/manager/buckets/options"]["get"]["parameters"]
    }
    execution_parameters = {
        parameter["name"]: parameter["schema"]
        for parameter in paths["/api/me/execution-contexts/options"]["get"]["parameters"]
    }

    for name, schema in expected_common.items():
        assert bucket_parameters[name] == schema
        assert execution_parameters[name] == schema

    assert set(execution_parameters) == {
        "workspace",
        "page",
        "page_size",
        "search",
        "exclude_id",
        "manager_account_admin_only",
    }


def test_admin_openstack_cloud_options_search_and_paginate(db_session):
    db_session.add_all(
        [
            OpenStackCloud(name="Alpha cloud", auth_url="https://alpha.example.test/v3"),
            OpenStackCloud(name="Beta cloud", auth_url="https://beta.example.test/v3"),
            OpenStackCloud(name="Gamma cloud", auth_url="https://gamma.example.test/v3"),
        ]
    )
    db_session.commit()

    searched = openstack_router.list_cloud_options(
        query=AdminPaginatedListingRequest(page=1, page_size=10, search="beta"),
        db=db_session,
        user=object(),
        session=object(),
    )
    paged = openstack_router.list_cloud_options(
        query=AdminPaginatedListingRequest(page=2, page_size=1),
        db=db_session,
        user=object(),
        session=object(),
    )

    assert [item.name for item in searched.items] == ["Beta cloud"]
    assert searched.total == 1
    assert [item.name for item in paged.items] == ["Beta cloud"]
    assert paged.total == 3
    assert paged.has_next is True


def test_admin_user_options_forward_search_and_pagination(monkeypatch):
    calls = []

    class FakeUsersService:
        def list_user_options_page(self, query):
            calls.append(query)
            return SimpleNamespace(total=3, page=query.page, has_next=True)

    monkeypatch.setattr(users_router, "require_admin_interactive_session", lambda *_args: None)

    response = users_router.list_user_options(
        request=object(),
        query=AdminOptionListingRequest(page=2, page_size=1, search="alice"),
        users_service=FakeUsersService(),
        current_user=object(),
        db=object(),
    )

    assert calls == [AdminOptionListingRequest(page=2, page_size=1, search="alice")]
    assert response.total == 3
    assert response.page == 2
    assert response.has_next is True


def test_admin_group_options_forward_search_and_pagination():
    calls = []

    class FakeGroupsService:
        def list_group_options_page(self, query):
            calls.append(query)
            return SimpleNamespace(total=2, page=query.page, has_next=False)

    response = groups_router.list_group_options(
        query=AdminOptionListingRequest(page=2, page_size=1, search="ops"),
        groups_service=FakeGroupsService(),
        _=object(),
    )

    assert calls == [AdminOptionListingRequest(page=2, page_size=1, search="ops")]
    assert response.total == 2
    assert response.page == 2
    assert response.has_next is False
