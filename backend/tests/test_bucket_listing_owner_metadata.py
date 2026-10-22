# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.models.bucket_filter import BucketFilterQuery
from app.services.bucket_listing_owner_metadata import determine_owner_name_lookup_scope


def _query(*rules, match="all") -> BucketFilterQuery:
    return BucketFilterQuery.model_validate({"match": match, "rules": list(rules)})


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        (None, "any"),
        (_query({"field": "name", "op": "eq", "value": "bucket-a"}), "any"),
        (_query({"field": "owner_kind", "op": "eq", "value": "account"}, match="any"), "any"),
        (_query({"field": "owner_kind", "op": "eq", "value": "account"}), "account"),
        (_query({"field": "owner_kind", "op": "eq", "value": "acct"}), "account"),
        (_query({"field": "owner_kind", "op": "neq", "value": "account"}), "user"),
        (_query({"field": "owner_kind", "op": "in", "value": ["users"]}), "user"),
        (_query({"field": "owner_kind", "op": "not_in", "value": ["users"]}), "account"),
        (_query({"field": "owner_kind", "op": "in", "value": ["account", "user"]}), "any"),
        (
            _query(
                {"field": "owner_kind", "op": "eq", "value": "account"},
                {"field": "owner_kind", "op": "neq", "value": "user"},
            ),
            "account",
        ),
        (
            _query(
                {"field": "owner_kind", "op": "eq", "value": "account"},
                {"field": "owner_kind", "op": "eq", "value": "user"},
            ),
            "any",
        ),
        (_query({"field": "owner_kind", "op": "eq", "value": "unknown-kind"}), "any"),
    ],
)
def test_determine_owner_name_lookup_scope(query, expected):
    assert determine_owner_name_lookup_scope(query) == expected
