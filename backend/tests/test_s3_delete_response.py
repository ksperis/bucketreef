# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.services.s3_delete_response import parse_delete_objects_failures


def test_delete_failures_preserve_requested_order_and_duplicate_entries():
    items = [
        {"Key": "versioned", "VersionId": "v1"},
        {"Key": "current"},
        {"Key": "versioned", "VersionId": "v1"},
    ]
    response = {
        "Errors": [
            {"Key": "versioned", "VersionId": "v1", "Code": "AccessDenied", "Message": "denied"},
            {"Key": "versioned", "VersionId": "v1", "Code": "IgnoredDuplicate", "Message": "ignored"},
            {"Key": "current", "Code": "InternalError"},
        ]
    }

    failures = parse_delete_objects_failures(response, bucket_name="bucket-a", items=items)

    assert [(failure.key, failure.version_id) for failure in failures] == [
        ("versioned", "v1"),
        ("current", None),
        ("versioned", "v1"),
    ]
    assert failures[0].message == "AccessDenied: denied"
    assert failures[1].message == "InternalError"
    assert failures[2].message == "AccessDenied: denied"


def test_delete_failure_without_version_resolves_single_requested_version():
    failures = parse_delete_objects_failures(
        {"Errors": [{"Key": "versioned", "Code": "AccessDenied"}]},
        bucket_name="bucket-a",
        items=[{"Key": "versioned", "VersionId": "v2"}],
    )

    assert [(failure.key, failure.version_id) for failure in failures] == [("versioned", "v2")]


@pytest.mark.parametrize(
    "response",
    [
        None,
        {"Errors": {}},
        {"Errors": [None]},
        {"Errors": [{"Key": "unexpected", "Code": "AccessDenied"}]},
        {"Errors": [{"Key": "versioned", "VersionId": "unexpected", "Code": "AccessDenied"}]},
    ],
)
def test_delete_failures_reject_invalid_provider_responses(response):
    with pytest.raises(RuntimeError, match="Invalid DeleteObjects response"):
        parse_delete_objects_failures(
            response,
            bucket_name="bucket-a",
            items=[{"Key": "versioned", "VersionId": "v1"}],
        )


def test_delete_failure_without_version_rejects_ambiguous_requested_versions():
    with pytest.raises(RuntimeError, match="Invalid DeleteObjects response"):
        parse_delete_objects_failures(
            {"Errors": [{"Key": "versioned", "Code": "AccessDenied"}]},
            bucket_name="bucket-a",
            items=[
                {"Key": "versioned", "VersionId": "v1"},
                {"Key": "versioned", "VersionId": "v2"},
            ],
        )
