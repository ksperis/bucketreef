# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.utils.rgw_identifiers import generate_rgw_account_id, is_rgw_account_id


@pytest.mark.parametrize(
    ("prefix", "expected"),
    [
        ("9", "RGW90000000000000042"),
        ("80", "RGW80000000000000042"),
        ("123", "RGW12300000000000042"),
    ],
)
def test_generate_rgw_account_id_preserves_fixed_length(prefix, expected, monkeypatch):
    monkeypatch.setattr("app.utils.rgw_identifiers.secrets.randbelow", lambda _limit: 42)

    account_id = generate_rgw_account_id(prefix)

    assert account_id == expected
    assert is_rgw_account_id(account_id)


@pytest.mark.parametrize("prefix", ["", "1234", "ab", "8x", None])
def test_generate_rgw_account_id_rejects_invalid_prefix(prefix):
    with pytest.raises(ValueError, match="1 to 3 digits"):
        generate_rgw_account_id(prefix)
