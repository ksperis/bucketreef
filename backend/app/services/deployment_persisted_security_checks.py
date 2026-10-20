# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import StorageEndpoint, User, UserRole, WebAuthnCredential
from app.services.deployment_check_models import DeploymentCheckFinding, finding


def persisted_security_findings(db: Session) -> list[DeploymentCheckFinding]:
    admin_ids = db.scalars(
        select(User.id).where(
            User.is_active.is_(True),
            User.role.in_([UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]),
        )
    ).all()
    enrolled_admin_ids: set[int] = set()
    if admin_ids:
        enrolled_admin_ids = set(
            db.scalars(
                select(WebAuthnCredential.user_id)
                .where(
                    WebAuthnCredential.user_id.in_(admin_ids),
                    WebAuthnCredential.revoked_at.is_(None),
                )
                .distinct()
            ).all()
        )
    missing_passkeys = len(admin_ids) - len(enrolled_admin_ids)

    endpoints = db.scalars(select(StorageEndpoint)).all()
    unverified_tls = sum(1 for endpoint in endpoints if not endpoint.verify_tls)
    reused_privileged_identity = 0
    for endpoint in endpoints:
        supervision = endpoint.service_identity("supervision")
        ceph_admin = endpoint.service_identity("ceph_admin")
        privileged_access_keys = [
            value.strip()
            for value in (
                endpoint.admin_access_key,
                supervision.access_key if supervision else None,
                ceph_admin.access_key if ceph_admin else None,
            )
            if value and value.strip()
        ]
        if len(privileged_access_keys) != len(set(privileged_access_keys)):
            reused_privileged_identity += 1

    return [
        finding(
            "admin-passkey-enrollment",
            "Administrator passkey enrollment",
            passed=missing_passkeys == 0,
            severity="critical",
            pass_message="Every active administrator has at least one enrolled passkey.",
            fail_message=f"{missing_passkeys} active administrator account(s) have no enrolled passkey.",
        ),
        finding(
            "storage-endpoint-tls",
            "Storage endpoint TLS verification",
            passed=unverified_tls == 0,
            severity="warning",
            pass_message="Stored storage endpoints verify TLS certificates.",
            fail_message=f"{unverified_tls} storage endpoint(s) have TLS certificate verification disabled.",
        ),
        finding(
            "storage-identity-separation",
            "Privileged storage identity separation",
            passed=reused_privileged_identity == 0,
            severity="warning",
            pass_message="Configured Admin Ops, supervision, and Ceph Admin identities are distinct per endpoint.",
            fail_message=(
                f"{reused_privileged_identity} storage endpoint(s) reuse the same access key across privileged roles; "
                "use distinct identities where practical."
            ),
        ),
    ]
