# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Storage endpoint setup for guided administrator onboarding."""
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from sqlalchemy import select

from app.db import StorageEndpoint
from app.models.onboarding import OnboardingApply
from app.models.storage_endpoint import (
    StorageEndpointCreate,
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatures,
    StorageEndpointUpdate,
)
from app.services.onboarding_service import OnboardingError
from app.services.storage_endpoint_admin_permissions import (
    has_account_provisioning_permissions,
)
from app.utils.storage_endpoint_features import (
    normalize_features,
    resolve_feature_flags,
)


ManagementCredentialKind = Literal["admin", "runtime", "supervision", "ceph_admin"]
CredentialPair = tuple[str, str, bool]


def credential_pair(access_secret, secret_secret) -> tuple[str, str]:
    access = access_secret.get_secret_value() if access_secret else ""
    secret = secret_secret.get_secret_value() if secret_secret else ""
    if bool(access) != bool(secret):
        raise OnboardingError("credentials_required")
    return access, secret


@dataclass(frozen=True)
class _EndpointRequirements:
    account_api: bool
    ceph_admin: bool
    ceph: bool
    admin_credentials: bool


@dataclass(frozen=True)
class _EndpointCredentials:
    admin: CredentialPair = ("", "", False)
    runtime: CredentialPair = ("", "", False)
    supervision: CredentialPair = ("", "", False)
    ceph_admin: CredentialPair = ("", "", False)

    @property
    def supplied(self) -> bool:
        return any(
            pair[2]
            for pair in (
                self.admin,
                self.runtime,
                self.supervision,
                self.ceph_admin,
            )
        )


class OnboardingEndpointSetupService:
    def __init__(self, progress):
        self.progress = progress
        self.db = progress.db
        self.endpoints = progress.endpoints

    def _management_credentials(
        self,
        payload: OnboardingApply,
        endpoint: StorageEndpoint | None,
        kind: ManagementCredentialKind,
        required_code: str,
        *,
        required: bool = True,
    ) -> tuple[str, str, bool]:
        secret_pair = {
            "admin": (payload.admin_access_key, payload.admin_secret_key),
            "runtime": (payload.runtime_access_key, payload.runtime_secret_key),
            "supervision": (payload.supervision_access_key, payload.supervision_secret_key),
            "ceph_admin": (payload.ceph_admin_access_key, payload.ceph_admin_secret_key),
        }[kind]
        access, secret = credential_pair(*secret_pair)
        if access:
            return access, secret, True
        if endpoint is not None:
            if kind == "admin":
                stored_access = endpoint.admin_access_key or ""
                stored_secret = endpoint.admin_secret_key or ""
            else:
                identity = endpoint.service_identity(kind)
                if identity is None:
                    stored_access = ""
                    stored_secret = ""
                else:
                    stored_access = identity.access_key or ""
                    stored_secret = identity.secret_key or ""
            if stored_access and stored_secret:
                return stored_access, stored_secret, False
        if required:
            raise OnboardingError(required_code)
        return "", "", False

    def _detect(self, draft, endpoint, admin, supervision, ceph_admin=("", "", False)):
        payload = StorageEndpointFeatureDetectionRequest(
            endpoint_id=endpoint.id if endpoint else None,
            endpoint_url=endpoint.endpoint_url if endpoint else draft.endpoint_url,
            region=endpoint.region if endpoint else (draft.region or None),
            verify_tls=endpoint.verify_tls if endpoint else True,
            admin_access_key=admin[0] or None,
            admin_secret_key=admin[1] or None,
            ceph_admin_access_key=ceph_admin[0] or None,
            ceph_admin_secret_key=ceph_admin[1] or None,
            supervision_access_key=supervision[0] or None,
            supervision_secret_key=supervision[1] or None,
        )
        return self.endpoints.detect_features(payload)

    @staticmethod
    def _endpoint_requirements(draft, payload) -> _EndpointRequirements:
        account_api = draft.manager or draft.portal
        ceph_admin = draft.ceph_admin
        ceph = account_api or draft.supervision or ceph_admin
        admin_credentials = account_api or (
            draft.supervision and payload.service_identity_mode == "managed"
        )
        return _EndpointRequirements(
            account_api=account_api,
            ceph_admin=ceph_admin,
            ceph=ceph,
            admin_credentials=admin_credentials,
        )

    def _endpoint_credentials(
        self,
        payload,
        endpoint,
        requirements: _EndpointRequirements,
        *,
        supervision_required: bool,
    ) -> _EndpointCredentials:
        ceph_admin = (
            self._management_credentials(
                payload,
                endpoint,
                "ceph_admin",
                "ceph_admin_credentials_required",
            )
            if requirements.ceph_admin
            else ("", "", False)
        )
        admin = (
            self._management_credentials(
                payload,
                endpoint,
                "admin",
                "endpoint_admin_credentials_required",
                required=requirements.admin_credentials,
            )
            if requirements.ceph
            else ("", "", False)
        )
        runtime = ("", "", False)
        supervision = ("", "", False)
        if requirements.ceph and payload.service_identity_mode == "external":
            runtime = self._management_credentials(
                payload,
                endpoint,
                "runtime",
                "runtime_credentials_required",
                required=requirements.account_api,
            )
            supervision = self._management_credentials(
                payload,
                endpoint,
                "supervision",
                "supervision_credentials_required",
                required=supervision_required,
            )
        return _EndpointCredentials(
            admin=admin,
            runtime=runtime,
            supervision=supervision,
            ceph_admin=ceph_admin,
        )

    def _resolve_endpoint(
        self,
        resources,
        draft,
        requirements: _EndpointRequirements,
    ) -> StorageEndpoint | None:
        endpoint_id = resources.get("endpoint_id") or draft.endpoint_id
        endpoint = self.db.get(StorageEndpoint, endpoint_id) if endpoint_id else None
        if endpoint_id and endpoint is None:
            raise OnboardingError("endpoint_unavailable")
        if endpoint is not None and requirements.ceph and endpoint.provider != "ceph":
            raise OnboardingError("ceph_endpoint_required")
        return endpoint

    @staticmethod
    def _validate_endpoint_detection(
        draft,
        payload,
        requirements: _EndpointRequirements,
        detection,
    ) -> None:
        if requirements.account_api:
            if detection.credential_checks.admin.status != "valid" or not detection.admin:
                raise OnboardingError("endpoint_credentials_invalid")
            if not has_account_provisioning_permissions(detection.admin_ops_permissions):
                raise OnboardingError("admin_ops_permissions_insufficient")
            if not detection.account:
                raise OnboardingError("account_api_unavailable")
        if draft.supervision and payload.service_identity_mode == "external" and (
            detection.credential_checks.supervision.status != "valid"
            or not detection.metrics
        ):
            raise OnboardingError("supervision_credentials_invalid")
        if (
            requirements.ceph_admin
            and detection.credential_checks.ceph_admin.status != "valid"
        ):
            raise OnboardingError("ceph_identity_denied")

    def _detect_endpoint_capabilities(
        self,
        draft,
        payload,
        endpoint: StorageEndpoint | None,
        requirements: _EndpointRequirements,
        credentials: _EndpointCredentials,
    ):
        if not requirements.ceph:
            return None
        detection = self._detect(
            draft,
            endpoint,
            credentials.admin,
            credentials.supervision,
            credentials.ceph_admin,
        )
        self._validate_endpoint_detection(
            draft,
            payload,
            requirements,
            detection,
        )
        return detection

    @staticmethod
    def _new_endpoint_features(
        draft,
        requirements: _EndpointRequirements,
        detection,
    ) -> StorageEndpointFeatures:
        return StorageEndpointFeatures.model_validate(
            {
                "admin": {"enabled": requirements.account_api},
                "account": {"enabled": requirements.account_api},
                "usage": {
                    "enabled": bool(
                        draft.supervision and detection and detection.usage
                    )
                },
                "metrics": {"enabled": draft.supervision},
            }
        )

    @classmethod
    def _new_endpoint_payload(
        cls,
        *,
        endpoint_name: str,
        draft,
        payload,
        requirements: _EndpointRequirements,
        credentials: _EndpointCredentials,
        detection,
    ) -> StorageEndpointCreate:
        features = cls._new_endpoint_features(draft, requirements, detection)
        return StorageEndpointCreate(
            name=endpoint_name,
            endpoint_url=draft.endpoint_url,
            region=draft.region or None,
            force_path_style=draft.force_path_style,
            verify_tls=True,
            provider="ceph" if requirements.ceph else "other",
            service_identity_mode=payload.service_identity_mode,
            runtime_access_key=credentials.runtime[0] or None,
            runtime_secret_key=credentials.runtime[1] or None,
            ceph_admin_allowed=requirements.ceph_admin,
            admin_access_key=credentials.admin[0] or None,
            admin_secret_key=credentials.admin[1] or None,
            ceph_admin_access_key=credentials.ceph_admin[0] or None,
            ceph_admin_secret_key=credentials.ceph_admin[1] or None,
            supervision_access_key=credentials.supervision[0] or None,
            supervision_secret_key=credentials.supervision[1] or None,
            features=features,
        )

    def _create_endpoint(
        self,
        actor,
        row,
        draft,
        payload,
        resources,
        requirements: _EndpointRequirements,
        credentials: _EndpointCredentials,
        detection,
    ) -> StorageEndpoint:
        endpoint_name = resources.get("endpoint_name") or self._unique_endpoint_name(
            draft.endpoint_url
        )
        if not resources.get("endpoint_name"):
            self.progress.checkpoint(row, endpoint_name=endpoint_name)
        endpoint_payload = self._new_endpoint_payload(
            endpoint_name=endpoint_name,
            draft=draft,
            payload=payload,
            requirements=requirements,
            credentials=credentials,
            detection=detection,
        )
        created = self.endpoints.create_endpoint(endpoint_payload)
        self.progress.checkpoint(row, endpoint_id=created.id)
        endpoint = self.db.get(StorageEndpoint, created.id)
        self.progress.audit(actor, "endpoint_created", row.id, endpoint_id=endpoint.id)
        return endpoint

    @staticmethod
    def _required_endpoint_feature_fields(
        draft,
        endpoint: StorageEndpoint,
        requirements: _EndpointRequirements,
        detection,
        *,
        editable: bool,
    ) -> list[str]:
        flags = resolve_feature_flags(endpoint)
        feature_fields: list[str] = []
        if requirements.account_api and not (
            flags.admin_enabled and flags.account_enabled
        ):
            feature_fields.extend(["admin", "account"])
        if draft.supervision:
            if not flags.metrics_enabled:
                feature_fields.append("metrics")
            if editable and detection.usage and not flags.usage_enabled:
                feature_fields.append("usage")
        if feature_fields and not editable:
            raise OnboardingError("endpoint_features_locked")
        return feature_fields

    @staticmethod
    def _endpoint_identity_updates(
        draft,
        payload,
        endpoint: StorageEndpoint,
        requirements: _EndpointRequirements,
        credentials: _EndpointCredentials,
    ) -> tuple[dict[str, object], list[str]]:
        update: dict[str, object] = {}
        runtime_identity = endpoint.service_identity("runtime")
        current_identity_mode = (
            runtime_identity.mode if runtime_identity is not None else "managed"
        )
        if (
            requirements.account_api or draft.supervision
        ) and payload.service_identity_mode != current_identity_mode:
            update["service_identity_mode"] = payload.service_identity_mode
        if credentials.runtime[2]:
            update.update(
                runtime_access_key=credentials.runtime[0],
                runtime_secret_key=credentials.runtime[1],
            )
        if requirements.ceph_admin and not endpoint.ceph_admin_allowed:
            update["ceph_admin_allowed"] = True

        credential_kinds: list[str] = []
        credential_updates = (
            ("ceph_admin", credentials.ceph_admin),
            ("admin", credentials.admin),
            ("supervision", credentials.supervision),
        )
        for kind, pair in credential_updates:
            if not pair[2]:
                continue
            update[f"{kind}_access_key"] = pair[0]
            update[f"{kind}_secret_key"] = pair[1]
            credential_kinds.append(kind)
        return update, credential_kinds

    @staticmethod
    def _append_endpoint_feature_updates(
        endpoint: StorageEndpoint,
        update: dict[str, object],
        feature_fields: list[str],
    ) -> None:
        if not feature_fields:
            return
        features = normalize_features(
            endpoint.provider,
            endpoint.features,
            endpoint.region,
        )
        for field in feature_fields:
            features[field]["enabled"] = True
        update["features"] = features

    def _update_endpoint(
        self,
        actor,
        row,
        draft,
        payload,
        endpoint: StorageEndpoint,
        requirements: _EndpointRequirements,
        credentials: _EndpointCredentials,
        detection,
        *,
        editable: bool,
    ) -> StorageEndpoint:
        feature_fields = self._required_endpoint_feature_fields(
            draft,
            endpoint,
            requirements,
            detection,
            editable=editable,
        )
        update, credential_kinds = self._endpoint_identity_updates(
            draft,
            payload,
            endpoint,
            requirements,
            credentials,
        )
        self._append_endpoint_feature_updates(endpoint, update, feature_fields)

        if update:
            self.endpoints.update_endpoint(
                endpoint.id,
                StorageEndpointUpdate(**update),
            )
            endpoint = self.db.get(StorageEndpoint, endpoint.id)
        if credential_kinds:
            self.progress.audit(
                actor,
                "endpoint_credentials_configured",
                row.id,
                endpoint_id=endpoint.id,
                credential_kinds=credential_kinds,
            )
        if feature_fields:
            self.progress.audit(
                actor,
                "endpoint_features_enabled",
                row.id,
                endpoint_id=endpoint.id,
                features=feature_fields,
            )
        return endpoint

    def _verify_endpoint_identities(
        self,
        actor,
        row,
        draft,
        endpoint: StorageEndpoint,
        requirements: _EndpointRequirements,
        credentials: _EndpointCredentials,
        *,
        editable: bool,
    ) -> None:
        if requirements.ceph:
            self.endpoints.reconcile_identities(endpoint.id)
        if requirements.ceph_admin:
            ceph_identity = endpoint.service_identity("ceph_admin")
            if (
                ceph_identity is None
                or ceph_identity.mode != "external"
                or ceph_identity.status != "ready"
            ):
                raise OnboardingError("ceph_identity_denied")
        if requirements.account_api:
            runtime_identity = endpoint.service_identity("runtime")
            if runtime_identity is None or runtime_identity.status != "ready":
                raise OnboardingError("runtime_credentials_invalid")
        if not draft.supervision:
            return

        supervision_identity = endpoint.service_identity("supervision")
        if supervision_identity is None or supervision_identity.status != "ready":
            raise OnboardingError("supervision_credentials_invalid")
        # Managed Supervision only exists after provisioning. Discover Usage
        # with that identity before enabling the selected monitoring workflow.
        if editable and not resolve_feature_flags(endpoint).usage_enabled:
            detection = self._detect(
                draft,
                endpoint,
                credentials.admin,
                ("", "", False),
            )
            if detection.usage:
                self.enable_features(endpoint, "usage")
                self.progress.audit(
                    actor,
                    "endpoint_features_enabled",
                    row.id,
                    endpoint_id=endpoint.id,
                    features=["usage"],
                )

    def prepare(self, actor, row, draft, payload):
        resources = row.resources
        requirements = self._endpoint_requirements(draft, payload)
        endpoint = self._resolve_endpoint(resources, draft, requirements)

        credentials = self._endpoint_credentials(
            payload,
            endpoint,
            requirements,
            supervision_required=draft.supervision,
        )
        editable = endpoint is None or (
            endpoint.is_editable and not self.endpoints.env_endpoints_locked()
        )
        if endpoint is not None and credentials.supplied and not editable:
            raise OnboardingError("endpoint_credentials_locked")

        detection = self._detect_endpoint_capabilities(
            draft,
            payload,
            endpoint,
            requirements,
            credentials,
        )

        if endpoint is None:
            endpoint = self._create_endpoint(
                actor,
                row,
                draft,
                payload,
                resources,
                requirements,
                credentials,
                detection,
            )
        else:
            endpoint = self._update_endpoint(
                actor,
                row,
                draft,
                payload,
                endpoint,
                requirements,
                credentials,
                detection,
                editable=editable,
            )

        self._verify_endpoint_identities(
            actor,
            row,
            draft,
            endpoint,
            requirements,
            credentials,
            editable=editable,
        )
        return endpoint

    def enable_features(self, endpoint, *fields):
        features = normalize_features(
            endpoint.provider, endpoint.features, endpoint.region
        )
        for field in fields:
            features[field]["enabled"] = True
        self.endpoints.update_endpoint(
            endpoint.id,
            StorageEndpointUpdate(features=features),
        )

    def _unique_endpoint_name(self, endpoint_url):
        hostname = urlsplit(endpoint_url).hostname or "Ceph RGW"
        base = hostname
        candidate = base
        index = 2
        while self.db.scalar(
            select(StorageEndpoint.id).where(StorageEndpoint.name == candidate)
        ):
            candidate = f"{base} {index}"
            index += 1
        return candidate
