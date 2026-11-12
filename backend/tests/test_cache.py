# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from collections import OrderedDict

from app.utils.cache import TtlCacheEntry, prune_expired_lru_cache


def test_prune_expired_lru_cache_removes_expired_entries_before_capacity_eviction():
    cache = OrderedDict(
        [
            ("oldest", TtlCacheEntry(expires_at=20, value=None)),
            ("expired", TtlCacheEntry(expires_at=5, value=None)),
            ("newest", TtlCacheEntry(expires_at=30, value=None)),
        ]
    )

    prune_expired_lru_cache(cache, now=10, max_entries=1)

    assert list(cache) == ["newest"]
