# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from pydantic import ValidationError

from app.models.ceph_admin_identity_filters import (
    CephAdminAccountFilterRule,
    CephAdminUserFilterRule,
)


@pytest.mark.parametrize(
    ("model", "payload", "message"),
    [
        (
            CephAdminAccountFilterRule,
            {"field": "account_name", "op": "gt", "value": "alpha"},
            "Account field 'account_name' does not support op 'gt'.",
        ),
        (
            CephAdminAccountFilterRule,
            {"field": "max_users", "op": "contains", "value": 10},
            "Account field 'max_users' does not support op 'contains'.",
        ),
        (
            CephAdminUserFilterRule,
            {"field": "suspended", "op": "contains", "value": True},
            "User field 'suspended' does not support op 'contains'.",
        ),
        (
            CephAdminUserFilterRule,
            {"field": "quota_max_objects", "op": "contains", "value": 10},
            "User field 'quota_max_objects' does not support op 'contains'.",
        ),
    ],
)
def test_identity_filter_rule_rejects_unsupported_field_operator(model, payload, message):
    with pytest.raises(ValidationError, match=message.replace(".", r"\.")):
        model.model_validate(payload)


@pytest.mark.parametrize(
    ("model", "subject"),
    [
        (CephAdminAccountFilterRule, "Account"),
        (CephAdminUserFilterRule, "User"),
    ],
)
def test_identity_filter_rule_rejects_invalid_value_shapes(model, subject):
    field = "account_id" if subject == "Account" else "uid"
    with pytest.raises(ValidationError, match=rf"{subject} in/not_in filter rule requires a list value\."):
        model.model_validate({"field": field, "op": "in", "value": "alpha"})

    with pytest.raises(ValidationError, match=rf"{subject} scalar filter rule does not accept a list value\."):
        model.model_validate({"field": field, "op": "eq", "value": ["alpha"]})

    with pytest.raises(ValidationError, match=rf"{subject} null-check filter rule does not accept value\."):
        model.model_validate({"field": field, "op": "is_null", "value": "alpha"})
