# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import S3Account, StorageEndpoint, StorageProvider
from app.services.rgw_admin import RGWAdminClient
from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features,
    resolve_admin_endpoint,
)


logger = logging.getLogger(__name__)


class S3AccountRgwContextService:
    """Resolve RGW endpoint capabilities and Admin Ops clients for S3 accounts."""

    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def endpoint_capabilities(endpoint: StorageEndpoint) -> dict[str, bool]:
        features = normalize_features(endpoint.provider, endpoint.features)
        return features_to_capabilities(features)

    def resolve_storage_endpoint(
        self,
        storage_endpoint_id: int,
        require_ceph: bool = False,
    ) -> StorageEndpoint:
        endpoint = self.db.scalar(
            select(StorageEndpoint).where(StorageEndpoint.id == storage_endpoint_id)
        )
        if not endpoint:
            raise StorageEndpointNotFoundError("Storage endpoint not found.")
        if require_ceph and endpoint.provider != StorageProvider.CEPH.value:
            raise ValueError("This endpoint is not a Ceph endpoint.")
        return endpoint

    @staticmethod
    def admin_for_endpoint(
        endpoint: StorageEndpoint,
        allow_missing: bool = False,
    ) -> Optional[RGWAdminClient]:
        if endpoint.provider != StorageProvider.CEPH.value:
            if allow_missing:
                return None
            raise ValueError("This endpoint does not support Ceph admin operations.")
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            if allow_missing:
                return None
            raise ValueError("Admin operations are disabled for this endpoint.")
        try:
            return get_endpoint_admin_rgw_client(endpoint)
        except Exception as exc:
            if allow_missing:
                logger.warning(
                    "Unable to build RGW admin client for endpoint %s: %s",
                    endpoint.name,
                    exc,
                )
                return None
            raise

    def admin_for_account(
        self,
        account: S3Account,
        allow_missing: bool = False,
    ) -> Optional[RGWAdminClient]:
        endpoint = self.resolve_storage_endpoint(account.storage_endpoint_id)
        return self.admin_for_endpoint(endpoint, allow_missing=allow_missing)
