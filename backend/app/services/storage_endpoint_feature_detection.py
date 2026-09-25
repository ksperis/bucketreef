# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from collections.abc import Callable
from dataclasses import dataclass
from typing import Optional

import requests
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import StorageEndpoint
from app.models.storage_endpoint import (
    StorageEndpointCredentialCheck,
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatureDetectionResult,
    StorageEndpointHttpCheck,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_admin_identity import (
    classify_rgw_credential_failure,
    extract_ceph_admin_flags,
)
from app.services.storage_endpoint_admin_permissions import (
    admin_ops_permissions_from_caps,
)
from app.utils.normalize import normalize_optional_string
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint

RGWAdminClientFactory = Callable[..., RGWAdminClient]
settings = get_settings()


@dataclass(frozen=True)
class _FeatureDetectionCredentials:
    access_key: Optional[str]
    secret_key: Optional[str]

    @property
    def complete(self) -> bool:
        return bool(self.access_key and self.secret_key)

    @property
    def partial(self) -> bool:
        return bool(self.access_key or self.secret_key) and not self.complete


@dataclass(frozen=True)
class _FeatureDetectionContext:
    endpoint_url: str
    admin_endpoint: str
    region: Optional[str]
    verify_tls: bool
    admin_credentials: _FeatureDetectionCredentials
    supervision_credentials: _FeatureDetectionCredentials
    ceph_admin_credentials: _FeatureDetectionCredentials


class StorageEndpointFeatureDetector:
    def __init__(
        self,
        db: Session,
        client_factory: RGWAdminClientFactory,
    ) -> None:
        self.db = db
        self.client_factory = client_factory

    @staticmethod
    def _credentials(
        access_key: Optional[str],
        secret_key: Optional[str],
        *,
        stored_access_key: Optional[str] = None,
        stored_secret_key: Optional[str] = None,
    ) -> _FeatureDetectionCredentials:
        normalized_access_key = normalize_optional_string(access_key)
        normalized_secret_key = normalize_optional_string(secret_key)
        if (
            normalized_access_key
            and not normalized_secret_key
            and normalized_access_key == (stored_access_key or "")
        ):
            normalized_secret_key = stored_secret_key
        return _FeatureDetectionCredentials(
            normalized_access_key,
            normalized_secret_key,
        )

    @staticmethod
    def _stored_secret_reuse_allowed(
        stored_endpoint: Optional[StorageEndpoint],
        *,
        endpoint_url: str,
        admin_endpoint: str,
        region: Optional[str],
        verify_tls: bool,
    ) -> bool:
        if stored_endpoint is None:
            return False
        stored_endpoint_url = normalize_s3_endpoint(stored_endpoint.endpoint_url)
        stored_admin_endpoint = normalize_s3_endpoint(
            resolve_rgw_admin_api_endpoint(stored_endpoint)
        ) or stored_endpoint_url
        stored_region = normalize_optional_string(stored_endpoint.region)
        return (
            endpoint_url == stored_endpoint_url
            and admin_endpoint == stored_admin_endpoint
            and region == stored_region
            and verify_tls == bool(getattr(stored_endpoint, "verify_tls", True))
        )

    def _context(
        self,
        payload: StorageEndpointFeatureDetectionRequest,
    ) -> _FeatureDetectionContext:
        endpoint_url = normalize_s3_endpoint(payload.endpoint_url)
        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")

        stored_endpoint: Optional[StorageEndpoint] = None
        if payload.endpoint_id is not None:
            stored_endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == payload.endpoint_id)
                .first()
            )
            if not stored_endpoint:
                raise StorageEndpointNotFoundError("Endpoint not found.")

        region = normalize_optional_string(payload.region) or (
            normalize_optional_string(stored_endpoint.region) if stored_endpoint else None
        )
        admin_endpoint = normalize_s3_endpoint(payload.admin_endpoint) or endpoint_url
        if payload.verify_tls is not None:
            verify_tls = bool(payload.verify_tls)
        elif stored_endpoint is not None:
            verify_tls = bool(getattr(stored_endpoint, "verify_tls", True))
        else:
            verify_tls = True

        allow_stored_secret_reuse = self._stored_secret_reuse_allowed(
            stored_endpoint,
            endpoint_url=endpoint_url,
            admin_endpoint=admin_endpoint,
            region=region,
            verify_tls=verify_tls,
        )

        admin_credentials = self._credentials(
            payload.admin_access_key,
            payload.admin_secret_key,
            stored_access_key=(
                stored_endpoint.admin_access_key
                if stored_endpoint and allow_stored_secret_reuse
                else None
            ),
            stored_secret_key=(
                stored_endpoint.admin_secret_key
                if stored_endpoint and allow_stored_secret_reuse
                else None
            ),
        )
        supervision_credentials = self._credentials(
            payload.supervision_access_key,
            payload.supervision_secret_key,
            stored_access_key=(
                stored_endpoint.supervision_access_key
                if stored_endpoint and allow_stored_secret_reuse
                else None
            ),
            stored_secret_key=(
                stored_endpoint.supervision_secret_key
                if stored_endpoint and allow_stored_secret_reuse
                else None
            ),
        )
        ceph_admin_credentials = self._credentials(
            payload.ceph_admin_access_key,
            payload.ceph_admin_secret_key,
            stored_access_key=(
                stored_endpoint.ceph_admin_access_key
                if stored_endpoint and allow_stored_secret_reuse
                else None
            ),
            stored_secret_key=(
                stored_endpoint.ceph_admin_secret_key
                if stored_endpoint and allow_stored_secret_reuse
                else None
            ),
        )
        return _FeatureDetectionContext(
            endpoint_url=endpoint_url,
            admin_endpoint=admin_endpoint,
            region=region,
            verify_tls=verify_tls,
            admin_credentials=admin_credentials,
            supervision_credentials=supervision_credentials,
            ceph_admin_credentials=ceph_admin_credentials,
        )

    @staticmethod
    def _detect_http_endpoint(
        context: _FeatureDetectionContext,
        result: StorageEndpointFeatureDetectionResult,
    ) -> None:
        try:
            response = requests.get(
                context.endpoint_url,
                timeout=settings.healthcheck_timeout_seconds,
                verify=context.verify_tls,
                allow_redirects=True,
                headers={"User-Agent": "bucketreef-endpoint-validation"},
            )
            result.http_check = StorageEndpointHttpCheck(
                status="valid",
                status_code=response.status_code,
                message=f"Endpoint responded over HTTP ({response.status_code}).",
            )
        except requests.RequestException:
            result.http_check = StorageEndpointHttpCheck(
                status="unavailable",
                message="Endpoint did not respond to the HTTP connectivity check.",
            )

    @staticmethod
    def _failed_check(
        error: Exception,
        *,
        denied_message: str,
        unavailable_message: str,
    ) -> StorageEndpointCredentialCheck:
        failure = classify_rgw_credential_failure(error)
        return StorageEndpointCredentialCheck(
            status=failure,
            message=denied_message if failure == "denied" else unavailable_message,
        )

    def _client(
        self,
        context: _FeatureDetectionContext,
        credentials: _FeatureDetectionCredentials,
    ) -> RGWAdminClient:
        return self.client_factory(
            access_key=credentials.access_key,
            secret_key=credentials.secret_key,
            endpoint=context.admin_endpoint,
            region=context.region,
            verify_tls=context.verify_tls,
        )

    def _detect_admin_features(
        self,
        context: _FeatureDetectionContext,
        result: StorageEndpointFeatureDetectionResult,
    ) -> Optional[RGWAdminClient]:
        credentials = context.admin_credentials
        admin_client = None
        if credentials.complete:
            try:
                admin_client = self._client(context, credentials)
                admin_payload = admin_client.get_user_by_access_key(
                    credentials.access_key,
                    allow_not_found=True,
                )
                if admin_payload:
                    result.admin = True
                    if isinstance(admin_payload, dict):
                        result.admin_ops_permissions = admin_ops_permissions_from_caps(
                            admin_payload.get("caps")
                        )
                    result.credential_checks.admin = StorageEndpointCredentialCheck(
                        status="valid",
                        message="Admin Ops access was validated by RGW.",
                    )
                else:
                    result.admin_error = "Admin access key is not recognized by RGW."
                    result.credential_checks.admin = StorageEndpointCredentialCheck(
                        status="denied",
                        message="Admin Ops access key is not recognized by RGW.",
                    )
            except RGWAdminError as exc:
                result.admin_error = str(exc)
                result.credential_checks.admin = self._failed_check(
                    exc,
                    denied_message="Admin Ops credentials were denied by RGW.",
                    unavailable_message=(
                        "Admin Ops access could not be checked because the RGW "
                        "endpoint is unavailable."
                    ),
                )
        elif credentials.partial:
            result.admin_error = (
                "Admin detection requires both access key and secret key."
            )
            result.credential_checks.admin = StorageEndpointCredentialCheck(
                status="incomplete",
                message="Enter both the Admin Ops access key and secret key.",
            )
        return admin_client

    @staticmethod
    def _detect_account_feature(
        admin_client: Optional[RGWAdminClient],
        result: StorageEndpointFeatureDetectionResult,
    ) -> None:
        if admin_client is None:
            return
        try:
            # A not_found result still proves that the RGW account API exists.
            admin_client.get_account(
                "RGW00000000000000000",
                allow_not_found=True,
                allow_not_implemented=True,
            )
            result.account = admin_client.account_api_supported is True
            if not result.account:
                result.account_error = "RGW account API is unavailable."
        except RGWAdminError as exc:
            result.account_error = str(exc)

    def _detect_supervision_features(
        self,
        context: _FeatureDetectionContext,
        result: StorageEndpointFeatureDetectionResult,
    ) -> None:
        credentials = context.supervision_credentials
        if credentials.partial:
            message = "Supervision detection requires both access key and secret key."
            result.metrics_error = message
            result.usage_error = message
            result.credential_checks.supervision = StorageEndpointCredentialCheck(
                status="incomplete",
                message="Enter both the Supervision Ops access key and secret key.",
            )
            return
        if not credentials.complete:
            return

        supervision_client = None
        try:
            supervision_client = self._client(context, credentials)
            supervision_client.get_all_buckets(with_stats=True)
            result.metrics = True
            result.credential_checks.supervision = StorageEndpointCredentialCheck(
                status="valid",
                message="Supervision Ops access and bucket stats were validated by RGW.",
            )
        except RGWAdminError as exc:
            result.metrics_error = str(exc)
            result.credential_checks.supervision = self._failed_check(
                exc,
                denied_message="Supervision Ops credentials were denied by RGW.",
                unavailable_message=(
                    "Supervision Ops access could not be checked because the RGW "
                    "endpoint is unavailable."
                ),
            )

        if supervision_client is None:
            return
        try:
            usage_payload = supervision_client.get_usage(
                show_entries=False,
                show_summary=True,
            )
            if isinstance(usage_payload, dict) and usage_payload.get("not_found"):
                result.usage_error = "RGW usage logs endpoint is unavailable."
            elif self._usage_payload_has_values(usage_payload):
                result.usage = True
            else:
                result.usage_error = (
                    "RGW usage logs returned no data. Verify rgw_enable_usage_log is "
                    "enabled and that RGW has recorded traffic."
                )
        except RGWAdminError as exc:
            result.usage_error = str(exc)

    @staticmethod
    def _usage_payload_has_values(payload: object) -> bool:
        if isinstance(payload, list):
            return any(isinstance(item, dict) and bool(item) for item in payload)
        if not isinstance(payload, dict):
            return False
        for key in ("summary", "entries", "usage"):
            value = payload.get(key)
            if isinstance(value, list) and any(
                isinstance(item, dict) and bool(item) for item in value
            ):
                return True
        return False

    def _detect_ceph_admin_credentials(
        self,
        context: _FeatureDetectionContext,
        result: StorageEndpointFeatureDetectionResult,
    ) -> None:
        credentials = context.ceph_admin_credentials
        if credentials.partial:
            result.credential_checks.ceph_admin = StorageEndpointCredentialCheck(
                status="incomplete",
                message="Enter both the Ceph Admin access key and secret key.",
            )
            return
        if not credentials.complete:
            return

        try:
            client = self._client(context, credentials)
            user_payload = client.get_user_by_access_key(
                credentials.access_key,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            result.credential_checks.ceph_admin = self._failed_check(
                exc,
                denied_message="Ceph Admin credentials were denied by RGW.",
                unavailable_message=(
                    "Ceph Admin access could not be checked because the RGW "
                    "endpoint is unavailable."
                ),
            )
            return

        if not isinstance(user_payload, dict) or not user_payload:
            result.credential_checks.ceph_admin = StorageEndpointCredentialCheck(
                status="denied",
                message="Ceph Admin access key does not map to an RGW user.",
            )
            return
        is_admin, is_system = extract_ceph_admin_flags(user_payload)
        if not is_admin and not is_system:
            result.credential_checks.ceph_admin = StorageEndpointCredentialCheck(
                status="denied",
                message=(
                    "Ceph Admin access requires an RGW user created with --admin "
                    "or --system."
                ),
            )
            return
        result.credential_checks.ceph_admin = StorageEndpointCredentialCheck(
            status="valid",
            message="Ceph Admin access and privileges were validated by RGW.",
        )

    def detect(
        self,
        payload: StorageEndpointFeatureDetectionRequest,
    ) -> StorageEndpointFeatureDetectionResult:
        context = self._context(payload)
        result = StorageEndpointFeatureDetectionResult()
        if payload.check_http:
            self._detect_http_endpoint(context, result)
        admin_client = self._detect_admin_features(context, result)
        self._detect_account_feature(admin_client, result)
        self._detect_supervision_features(context, result)
        self._detect_ceph_admin_credentials(context, result)

        if result.metrics and not result.usage:
            result.warnings.append(
                "Usage logs returned no usable data; verify rgw_enable_usage_log is enabled and that RGW has recorded traffic."
            )
        return result
