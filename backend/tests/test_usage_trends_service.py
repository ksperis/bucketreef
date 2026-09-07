# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.db import QuotaUsageDaily, QuotaUsageHourly, S3Account
from app.services.s3_execution_context import S3ExecutionContext
from app.services.usage_trends_service import account_usage_trend_filters, build_account_usage_trends


@pytest.mark.parametrize("model", [QuotaUsageDaily, QuotaUsageHourly])
@pytest.mark.parametrize("context_kind", ["account", "portal_account", "session", "s3_user"])
def test_usage_history_filters_follow_explicit_context_kind(model, context_kind):
    context = S3ExecutionContext(
        context_id="selected-context",
        context_kind=context_kind,
        name="Selected context",
        access_key=None,
        secret_key=None,
        storage_endpoint_id=7,
        id=42,
        s3_user_id=43,
    )

    filters = account_usage_trend_filters(context, model)

    expected = [model.storage_endpoint_id == 7]
    if context_kind == "s3_user":
        expected.extend([model.s3_user_id == 43, model.s3_account_id.is_(None)])
    else:
        expected.extend([model.s3_account_id == 42, model.s3_user_id.is_(None)])
    assert filters is not None
    assert len(filters) == len(expected)
    assert all(actual.compare(required) for actual, required in zip(filters, expected))


@pytest.mark.parametrize("model", [QuotaUsageDaily, QuotaUsageHourly])
def test_persisted_account_and_execution_context_use_identical_history_filters(model):
    account = S3Account(id=42, name="Selected account", storage_endpoint_id=7)
    context = S3ExecutionContext.from_account(account)

    persisted = account_usage_trend_filters(account, model)
    resolved = account_usage_trend_filters(context, model)

    assert persisted is not None and resolved is not None
    assert len(persisted) == len(resolved)
    assert all(actual.compare(required) for actual, required in zip(resolved, persisted))


@pytest.mark.parametrize(
    ("context_kind", "identity"),
    [
        ("account", {"storage_endpoint_id": 7}),
        ("portal_account", {"storage_endpoint_id": 7}),
        ("session", {"storage_endpoint_id": 7}),
        ("s3_user", {"storage_endpoint_id": 7, "id": 42}),
        ("connection", {"storage_endpoint_id": 7, "id": 42}),
        ("ceph_admin", {"storage_endpoint_id": 7, "id": 42}),
        ("account", {"id": 42}),
    ],
)
def test_contexts_without_a_persisted_history_subject_do_not_query_usage(context_kind, identity):
    context = S3ExecutionContext(
        context_id="untracked-context",
        context_kind=context_kind,
        name="Untracked context",
        access_key=None,
        secret_key=None,
        **identity,
    )

    class NoHistoryQuery:
        def query(self, *_args):
            raise AssertionError("Untracked contexts must not query another subject's history")

    assert account_usage_trend_filters(context) is None
    assert build_account_usage_trends(NoHistoryQuery(), context).model_dump(exclude_none=True) == {}
