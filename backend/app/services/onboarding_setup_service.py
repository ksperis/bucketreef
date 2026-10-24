# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Setup orchestration for the guided administrator onboarding."""
import json
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from sqlalchemy import select

from app.db import S3Account, S3Connection, StorageEndpoint, UserS3Account
from app.models.onboarding import OnboardingApply
from app.models.s3_account import S3AccountCreate
from app.models.s3_connection import S3ConnectionCreate
from app.models.storage_endpoint import (
    StorageEndpointCreate,
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatures,
    StorageEndpointUpdate,
)
from app.models.user import UserUpdate
from app.services.app_settings_service import (
    enable_onboarding_features,
    load_app_settings_for_db,
)
from app.services.managed_resource_naming import onboarding_sample_account_name
from app.services.onboarding_service import OnboardingError, REQUIRED_FEATURES
from app.services.portal_access_service import resolve_portal_account_access
from app.services.portal_service import get_portal_service
from app.services.rgw_iam import get_iam_client
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_client import require_s3_execution_credentials
from app.services.storage_endpoint_admin_permissions import (
    has_account_provisioning_permissions,
)
from app.services.users_service import get_users_service
from app.utils.rgw_identifiers import generate_rgw_account_id
from app.utils.storage_endpoint_features import (
    dump_features_config,
    normalize_features_config,
    resolve_feature_flags,
)
from app.utils.time import utcnow


ManagementCredentialKind = Literal["admin", "runtime", "supervision", "ceph_admin"]
CredentialPair = tuple[str, str, bool]


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


class OnboardingSetupService:
    def __init__(self, progress):
        self.progress = progress
        self.db = progress.db
        self.endpoints = progress.endpoints

    @staticmethod
    def _pair(access_secret, secret_secret):
        access = access_secret.get_secret_value() if access_secret else ""
        secret = secret_secret.get_secret_value() if secret_secret else ""
        if bool(access) != bool(secret):
            raise OnboardingError("credentials_required")
        return access, secret

    def _management_credentials(
        self,
        payload: OnboardingApply,
        endpoint: StorageEndpoint | None,
        kind: ManagementCredentialKind,
        required_code: str,
        *,
        required: bool = True,
    ) -> tuple[str, str, bool]:
        credential_pair = {
            "admin": (payload.admin_access_key, payload.admin_secret_key),
            "runtime": (payload.runtime_access_key, payload.runtime_secret_key),
            "supervision": (payload.supervision_access_key, payload.supervision_secret_key),
            "ceph_admin": (payload.ceph_admin_access_key, payload.ceph_admin_secret_key),
        }[kind]
        access, secret = self._pair(*credential_pair)
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

    def _private_credentials(self, payload):
        access, secret = self._pair(payload.private_access_key, payload.private_secret_key)
        if not access:
            raise OnboardingError("private_credentials_required")
        return access, secret

    def configure(self, actor, row, payload):
        draft = self.progress.draft(row)
        self.endpoints.actor = actor
        endpoint = self._prepare_endpoint(actor, row, draft, payload)
        draft = self.progress.draft(row)

        account = None
        if draft.manager or draft.portal:
            account = self._account(actor, row, endpoint)
            if draft.portal:
                self._ensure_portal_iam(actor, row, endpoint, account)
            self._assign_account_access(actor, row, draft, account)
            if draft.portal:
                access = resolve_portal_account_access(self.db, actor, account.id)
                get_portal_service(self.db).get_portal_credentials(
                    actor, account, access.portal_role
                )

        if draft.private_connection:
            self._private_connection(actor, row, endpoint, payload)

        if draft.ceph_admin and not actor.can_access_ceph_admin:
            get_users_service(self.db).update_user(
                actor.id, UserUpdate(can_access_ceph_admin=True)
            )
            self.progress.audit(
                actor,
                "access_assigned",
                row.id,
                beneficiary_user_id=actor.id,
                workspace="ceph-admin",
                endpoint_id=endpoint.id,
            )

        fields: list[str] = []
        for option in draft.selected_options:
            for field in REQUIRED_FEATURES[option]:
                if field not in fields:
                    fields.append(field)
        features = enable_onboarding_features(self.db, tuple(fields))
        if features:
            self.progress.audit(actor, "features_enabled", row.id, features=features)

        row.configured_at = utcnow()
        row.updated_at = utcnow()
        row.pending_step = None
        self.db.commit()
        self.progress.audit(
            actor,
            "configured",
            row.id,
            endpoint_id=endpoint.id,
            account_id=account.id if account else None,
            options=list(draft.selected_options),
        )

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

    @staticmethod
    def _new_endpoint_features(
        draft,
        requirements: _EndpointRequirements,
        detection,
    ) -> StorageEndpointFeatures:
        features = StorageEndpointFeatures()
        features.admin.enabled = requirements.account_api
        features.account.enabled = requirements.account_api
        features.usage.enabled = bool(
            draft.supervision and detection and detection.usage
        )
        features.metrics.enabled = draft.supervision
        return features

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
            features_config=dump_features_config(features.model_dump()),
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
        features = normalize_features_config(
            endpoint.provider,
            endpoint.features_config,
            endpoint.region,
        )
        for field in feature_fields:
            features[field]["enabled"] = True
        update["features_config"] = dump_features_config(features)

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
                self._enable_endpoint_features(endpoint, "usage")
                self.progress.audit(
                    actor,
                    "endpoint_features_enabled",
                    row.id,
                    endpoint_id=endpoint.id,
                    features=["usage"],
                )

    def _prepare_endpoint(self, actor, row, draft, payload):
        resources = json.loads(row.resources_json)
        endpoint_id = resources.get("endpoint_id") or draft.endpoint_id
        endpoint = self.db.get(StorageEndpoint, endpoint_id) if endpoint_id else None
        if endpoint_id and endpoint is None:
            raise OnboardingError("endpoint_unavailable")
        requirements = self._endpoint_requirements(draft, payload)
        if endpoint is not None and requirements.ceph and endpoint.provider != "ceph":
            raise OnboardingError("ceph_endpoint_required")

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

        detection = None
        if requirements.ceph:
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

    def _enable_endpoint_features(self, endpoint, *fields):
        features = normalize_features_config(
            endpoint.provider, endpoint.features_config, endpoint.region
        )
        for field in fields:
            features[field]["enabled"] = True
        self.endpoints.update_endpoint(
            endpoint.id,
            StorageEndpointUpdate(features_config=dump_features_config(features)),
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

    def _unique_account_name(self, rgw_account_id: str):
        # RGW account names are globally unique on the endpoint, including
        # accounts left behind by an interrupted setup that are not present in
        # BucketReef's local database. Derive the sample name from the durable
        # account id so retries keep the same name and new journeys do not
        # collide with those remote accounts.
        base = onboarding_sample_account_name(rgw_account_id)
        candidate = base
        index = 2
        while self.db.scalar(select(S3Account.id).where(S3Account.name == candidate)):
            candidate = f"{base}-{index}"
            index += 1
        return candidate

    def _account(self, actor, row, endpoint):
        resources = json.loads(row.resources_json)
        if resources.get("account_id"):
            account = self.db.get(S3Account, resources["account_id"])
            if account is None:
                raise OnboardingError("account_unavailable")
            return account

        identifier = resources.get("rgw_account_id")
        if not identifier:
            prefix = load_app_settings_for_db(self.db).general.rgw_account_id_prefix
            identifier = generate_rgw_account_id(prefix)
            self.progress.checkpoint(row, rgw_account_id=identifier)
            resources = json.loads(row.resources_json)

        account_name = resources.get("account_name")
        if not account_name:
            account_name = self._unique_account_name(identifier)
            self.progress.checkpoint(row, account_name=account_name)

        row.pending_step = "account"
        self.db.commit()
        created = get_s3_accounts_service(self.db).ensure_provisioned_account(
            S3AccountCreate(name=account_name, storage_endpoint_id=endpoint.id),
            identifier,
        )
        self.progress.checkpoint(row, account_id=created.id)
        self.progress.audit(
            actor,
            "account_created",
            row.id,
            account_id=created.id,
            endpoint_id=endpoint.id,
        )
        return self.db.get(S3Account, created.id)

    def _ensure_portal_iam(self, actor, row, endpoint, account):
        if resolve_feature_flags(endpoint).iam_enabled:
            return
        if not endpoint.is_editable or self.endpoints.env_endpoints_locked():
            raise OnboardingError("endpoint_features_locked")
        access, secret = require_s3_execution_credentials(
            account, error_message="Account credentials are required"
        )
        client = get_iam_client(
            access,
            secret,
            endpoint=endpoint.endpoint_url,
            region=endpoint.region,
            verify_tls=endpoint.verify_tls,
        )
        client.list_users(MaxItems=1)
        self._enable_endpoint_features(endpoint, "iam")
        self.progress.audit(
            actor,
            "endpoint_features_enabled",
            row.id,
            endpoint_id=endpoint.id,
            features=["iam"],
        )

    def _assign_account_access(self, actor, row, draft, account):
        users = get_users_service(self.db)
        users.assign_user_to_account(
            actor.id,
            account.id,
            manager_role="account_administrator" if draft.manager else None,
            portal_role="portal_manager" if draft.portal else None,
        )
        link = self.db.scalars(
            select(UserS3Account).where(
                UserS3Account.user_id == actor.id,
                UserS3Account.account_id == account.id,
            )
        ).one()
        if draft.manager and not link.allow_manager_browser_data_access:
            link.allow_manager_browser_data_access = True
            link.updated_at = utcnow()
            self.db.commit()
        self.progress.audit(
            actor,
            "access_assigned",
            row.id,
            account_id=account.id,
            beneficiary_user_id=actor.id,
            manager=draft.manager,
            portal=draft.portal,
            manager_browser=draft.manager,
        )

    def _unique_connection_name(self, actor_id):
        base = "My S3 access"
        candidate = base
        index = 2
        while (
            self.db.scalar(
                select(S3Connection.id).where(
                    S3Connection.created_by_user_id == actor_id,
                    S3Connection.name == candidate,
                    S3Connection.is_shared.is_(False),
                )
            )
        ):
            candidate = f"{base} {index}"
            index += 1
        return candidate

    def _private_connection(self, actor, row, endpoint, payload):
        resources = json.loads(row.resources_json)
        if resources.get("connection_id"):
            if self.db.get(S3Connection, resources["connection_id"]) is None:
                raise OnboardingError("connection_unavailable")
            return

        access, secret = self._private_credentials(payload)
        if not actor.can_create_manual_private_connections:
            get_users_service(self.db).update_user(
                actor.id, UserUpdate(can_create_manual_private_connections=True)
            )
            self.progress.audit(
                actor,
                "access_assigned",
                row.id,
                beneficiary_user_id=actor.id,
                capability="can_create_manual_private_connections",
            )

        connection_name = self._unique_connection_name(actor.id)
        connection = S3ConnectionsService(self.db).create(
            actor.id,
            S3ConnectionCreate(
                name=connection_name,
                storage_endpoint_id=endpoint.id,
                access_key_id=access,
                secret_access_key=secret,
                access_browser=True,
                access_manager=True,
            ),
            commit=False,
        )
        self.progress.checkpoint(row, connection_id=connection.id)
        self.progress.audit(
            actor,
            "private_connection_created",
            row.id,
            beneficiary_user_id=actor.id,
            endpoint_id=endpoint.id,
        )
