# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Pure local-state policy for endpoint service identity reconciliation."""
from __future__ import annotations

from app.db import EndpointServiceIdentity, StorageEndpoint
from app.services.endpoint_service_identity_validation import ManagedServiceIdentityKind
from app.utils.storage_endpoint_features import (
    required_service_identity_kinds,
    validate_persisted_features,
)

STARTUP_RECOVERY_KEY_TYPES = frozenset({"endpoint_runtime", "endpoint_supervision"})


def _identity_is_locally_ready(identity: EndpointServiceIdentity | None) -> bool:
    if (
        identity is None
        or identity.status != "ready"
        or not identity.rgw_uid
        or not identity.access_key
        or not identity.secret_key
    ):
        return False
    return identity.mode != "managed" or bool(identity.provenance)


def desired_service_kinds(
    endpoint: StorageEndpoint,
) -> list[ManagedServiceIdentityKind]:
    """Keep configured/in-flight identities, skip unused empty placeholders."""
    required = required_service_identity_kinds(
        validate_persisted_features(endpoint.provider, endpoint.features)
    )
    desired: list[ManagedServiceIdentityKind] = []
    for kind in ("runtime", "supervision"):
        identity = endpoint.service_identity(kind)
        tracked = identity is not None and identity.status != "disabled" and (
            any(
                (
                    identity.rgw_uid,
                    identity.access_key,
                    identity.secret_key,
                    identity.provenance,
                )
            )
            or identity.status in ("provisioning", "revocation_pending")
        )
        rotation_pending = any(
            intent.key_type == f"endpoint_{kind}"
            for intent in endpoint.key_rotation_intents
        )
        if kind in required or tracked or rotation_pending:
            desired.append(kind)
    return desired


def needs_startup_reconciliation(endpoint: StorageEndpoint) -> bool:
    """Return whether persisted local state requires an RGW recovery pass."""
    if endpoint.provider != "ceph":
        return False

    for kind in desired_service_kinds(endpoint):
        identity = endpoint.service_identity(kind)
        if (
            identity is not None
            and identity.mode == "managed"
            and identity.status == "not_provisioned"
        ):
            continue
        if not _identity_is_locally_ready(identity):
            return True

    ceph_admin = endpoint.service_identity("ceph_admin")
    if ceph_admin is not None and ceph_admin.access_key and ceph_admin.secret_key:
        if not _identity_is_locally_ready(ceph_admin):
            return True

    return any(
        intent.key_type in STARTUP_RECOVERY_KEY_TYPES
        for intent in endpoint.key_rotation_intents
    )


def skip_unprovisioned_identity(
    identity: EndpointServiceIdentity | None,
    *,
    provision_unprovisioned: bool,
) -> bool:
    return bool(
        not provision_unprovisioned
        and identity is not None
        and identity.mode == "managed"
        and identity.status == "not_provisioned"
    )
