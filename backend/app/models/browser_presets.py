# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Annotated, Literal
from pydantic import Field, StringConstraints
from app.models.base import ApiModel
from app.models.browser_filters import BrowserFileFilters

BrowserPresetSurface = Literal["browser", "manager", "ceph-admin", "portal"]


class BrowserPresetView(ApiModel):
    query: str = Field(default="", max_length=2000)
    scope: Literal["prefix", "bucket"] = "prefix"
    recursive: bool = False
    exact_match: bool = False
    case_sensitive: bool = False
    item_type: Literal["all", "file", "folder"] = "all"
    storage_class: str = Field(default="all", max_length=64)
    file_filters: BrowserFileFilters = Field(default_factory=BrowserFileFilters)
    sort_key: Literal["name", "size", "modified", "storageClass", "etag"] = "name"
    sort_direction: Literal["asc", "desc"] = "asc"
    columns: list[Annotated[str, StringConstraints(max_length=64)]] = Field(default_factory=list, max_length=40)


class BrowserPresetInput(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["favorite", "view"]
    surface: BrowserPresetSurface
    workspace: BrowserPresetSurface = "browser"
    context: str = Field(min_length=1, max_length=256)
    bucket: str = Field(min_length=1, max_length=255)
    prefix: str = Field(default="", max_length=1024)
    view: BrowserPresetView | None = None


class BrowserPresetOut(BrowserPresetInput):
    id: str
    revision: int
    created_at: datetime
    updated_at: datetime
