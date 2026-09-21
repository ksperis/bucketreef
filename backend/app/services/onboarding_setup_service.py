# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Minimal setup orchestration and explicit, bounded usage checks."""
import json
from uuid import uuid4

from app.db import S3Account, S3Connection, StorageEndpoint, UserS3Account
from app.models.s3_account import S3AccountCreate
from app.models.s3_connection import S3ConnectionCreate, S3ConnectionUpdate
from app.models.storage_endpoint import (
    StorageEndpointCreate, StorageEndpointUpdate, StorageEndpointFeatures,
    StorageEndpointFeatureDetectionRequest,
)
from app.models.user import UserUpdate
from app.services.app_settings_service import enable_onboarding_features
from app.services.onboarding_service import OnboardingError, REQUIRED_FEATURES
from app.services.portal_access_service import resolve_portal_account_access
from app.services.portal_service import get_portal_service
from app.services.rgw_admin_identity import extract_ceph_admin_flags
from app.services.rgw_admin import get_rgw_admin_client
from app.services.rgw_iam import get_iam_client
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_client import get_s3_client
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_client import require_s3_execution_credentials, s3_execution_client_kwargs
from app.services.s3_execution_context import S3ExecutionContext
from app.services.users_service import get_users_service
from app.utils.storage_endpoint_features import (
    dump_features_config, normalize_features_config, resolve_feature_flags,
    resolve_rgw_admin_api_endpoint,
)
from app.utils.time import utcnow


class OnboardingSetupService:
    def __init__(self, progress):
        self.progress = progress
        self.db = progress.db
        self.endpoints = progress.endpoints

    @staticmethod
    def credentials(payload):
        access = payload.access_key.get_secret_value() if payload.access_key else ""
        secret = payload.secret_key.get_secret_value() if payload.secret_key else ""
        if not access or not secret:
            raise OnboardingError("credentials_required")
        return access, secret

    def configure(self, actor, row, payload, preview):
        draft = self.progress.draft(row)
        target = self.progress.target(actor, draft)
        if {"create_private_connection", "create_ceph_endpoint", "configure_endpoint_credentials"} & set(preview.changes):
            self.credentials(payload)
        features = enable_onboarding_features(self.db, REQUIRED_FEATURES[draft.workspace])
        if features:
            self.progress.audit(actor, "features_enabled", row.id, features=features)
        if draft.resource_kind == "connection":
            self._connection(actor, row, draft, payload, preview)
        else:
            endpoint = self._endpoint(actor, row, draft, payload, preview)
            draft = self.progress.draft(row)
            if draft.resource_kind == "account":
                account = self._account(actor, row, draft, endpoint)
                if draft.workspace == "portal":
                    self._portal_iam(actor, row, endpoint, account)
                self._membership(actor, row, target, draft, account, preview)
                if draft.workspace == "portal":
                    portal = get_portal_service(self.db)
                    access = resolve_portal_account_access(self.db, target, account.id)
                    # Explicit Portal orchestration; never use root credentials
                    # as the beneficiary's data-plane execution identity.
                    portal.get_portal_credentials(target, account, access.portal_role)
                    if draft.space_name:
                        row.pending_step = "space"
                        self.db.commit()
                        space = portal.create_storage_space(
                            target, access, name=draft.space_name,
                            visibility=draft.space_visibility, share_scope="restricted",
                        )
                        self.progress.checkpoint(row, space_id=space.id)
                        self.progress.audit(actor, "space_created", row.id, account_id=account.id, beneficiary_user_id=target.id)
            elif "grant_ceph_admin_access" in preview.changes:
                get_users_service(self.db).update_user(target.id, UserUpdate(can_access_ceph_admin=True))
                self.progress.audit(actor, "access_assigned", row.id, beneficiary_user_id=target.id, workspace="ceph-admin", endpoint_id=endpoint.id)
        row.configured_at = utcnow()
        row.updated_at = utcnow()
        row.pending_step = None
        self.db.commit()
        self.progress.audit(actor, "configured", row.id, workspace=draft.workspace, beneficiary_user_id=target.id)

    def _connection(self, actor, row, draft, payload, preview):
        connections = S3ConnectionsService(self.db)
        if "allow_private_connections" in preview.changes:
            get_users_service(self.db).update_user(actor.id, UserUpdate(can_create_manual_private_connections=True))
            self.progress.audit(actor, "access_assigned", row.id, beneficiary_user_id=actor.id, capability="can_create_manual_private_connections")
        if draft.connection_id:
            if "enable_connection_workspace" in preview.changes:
                connections.update(actor.id, draft.connection_id, S3ConnectionUpdate(**{f"access_{draft.workspace}": True}))
                self.progress.audit(actor, "connection_workspace_enabled", row.id, workspace=draft.workspace)
            return
        access, secret = self.credentials(payload)
        endpoint = {"storage_endpoint_id": draft.endpoint_id} if draft.endpoint_id else {
            "endpoint_url": draft.endpoint_url, "region": draft.region or None,
            "force_path_style": draft.force_path_style, "verify_tls": True,
        }
        connection = connections.create(actor.id, S3ConnectionCreate(
            name=draft.name, access_key_id=access, secret_access_key=secret,
            access_browser=draft.workspace == "browser", access_manager=draft.workspace == "manager",
            **endpoint,
        ), commit=False)
        # Private connection and its progress reference commit atomically.
        self.progress.checkpoint(row, connection_id=connection.id)
        self.progress.audit(actor, "private_connection_created", row.id, workspace=draft.workspace, beneficiary_user_id=actor.id)

    def _endpoint(self, actor, row, draft, payload, preview):
        account = self.db.get(S3Account, draft.account_id) if draft.account_id else None
        endpoint = account.storage_endpoint if account else self.db.get(StorageEndpoint, draft.endpoint_id) if draft.endpoint_id else None
        if endpoint is None:
            access, secret = self.credentials(payload)
            credentials = {"ceph_admin_access_key": access, "ceph_admin_secret_key": secret} if draft.workspace == "ceph-admin" else {"admin_access_key": access, "admin_secret_key": secret}
            features = StorageEndpointFeatures()
            if draft.resource_kind == "account":
                detected = self.endpoints.detect_features(StorageEndpointFeatureDetectionRequest(
                    endpoint_url=draft.endpoint_url, region=draft.region or None, verify_tls=True, **credentials,
                ))
                if not (detected.admin and detected.account):
                    raise OnboardingError("account_api_unavailable")
                features.admin.enabled = True
                features.account.enabled = True
            created = self.endpoints.create_endpoint(StorageEndpointCreate(
                name=draft.name if draft.workspace == "ceph-admin" else f"{draft.name} endpoint",
                endpoint_url=draft.endpoint_url, region=draft.region or None,
                force_path_style=draft.force_path_style, verify_tls=True,
                features_config=dump_features_config(features.model_dump()), **credentials,
            ), commit=False)
            self.progress.checkpoint(row, endpoint_id=created.id)
            endpoint = self.db.get(StorageEndpoint, created.id)
            self.progress.audit(actor, "endpoint_created", row.id, endpoint_id=endpoint.id)
        elif "configure_endpoint_credentials" in preview.changes:
            access, secret = self.credentials(payload)
            credentials = {"ceph_admin_access_key": access, "ceph_admin_secret_key": secret} if draft.workspace == "ceph-admin" else {"admin_access_key": access, "admin_secret_key": secret}
            self.endpoints.update_endpoint(endpoint.id, StorageEndpointUpdate(**credentials))
            self.progress.audit(actor, "endpoint_credentials_configured", row.id, endpoint_id=endpoint.id, workspace=draft.workspace)
        flags = resolve_feature_flags(endpoint)
        if draft.resource_kind == "account" and not draft.account_id and not (flags.admin_enabled and flags.account_enabled):
            detected = self.endpoints.detect_features(StorageEndpointFeatureDetectionRequest(
                endpoint_id=endpoint.id, endpoint_url=endpoint.endpoint_url,
            ))
            if not (detected.admin and detected.account):
                raise OnboardingError("account_api_unavailable")
            self._enable_endpoint_features(endpoint, "admin", "account")
            self.progress.audit(actor, "endpoint_features_enabled", row.id, endpoint_id=endpoint.id, features=["admin", "account"])
        if not json.loads(row.resources_json).get("endpoint_id"):
            self.progress.checkpoint(row, endpoint_id=endpoint.id)
        return endpoint

    def _enable_endpoint_features(self, endpoint, *fields):
        features = normalize_features_config(endpoint.provider, endpoint.features_config, endpoint.region)
        for field in fields:
            features[field]["enabled"] = True
        self.endpoints.update_endpoint(endpoint.id, StorageEndpointUpdate(features_config=dump_features_config(features)))

    def _account(self, actor, row, draft, endpoint):
        if draft.account_id:
            return self.db.get(S3Account, draft.account_id)
        resources = json.loads(row.resources_json)
        identifier = resources.get("rgw_account_id")
        if not identifier:
            identifier = f"RGW{uuid4().int % (10 ** 17):017d}"
            self.progress.checkpoint(row, rgw_account_id=identifier)
        row.pending_step = "account"
        self.db.commit()
        created = get_s3_accounts_service(self.db).ensure_provisioned_account(
            S3AccountCreate(name=draft.name, storage_endpoint_id=endpoint.id), identifier,
        )
        self.progress.checkpoint(row, account_id=created.id)
        self.progress.audit(actor, "account_created", row.id, account_id=created.id, endpoint_id=endpoint.id)
        return self.db.get(S3Account, created.id)

    def _portal_iam(self, actor, row, endpoint, account):
        if resolve_feature_flags(endpoint).iam_enabled:
            return
        access, secret = require_s3_execution_credentials(account, error_message="Account credentials are required")
        # A positive IAM API response is required before enabling its capability.
        client = get_iam_client(access, secret, endpoint=endpoint.endpoint_url, region=endpoint.region, verify_tls=endpoint.verify_tls)
        client.list_users(MaxItems=1)
        self._enable_endpoint_features(endpoint, "iam")
        self.progress.audit(actor, "endpoint_features_enabled", row.id, endpoint_id=endpoint.id, features=["iam"])

    def _membership(self, actor, row, target, draft, account, preview):
        field = "grant_manager_access" if draft.workspace == "manager" else "grant_portal_access"
        if field not in preview.changes:
            return
        # Preserve the independent role axis and any existing group inheritance.
        direct = self.db.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).populate_existing().first()
        manager_role = direct.manager_role if direct else None
        portal_role = direct.portal_role if direct else None
        if draft.workspace == "manager":
            manager_role = "account_administrator"
        else:
            portal_role = "portal_manager"
        get_users_service(self.db).assign_user_to_account(
            target.id, account.id, manager_role=manager_role, portal_role=portal_role,
        )
        self.progress.audit(actor, "access_assigned", row.id, account_id=account.id, beneficiary_user_id=target.id, workspace=draft.workspace)

    def verify(self, actor, row):
        draft = self.progress.draft(row)
        if draft.workspace == "ceph-admin":
            endpoint = self.db.get(StorageEndpoint, draft.endpoint_id)
            access, secret = endpoint.ceph_admin_access_key, endpoint.ceph_admin_secret_key
            if not access or not secret:
                raise OnboardingError("credentials_required")
            # Ceph Admin has its own execution identity and is independent of
            # the Admin provisioning capability on this endpoint.
            client = get_rgw_admin_client(access_key=access, secret_key=secret,
                endpoint=resolve_rgw_admin_api_endpoint(endpoint), region=endpoint.region, verify_tls=endpoint.verify_tls)
            identity = client.get_user_by_access_key(access, allow_not_found=True)
            if not identity or not any(extract_ceph_admin_flags(identity)):
                raise OnboardingError("ceph_identity_denied")
            return {"operation": "rgw_identity", "context_id": f"ceph-admin-{endpoint.id}"}
        if draft.workspace == "portal":
            if not draft.space_id:
                raise OnboardingError("space_required")
            access = resolve_portal_account_access(self.db, actor, draft.account_id)
            portal = get_portal_service(self.db)
            # Normal Portal setup may create keys and repair IAM projections.
            # Verification must only exercise the already provisioned identity.
            portal.check_storage_space_read_access(actor, access, draft.space_id)
            return {"operation": "portal_files", "context_id": f"portal-{draft.account_id}", "space_id": draft.space_id}
        if draft.resource_kind == "connection":
            connection = self.db.get(S3Connection, draft.connection_id)
            if not self.progress.access.connection_is_allowed(actor, connection, workspace=draft.workspace):
                raise OnboardingError("connection_not_authorized", 403)
            context = S3ExecutionContext.from_connection(connection)
        else:
            account = self.db.get(S3Account, draft.account_id)
            link = self.progress.access.resolve_user(actor).account_link_for(account.id)
            if link is None or not self.progress.access.manager_account_allowed(link):
                raise OnboardingError("account_not_authorized", 403)
            key, secret = require_s3_execution_credentials(account, error_message="Account credentials are required")
            context = S3ExecutionContext.from_account(account, access_key=key, secret_key=secret)
        key, secret = require_s3_execution_credentials(context, error_message="Credentials are required")
        client = get_s3_client(access_key=key, secret_key=secret, **s3_execution_client_kwargs(context))
        if draft.bucket:
            if draft.workspace == "browser":
                client.list_objects_v2(Bucket=draft.bucket, Prefix=draft.prefix, MaxKeys=1)
                operation = "list_objects"
            else:
                client.head_bucket(Bucket=draft.bucket)
                operation = "head_bucket"
        else:
            client.list_buckets()
            operation = "list_buckets"
        return {"operation": operation, "context_id": context.context_id, "bucket": draft.bucket, "prefix": draft.prefix}
