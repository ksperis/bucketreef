# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal

from app.models.base import ApiModel


class OperationSkippedResponse(ApiModel):
    status: Literal["skipped"]
    reason: Literal["already_running", "feature_disabled"]
    operation: str
