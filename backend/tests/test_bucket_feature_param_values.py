# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.services.bucket_feature_param_values import extract_notification_filter_values


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
