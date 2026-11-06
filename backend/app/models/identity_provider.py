# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from app.models.base import ApiModel


class IdentityProviderFieldLock(ApiModel):
    forced: bool
    source: Optional[str]
