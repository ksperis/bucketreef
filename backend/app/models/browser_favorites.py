# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from pydantic import Field
from app.models.base import ApiModel

class BrowserFavoriteInput(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    context: str = Field(min_length=1, max_length=256)
    bucket: str = Field(min_length=1, max_length=255)
    prefix: str = Field(default="", max_length=1024)


class BrowserFavoriteOut(BrowserFavoriteInput):
    id: str
    revision: int
    created_at: datetime
    updated_at: datetime
