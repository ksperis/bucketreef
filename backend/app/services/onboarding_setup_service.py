# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Setup orchestration for the guided administrator onboarding."""
from sqlalchemy import select

from app.db import S3Account, S3Connection, UserS3Account
from app.models.onboarding import OnboardingApply
from app.models.s3_account import S3AccountCreate
from app.models.s3_connection import S3ConnectionCreate
from app.models.user import UserUpdate
from app.services.app_settings_service import (
    enable_onboarding_features,
    load_app_settings_for_db,
)
from app.services.managed_resource_naming import onboarding_sample_account_name
from app.services.onboarding_endpoint_setup_service import (
    OnboardingEndpointSetupService,
    credential_pair,
)
from app.services.onboarding_contracts import (
    OnboardingError,
    required_onboarding_feature_fields,
)
from app.services.portal_access_service import resolve_portal_account_access
from app.services.portal_service import get_portal_service
from app.services.rgw_iam import get_iam_client
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_client import require_s3_execution_credentials
from app.services.users_service import get_users_service
from app.utils.rgw_identifiers import generate_rgw_account_id
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow


class OnboardingSetupService:
    def __init__(self, progress):
        self.progress = progress
        self.db = progress.db
        self.endpoints = progress.endpoints
        self.endpoint_setup = OnboardingEndpointSetupService(progress)

    def _private_credentials(self, payload):
        access, secret = credential_pair(
            payload.private_access_key,
            payload.private_secret_key,
        )
        if not access:
            raise OnboardingError("private_credentials_required")
        return access, secret

    def configure(self, actor, row, payload):
        draft = self.progress.draft(row)
        self.endpoints.actor = actor
        endpoint = self.endpoint_setup.prepare(actor, row, draft, payload)
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

        features = enable_onboarding_features(
            self.db,
            required_onboarding_feature_fields(draft),
        )
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
        resources = row.resources
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
            resources = row.resources

        account_name = resources.get("account_name")
        if not account_name:
            account_name = self._unique_account_name(identifier)
            self.progress.checkpoint(row, account_name=account_name)

        row.pending_step = "account"
        self.db.commit()
        created = get_s3_accounts_service(self.db).ensure_provisioned_account(
            S3AccountCreate(
                name=account_name,
                rgw_tenant="",
                storage_endpoint_id=endpoint.id,
            ),
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
        self.endpoint_setup.enable_features(endpoint, "iam")
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
        resources = row.resources
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
