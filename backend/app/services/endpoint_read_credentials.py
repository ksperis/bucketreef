# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Credential selection for readers explicitly allowed to use endpoint keys."""

from typing import Protocol


class EndpointReadCredentialSource(Protocol):
    @property
    def supervision_access_key(self) -> str | None: ...

    @property
    def supervision_secret_key(self) -> str | None: ...

    @property
    def admin_access_key(self) -> str | None: ...

    @property
    def admin_secret_key(self) -> str | None: ...


def resolve_endpoint_read_credentials(source: EndpointReadCredentialSource) -> tuple[str, str] | None:
    """Prefer a complete supervision pair, then a complete administrator pair."""
    for access_key, secret_key in (
        (source.supervision_access_key, source.supervision_secret_key),
        (source.admin_access_key, source.admin_secret_key),
    ):
        if access_key and secret_key and access_key.strip():
            return access_key.strip(), secret_key
    return None
