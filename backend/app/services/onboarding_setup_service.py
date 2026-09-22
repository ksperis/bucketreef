# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Setup orchestration for the two-step administrator onboarding."""
import json
from urllib.parse import urlsplit
from uuid import uuid4

from app.db import S3Account, S3Connection, StorageEndpoint, UserS3Account
from app.models.s3_account import S3AccountCreate
from app.models.s3_connection import S3ConnectionCreate
from app.models.storage_endpoint import (
    StorageEndpointCreate,
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatures,
    StorageEndpointUpdate,
)
from app.models.user import UserUpdate
from app.services.app_settings_service import enable_onboarding_features
from app.services.onboarding_service import OnboardingError, REQUIRED_FEATURES
from app.services.portal_access_service import resolve_portal_account_access
from app.services.portal_service import get_portal_service
from app.services.rgw_iam import get_iam_client
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_client import require_s3_execution_credentials
from app.services.users_service import get_users_service
from app.utils.storage_endpoint_features import (
    dump_features_config,
    normalize_features_config,
    resolve_feature_flags,
)
from app.utils.time import utcnow


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

    def _endpoint_credentials(self, payload, *, required=False):
        access, secret = self._pair(
            payload.endpoint_access_key, payload.endpoint_secret_key
        )
        if required and not access:
            raise OnboardingError("endpoint_admin_credentials_required")
        return access, secret

    def _private_credentials(self, payload):
        access, secret = self._pair(payload.private_access_key, payload.private_secret_key)
        if not access:
            raise OnboardingError("private_credentials_required")
        return access, secret

    def configure(self, actor, row, payload, preview):
        draft = self.progress.draft(row)
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
            self._private_connection(actor, row, draft, endpoint, payload)

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

    def _detect(self, draft, endpoint, access, secret):
        payload = StorageEndpointFeatureDetectionRequest(
            endpoint_id=endpoint.id if endpoint else None,
            endpoint_url=endpoint.endpoint_url if endpoint else draft.endpoint_url,
            region=endpoint.region if endpoint else (draft.region or None),
            verify_tls=endpoint.verify_tls if endpoint else True,
            admin_access_key=access or None,
            admin_secret_key=secret or None,
            ceph_admin_access_key=(access or None) if draft.ceph_admin and endpoint is None else None,
            ceph_admin_secret_key=(secret or None) if draft.ceph_admin and endpoint is None else None,
        )
        return self.endpoints.detect_features(payload)

    def _prepare_endpoint(self, actor, row, draft, payload):
        resources = json.loads(row.resources_json)
        endpoint_id = resources.get("endpoint_id") or draft.endpoint_id
        endpoint = self.db.get(StorageEndpoint, endpoint_id) if endpoint_id else None
        if endpoint_id and endpoint is None:
            raise OnboardingError("endpoint_unavailable")
        if endpoint is not None and (
            draft.manager or draft.portal or draft.ceph_admin
        ) and endpoint.provider != "ceph":
            raise OnboardingError("ceph_endpoint_required")

        needs_account_api = draft.manager or draft.portal
        if endpoint is None:
            access, secret = self._endpoint_credentials(
                payload, required=needs_account_api or draft.ceph_admin
            )
        else:
            access = secret = ""

        detection = self._detect(draft, endpoint, access, secret)
        if needs_account_api and not (detection.admin and detection.account):
            raise OnboardingError("account_api_unavailable")
        if draft.ceph_admin and detection.credential_checks.ceph_admin.status != "valid":
            raise OnboardingError("ceph_identity_denied")
        if endpoint is None and access and detection.credential_checks.admin.status != "valid":
            if needs_account_api or draft.ceph_admin:
                raise OnboardingError("endpoint_credentials_invalid")
            # Admin credentials are optional for a private-only setup. If the
            # probe rejects them, do not persist unusable credentials on the
            # newly created endpoint.
            access = secret = ""

        if endpoint is None:
            features = StorageEndpointFeatures()
            features.admin.enabled = detection.admin
            features.account.enabled = detection.account
            endpoint_name = resources.get("endpoint_name") or self._unique_endpoint_name(
                draft.endpoint_url
            )
            if not resources.get("endpoint_name"):
                self.progress.checkpoint(row, endpoint_name=endpoint_name)
            endpoint_payload = StorageEndpointCreate(
                name=endpoint_name,
                endpoint_url=draft.endpoint_url,
                region=draft.region or None,
                force_path_style=draft.force_path_style,
                verify_tls=True,
                provider="ceph",
                admin_access_key=access or None,
                admin_secret_key=secret or None,
                ceph_admin_access_key=access if draft.ceph_admin else None,
                ceph_admin_secret_key=secret if draft.ceph_admin else None,
                features_config=dump_features_config(features.model_dump()),
            )
            created = self.endpoints.create_endpoint(endpoint_payload, commit=False)
            self.progress.checkpoint(row, endpoint_id=created.id)
            endpoint = self.db.get(StorageEndpoint, created.id)
            self.progress.audit(
                actor, "endpoint_created", row.id, endpoint_id=endpoint.id
            )
        elif needs_account_api:
            flags = resolve_feature_flags(endpoint)
            if not (flags.admin_enabled and flags.account_enabled):
                self._enable_endpoint_features(endpoint, "admin", "account")
                self.progress.audit(
                    actor,
                    "endpoint_features_enabled",
                    row.id,
                    endpoint_id=endpoint.id,
                    features=["admin", "account"],
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
        while self.db.query(StorageEndpoint.id).filter_by(name=candidate).first():
            candidate = f"{base} {index}"
            index += 1
        return candidate

    def _unique_account_name(self):
        base = "BucketReef sample"
        candidate = base
        index = 2
        while self.db.query(S3Account.id).filter_by(name=candidate).first():
            candidate = f"{base} {index}"
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
            identifier = f"RGW{uuid4().int % (10 ** 17):017d}"
            self.progress.checkpoint(row, rgw_account_id=identifier)
            resources = json.loads(row.resources_json)

        account_name = resources.get("account_name")
        if not account_name:
            account_name = self._unique_account_name()
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
        link = (
            self.db.query(UserS3Account)
            .filter_by(user_id=actor.id, account_id=account.id)
            .one()
        )
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
            self.db.query(S3Connection.id)
            .filter_by(
                created_by_user_id=actor_id, name=candidate, is_shared=False
            )
            .first()
        ):
            candidate = f"{base} {index}"
            index += 1
        return candidate

    def _private_connection(self, actor, row, draft, endpoint, payload):
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
