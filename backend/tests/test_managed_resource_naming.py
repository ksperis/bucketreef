# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.services.managed_resource_naming import portal_external_iam_username


def test_portal_external_iam_username_truncates_slug_before_token():
    username = portal_external_iam_username(
        2_147_483_647,
        2_147_483_647,
        "very-long-external-collaborator-name",
        "deadbeef",
    )

    assert len(username) <= 63
    assert username.startswith("bkr-portal-ext-2147483647-2147483647-")
    assert username.endswith("-deadbeef")


def test_portal_external_iam_username_drops_slug_before_token_for_maximum_ids():
    username = portal_external_iam_username(
        9_223_372_036_854_775_807,
        9_223_372_036_854_775_807,
        "external",
        "deadbeef",
    )

    assert username == (
        "bkr-portal-ext-9223372036854775807-9223372036854775807-deadbeef"
    )
    assert len(username) == 63
