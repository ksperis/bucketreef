# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.core.db_transactions import rollback_on_error


class _FakeTransaction:
    def __init__(self) -> None:
        self.rollback_calls = 0

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        self.rollback_calls += 1


def test_rollback_on_error_preserves_failure_and_rolls_back() -> None:
    transaction = _FakeTransaction()

    with pytest.raises(RuntimeError, match="unit of work failed"):
        with rollback_on_error(transaction):
            raise RuntimeError("unit of work failed")

    assert transaction.rollback_calls == 1


def test_rollback_on_error_does_not_rollback_success() -> None:
    transaction = _FakeTransaction()

    with rollback_on_error(transaction):
        pass

    assert transaction.rollback_calls == 0
