# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.services.pagination_window import page_window


def test_page_window_returns_offset_end_and_has_next():
    window = page_window(total=5, page=2, page_size=2)

    assert window.offset == 2
    assert window.end == 4
    assert window.has_next is True


def test_page_window_clamps_non_positive_page_to_first_page():
    window = page_window(total=3, page=0, page_size=2)

    assert window.offset == 0
    assert window.end == 2
    assert window.has_next is True


def test_page_window_reports_no_next_page_after_last_item():
    window = page_window(total=4, page=2, page_size=2)

    assert window.offset == 2
    assert window.end == 4
    assert window.has_next is False
