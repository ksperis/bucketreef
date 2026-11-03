# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class PortalIAMRevocationPreparation:
    user_id: int
    account_id: int
    iam_username: Optional[str]
    restore_key_statuses: tuple[tuple[str, str], ...]
    already_pending: bool = False
