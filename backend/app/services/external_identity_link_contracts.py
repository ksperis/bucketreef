# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared contracts for external identity linking."""

from app.utils.identity_provider_ids import normalize_identity_provider_id, normalize_oidc_issuer


class ExternalIdentityLinkError(ValueError):
    pass


def normalize_link_provider_id(value: object) -> str:
    try:
        return normalize_identity_provider_id(value)
    except ValueError as exc:
        raise ExternalIdentityLinkError(str(exc)) from exc


def normalize_link_oidc_issuer(value: object) -> str:
    try:
        return normalize_oidc_issuer(value)
    except ValueError as exc:
        raise ExternalIdentityLinkError(str(exc)) from exc
