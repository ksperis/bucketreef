# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.services.bucket_feature_param_values import (
    extract_lifecycle_abort_days,
    extract_lifecycle_expiration_days,
    extract_lifecycle_noncurrent_expiration_days,
    extract_notification_filter_values,
)


@pytest.mark.parametrize(
    ("extractor", "container_key", "value_key"),
    [
        (extract_lifecycle_abort_days, "AbortIncompleteMultipartUpload", "DaysAfterInitiation"),
        (extract_lifecycle_expiration_days, "Expiration", "Days"),
        (
            extract_lifecycle_noncurrent_expiration_days,
            "NoncurrentVersionExpiration",
            "NoncurrentDays",
        ),
    ],
)
def test_lifecycle_nested_day_extractors_coerce_numeric_values(extractor, container_key, value_key):
    assert extractor({container_key: {value_key: "12.5"}}) == 12.5


@pytest.mark.parametrize(
    ("extractor", "container_key", "value_key"),
    [
        (extract_lifecycle_abort_days, "AbortIncompleteMultipartUpload", "DaysAfterInitiation"),
        (extract_lifecycle_expiration_days, "Expiration", "Days"),
        (
            extract_lifecycle_noncurrent_expiration_days,
            "NoncurrentVersionExpiration",
            "NoncurrentDays",
        ),
    ],
)
def test_lifecycle_nested_day_extractors_ignore_absent_or_malformed_values(
    extractor,
    container_key,
    value_key,
):
    assert extractor({}) is None
    assert extractor({container_key: "invalid"}) is None
    assert extractor({container_key: {value_key: "invalid"}}) is None


def test_notification_filter_values_merge_nested_and_direct_rules():
    entry = {
        "Filter": {
            "Key": {
                "FilterRules": [
                    {"Name": "prefix", "Value": "images/"},
                    {"Name": "suffix", "Value": ".jpg"},
                ]
            }
        },
        "FilterRules": [
            {"Name": "prefix", "Value": "logs/"},
            {"Name": "prefix", "Value": "IMAGES/"},
        ],
    }

    assert extract_notification_filter_values(entry, "prefix") == ["images/", "logs/"]
    assert extract_notification_filter_values(entry, "suffix") == [".jpg"]


def test_notification_filter_values_support_lowercase_external_aliases():
    entry = {
        "filter": {
            "key": {
                "filterRules": [
                    {"name": "prefix", "value": "incoming/"},
                ]
            }
        },
        "filterRules": [
            {"name": "suffix", "value": ".parquet"},
        ],
    }

    assert extract_notification_filter_values(entry, "prefix") == ["incoming/"]
    assert extract_notification_filter_values(entry, "suffix") == [".parquet"]


def test_notification_filter_values_ignore_malformed_rules():
    entry = {
        "Filter": {"Key": {"FilterRules": [None, "invalid", {"Name": "prefix"}]}},
        "FilterRules": {"Name": "prefix", "Value": "ignored"},
    }

    assert extract_notification_filter_values(entry, "prefix") == []
