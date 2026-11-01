# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations


SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD = 500
SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS = 10.0
RUN_ACTIONS_WAIT_TIMEOUT_SECONDS = 5.0
RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER = 32
ITEM_HEARTBEAT_PERSIST_INTERVAL_SECONDS = 10.0
DIFF_CONTROL_CHECK_INTERVAL_OBJECTS = 5_000


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]
