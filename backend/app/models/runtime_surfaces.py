# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.models.base import ApiModel


class RuntimeSurfaces(ApiModel):
    admin: bool
    ceph_admin: bool
    storage_ops: bool
    manager: bool
    portal: bool
    browser: bool
