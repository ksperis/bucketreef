# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.services.feature_rule_inventory_service import _rule_filter_summary


@pytest.mark.parametrize(
    ("rule", "expected"),
    [
        ({"Prefix": "legacy/", "Filter": {"Prefix": "ignored/"}}, "Prefix: legacy/"),
        ({"Filter": {"Prefix": "logs/"}}, "Prefix: logs/"),
        ({"Filter": {"Tag": {"Key": "env", "Value": "prod"}}}, "Tag: env=prod"),
        ({"Filter": {"Tag": {"Key": "env"}}}, "Tag: env"),
        (
            {
                "Filter": {
                    "And": {
                        "Prefix": "archive/",
                        "Tags": [
                            {"Key": "env", "Value": "prod"},
                            {"Key": "owner"},
                        ],
                    }
                }
            },
            "Prefix: archive/ · Tags: env=prod, owner",
        ),
        ({"Filter": {"And": {}}}, None),
        ({"Filter": {"And": {"Tags": [{"Value": "ignored"}]}}}, "Combined filter"),
        ({"Filter": {}}, None),
        ({}, None),
    ],
)
def test_rule_filter_summary_preserves_aws_filter_shapes(rule, expected):
    assert _rule_filter_summary(rule) == expected
