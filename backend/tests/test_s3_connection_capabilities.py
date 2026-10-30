# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import pytest

from app.utils.s3_connection_capabilities import (
    s3_connection_can_manage_iam,
    validate_s3_connection_capabilities,
    with_s3_connection_can_manage_iam,
)


def test_connection_capabilities_use_the_canonical_boolean_contract():
    capabilities = {"can_manage_iam": True, "region_probe": "ok"}

    assert validate_s3_connection_capabilities(capabilities) == {
        "can_manage_iam": True,
        "region_probe": "ok",
    }
    assert s3_connection_can_manage_iam(capabilities) is True


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        [],
        {},
        {"can_manage_iam": 1},
        {"iam_capable": True},
    ],
)
def test_connection_capabilities_reject_noncanonical_profiles(value):
    with pytest.raises(ValueError):
        validate_s3_connection_capabilities(value)


def test_update_connection_capabilities_preserves_current_extension_fields():
    updated = with_s3_connection_can_manage_iam(
        {"can_manage_iam": False, "region_probe": "ok"},
        can_manage_iam=True,
    )

    assert updated == {
        "can_manage_iam": True,
        "region_probe": "ok",
    }
