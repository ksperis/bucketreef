# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import StorageEndpoint, StorageProvider
from app.models.ceph_admin import CephAdminEndpoint, CephAdminEndpointAccess
from app.services.ceph_admin_service_identity import (
    build_ceph_admin_endpoint_payload,
    probe_ceph_admin_service_identity,
    validate_ceph_admin_service_configuration,
)
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.services.tags_service import TagsService
from app.utils.name_ordering import name_order_by
from app.utils.rgw_payloads import extract_rgw_user_identity
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
from app.utils.time import utcnow


class CephAdminEndpointProviderError(ValueError):
    """Raised when a Ceph Admin workflow targets a non-Ceph endpoint."""


class CephAdminEndpointUnavailableError(ValueError):
    """Raised when the dedicated Ceph Admin identity is not configured for use."""


class CephAdminEndpointService:
    """Ceph Admin endpoint catalogue and availability orchestration."""

    def __init__(self, db: Session):
        self.db = db
        self.tags = TagsService(db)

    def get_configured_endpoint(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.scalar(
            select(StorageEndpoint).where(StorageEndpoint.id == endpoint_id)
        )
        if endpoint is None:
            raise StorageEndpointNotFoundError("Storage endpoint not found")
        if endpoint.provider != StorageProvider.CEPH.value:
            raise CephAdminEndpointProviderError("Storage endpoint is not a Ceph provider")
        configuration_error = validate_ceph_admin_service_configuration(endpoint)
        if configuration_error:
            raise CephAdminEndpointUnavailableError(configuration_error)
        return endpoint

    def list_endpoints(self) -> list[CephAdminEndpoint]:
        endpoints = self.db.scalars(
            select(StorageEndpoint).order_by(*name_order_by(StorageEndpoint))
        ).all()
        results: list[CephAdminEndpoint] = []
        for endpoint in endpoints:
            if (
                endpoint.provider != StorageProvider.CEPH.value
                or validate_ceph_admin_service_configuration(endpoint)
            ):
                continue
            payload = build_ceph_admin_endpoint_payload(endpoint)
            payload["tags"] = self.tags.filter_selector_visible(
                self.tags.get_storage_endpoint_tags(endpoint)
            )
            results.append(CephAdminEndpoint(**payload))
        return results

    @staticmethod
    def get_access(
        endpoint: StorageEndpoint,
        *,
        probe: bool = False,
    ) -> CephAdminEndpointAccess:
        supervision = endpoint.service_identity("supervision")
        has_supervision_credentials = bool(
            supervision
            and supervision.status == "ready"
            and supervision.access_key
            and supervision.secret_key
        )
        ceph_admin_identity = endpoint.service_identity("ceph_admin")
        admin_warning = validate_ceph_admin_service_configuration(endpoint)
        accounts_warning = None
        can_admin = admin_warning is None
        can_accounts = can_admin
        active_rgw_uid = None
        active_rgw_tenant = None
        availability_status = "misconfigured" if admin_warning else "unknown"
        availability_checked_at = None

        if probe and admin_warning is None:
            availability_checked_at = utcnow().isoformat()
            identity_probe = probe_ceph_admin_service_identity(endpoint)
            admin_warning = identity_probe.warning
            availability_status = identity_probe.status
            if identity_probe.status != "available":
                can_admin = False
                can_accounts = False
            if (
                admin_warning is None
                and ceph_admin_identity is not None
                and ceph_admin_identity.access_key
                and ceph_admin_identity.secret_key
            ):
                admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
                try:
                    admin_client = get_rgw_admin_client(
                        access_key=ceph_admin_identity.access_key,
                        secret_key=ceph_admin_identity.secret_key,
                        endpoint=admin_endpoint,
                        region=endpoint.region,
                        verify_tls=endpoint.verify_tls,
                        request_timeout_seconds=get_settings().rgw_admin_probe_timeout_seconds,
                    )
                    active_rgw_uid, active_rgw_tenant = extract_rgw_user_identity(
                        identity_probe.user_payload
                    )
                    admin_client.get_account(
                        "RGW00000000000000000",
                        allow_not_found=True,
                        allow_not_implemented=True,
                    )
                    can_accounts = admin_client.account_api_supported is True
                    if not can_accounts:
                        accounts_warning = (
                            "RGW Accounts API is not supported by this endpoint. "
                            "Other Ceph Admin operations remain available."
                        )
                except RGWAdminError:
                    can_accounts = False
                    accounts_warning = (
                        "RGW Accounts API could not be checked. "
                        "Other Ceph Admin operations remain available."
                    )

        return CephAdminEndpointAccess(
            endpoint_id=endpoint.id,
            can_admin=can_admin,
            can_accounts=can_accounts,
            can_metrics=has_supervision_credentials,
            admin_warning=admin_warning,
            accounts_warning=accounts_warning,
            active_rgw_uid=active_rgw_uid,
            active_rgw_tenant=active_rgw_tenant,
            availability_status=availability_status,
            availability_checked_at=availability_checked_at,
        )
