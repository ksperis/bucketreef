# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import EndpointServiceIdentity


def service_identity(
    kind: str,
    access_key: str | None = None,
    secret_key: str | None = None,
    *,
    mode: str = "external",
    status: str | None = None,
    rgw_uid: str | None = None,
    provenance: str | None = None,
) -> EndpointServiceIdentity:
    return EndpointServiceIdentity(
        kind=kind,
        mode="external" if kind == "ceph_admin" else mode,
        access_key=access_key,
        secret_key=secret_key,
        rgw_uid=rgw_uid,
        provenance=provenance,
        status=status or ("ready" if access_key and secret_key else "missing"),
    )


def set_service_identity_credentials(
    endpoint,
    kind: str,
    access_key: str | None,
    secret_key: str | None,
    *,
    mode: str | None = None,
    status: str | None = None,
):
    identity = endpoint.service_identity(kind)
    if identity is None:
        identity = service_identity(
            kind,
            mode=mode or "external",
        )
        endpoint.service_identities.append(identity)
    elif mode is not None:
        identity.mode = "external" if kind == "ceph_admin" else mode
    identity.access_key = access_key
    identity.secret_key = secret_key
    identity.status = status or ("ready" if access_key and secret_key else "missing")
    return identity
