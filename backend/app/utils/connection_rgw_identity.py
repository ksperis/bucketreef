# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.normalize import normalize_optional_string
from app.utils.rgw_identifiers import is_rgw_account_id, validate_rgw_user_uid


def normalize_connection_rgw_identity(
    user_uid: str | None,
    tenant: str | None,
    account_id: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Normalize the persisted RGW identity attached to an S3 connection.

    User UID, Ceph tenant and RGW Account ID are stored independently. Historical
    qualified-UID and owner-type syntaxes are intentionally rejected here;
    migration code owns that one-time conversion.
    """
    normalized_uid = normalize_optional_string(user_uid)
    normalized_tenant = normalize_optional_string(tenant)
    normalized_account = normalize_optional_string(account_id)

    if normalized_account:
        if not is_rgw_account_id(normalized_account):
            raise ValueError("RGW account ID must use the canonical RGW000... format.")
        normalized_account = normalized_account.upper()

    if normalized_uid:
        if "$" in normalized_uid or ":" in normalized_uid or normalized_uid.lower().startswith("iam:"):
            raise ValueError("RGW user UID must be unqualified; store its tenant separately.")
        normalized_tenant = normalized_tenant or ""
        validate_rgw_user_uid(normalized_uid, normalized_tenant)
    elif normalized_tenant:
        raise ValueError("RGW tenant requires an RGW user UID.")
    else:
        normalized_tenant = None

    if not normalized_uid and not normalized_account:
        return None, None, None
    return normalized_uid, normalized_tenant, normalized_account
