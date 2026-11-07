# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.services.sequence_pagination import paginate_sequence


def test_paginate_sequence_returns_requested_page_and_has_next():
    items, total, has_next = paginate_sequence(
        ["a", "b", "c", "d", "e"],
        page=2,
        page_size=2,
    )

    assert items == ["c", "d"]
    assert total == 5
    assert has_next is True


def test_paginate_sequence_clamps_non_positive_page_to_first_page():
    items, total, has_next = paginate_sequence(
        ["a", "b", "c"],
        page=0,
        page_size=2,
    )

    assert items == ["a", "b"]
    assert total == 3
    assert has_next is True
