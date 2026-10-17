# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.request_paths import path_matches_prefix, relative_path_from_prefix


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/browser", True),
        ("/api/browser/buckets", True),
        ("/api/browser-legacy", False),
        ("/api/browserish/buckets", False),
    ],
)
def test_path_matches_prefix_only_on_segment_boundaries(path: str, expected: bool):
    assert path_matches_prefix(path, "/api/browser") is expected


def test_relative_path_from_prefix_requires_the_canonical_prefix():
    assert relative_path_from_prefix("/api/browser/buckets/demo", "/api/browser") == "/buckets/demo"
    assert relative_path_from_prefix("/browser/buckets/demo", "/api/browser") is None
