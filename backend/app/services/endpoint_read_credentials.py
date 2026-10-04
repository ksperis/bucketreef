# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Explicit selection for runtime readers; never fall back to Admin Ops."""


def resolve_endpoint_read_credentials(source):
    identity = source.service_identity("runtime")
    if identity is not None and identity.status == "ready" and identity.access_key and identity.secret_key:
        return identity.access_key, identity.secret_key
    return None
