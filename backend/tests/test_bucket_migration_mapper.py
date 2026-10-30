# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.services.mappers.bucket_migration import load_migration_object


def test_bucket_migration_mapper_requires_canonical_objects() -> None:
    payload = {"status": "passed"}
    assert load_migration_object(None) is None
    assert load_migration_object(payload) is payload

    for raw in ('{"status":"passed"}', "{", "[]", '"legacy"'):
        with pytest.raises(ValueError):
            load_migration_object(raw)
