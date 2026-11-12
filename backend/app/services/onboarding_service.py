# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Simplified first-run setup; authorization remains owned by EffectiveAccessService."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from hashlib import sha256
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db_transactions import run_replayable_db_unit
from app.db import OnboardingJourney, OnboardingPreference, S3Account, StorageEndpoint, User
from app.core.domain_enums import StorageProvider, is_admin_ui_role, is_superadmin_ui_role
from app.models.onboarding import (
    OnboardingDraft,
    OnboardingJourneyOut,
    OnboardingPreview,
    OnboardingResources,
    OnboardingStatus,
)
from app.services.app_settings_service import (
    get_general_feature_locks,
    load_app_settings_for_db,
)
from app.services.audit_service import AuditService
from app.services.effective_access_service import EffectiveAccessService
from app.services.operation_lease_service import OperationLeaseService
from app.services.onboarding_contracts import (
    OnboardingError,
    required_onboarding_feature_fields,
)
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.storage_endpoint_features import EndpointFeatureFlags, resolve_feature_flags
from app.utils.time import utcnow


class OnboardingService:
    def __init__(self, db):
        self.db = db
        self.access = EffectiveAccessService(db)
        self.endpoints = get_storage_endpoints_service(db)

    def _require_admin(self, actor, *, write=False):
        allowed = is_superadmin_ui_role(actor.role) if write else is_admin_ui_role(actor.role)
        if not actor.is_active or not allowed:
            raise OnboardingError("admin_required", 403)

    def get(self, actor, journey_id):
        self._require_admin(actor)
        row = self.db.scalar(
            select(OnboardingJourney)
            .where(
                OnboardingJourney.id == str(journey_id),
                OnboardingJourney.user_id == actor.id,
            )
            .limit(1)
        )
        if row is None:
            raise OnboardingError("journey_not_found", 404)
        return row

    @contextmanager
    def editing(self, actor):
        self._require_admin(actor, write=True)
        leases = OperationLeaseService(self.db)
        handle = leases.acquire(f"onboarding:user:{actor.id}", ttl_seconds=600)
        if handle is None:
            raise OnboardingError("configuration_busy", 409)
        try:
            self.db.expire_all()
            yield
        finally:
            self.db.rollback()
            leases.release(handle)

    @staticmethod
    def draft(row) -> OnboardingDraft:
        return OnboardingDraft.model_validate(row.draft)

    @staticmethod
    def resources(row) -> OnboardingResources:
        return OnboardingResources.model_validate(row.resources)

    def preview(self, actor, row):
        self._require_admin(actor)
        if not is_superadmin_ui_role(actor.role):
            return OnboardingPreview(blockers=["superadmin_required"])
        if row.configured_at:
            return OnboardingPreview()
        result = self._preview(actor, row)
        draft = self.draft(row)
        result.review_token = sha256(
            json.dumps(
                [
                    draft.model_dump(),
                    result.model_dump(exclude={"review_token"}),
                    self.fingerprint(actor, row),
                ],
                sort_keys=True,
                default=str,
            ).encode()
        ).hexdigest()
        return result

    def preview_draft(self, actor, draft, journey_id=None):
        self._require_admin(actor)
        if journey_id is not None:
            existing = self.get(actor, journey_id)
            if self.draft(existing) == draft:
                return self.preview(actor, existing)
        row = OnboardingJourney(draft=draft.model_dump(mode="json"), resources={})
        return self.preview(actor, row)

    def _preview(self, actor, row):
        draft = self.draft(row)
        result = OnboardingPreview()
        self._preview_features(draft, result)

        endpoint = self.db.get(StorageEndpoint, draft.endpoint_id) if draft.endpoint_id else None
        if draft.endpoint_id and endpoint is None:
            result.blockers.append("endpoint_unavailable")
            return result

        self._preview_endpoint(draft, endpoint, result)
        self._preview_access_changes(actor, row, draft, result)
        return result

    def _preview_features(
        self,
        draft: OnboardingDraft,
        result: OnboardingPreview,
    ) -> None:
        settings = load_app_settings_for_db(self.db)
        locks = get_general_feature_locks(self.db)

        if not draft.selected_options:
            result.blockers.append("selection_required")

        for field in required_onboarding_feature_fields(draft):
            if getattr(settings.general, field):
                continue
            lock = getattr(locks, field, None)
            if lock and lock.forced:
                result.blockers.append(f"deployment_locked:{field}")
            else:
                result.features.append(field)

    def _preview_endpoint(
        self,
        draft: OnboardingDraft,
        endpoint: StorageEndpoint | None,
        result: OnboardingPreview,
    ) -> None:
        needs_ceph = draft.manager or draft.portal or draft.ceph_admin or draft.supervision
        if needs_ceph:
            result.changes.append("configure_endpoint_service_identities")
        if endpoint is None:
            self._preview_new_endpoint(draft, result)
            return
        if needs_ceph and endpoint.provider != StorageProvider.CEPH.value:
            result.blockers.append("ceph_endpoint_required")
            return
        if endpoint.provider == StorageProvider.CEPH.value:
            self._preview_existing_ceph_endpoint(draft, endpoint, result)

    def _preview_new_endpoint(
        self,
        draft: OnboardingDraft,
        result: OnboardingPreview,
    ) -> None:
        if not draft.endpoint_url:
            result.blockers.append("endpoint_required")
        else:
            result.changes.append("create_ceph_endpoint")
        if self.endpoints.deployment_manages_endpoints():
            result.blockers.append("endpoints_locked")
        if draft.manager or draft.portal:
            result.changes.append("validate_ceph_account_api")
        if draft.ceph_admin:
            result.changes.append("configure_ceph_admin_credentials")
        if draft.supervision:
            result.changes.extend(
                ["validate_supervision", "enable_endpoint_supervision_features"]
            )

    def _preview_existing_ceph_endpoint(
        self,
        draft: OnboardingDraft,
        endpoint: StorageEndpoint,
        result: OnboardingPreview,
    ) -> None:
        editable = endpoint.is_editable and not self.endpoints.deployment_manages_endpoints()
        flags = resolve_feature_flags(endpoint)
        if draft.manager or draft.portal:
            self._preview_account_endpoint(draft, endpoint, flags, editable, result)
        if draft.supervision:
            self._preview_supervision_endpoint(endpoint, flags, editable, result)
        if draft.ceph_admin:
            result.changes.append("configure_ceph_admin_credentials")

    @staticmethod
    def _preview_account_endpoint(
        draft: OnboardingDraft,
        endpoint: StorageEndpoint,
        flags: EndpointFeatureFlags,
        editable: bool,
        result: OnboardingPreview,
    ) -> None:
        result.changes.append("validate_ceph_account_api")
        if not (endpoint.admin_access_key and endpoint.admin_secret_key) and not editable:
            result.blockers.append("endpoint_credentials_locked")
        if not (flags.admin_enabled and flags.account_enabled):
            if editable:
                result.changes.append("enable_endpoint_account_features")
            else:
                result.blockers.append("endpoint_features_locked")
        if draft.portal and not flags.iam_enabled and not editable:
            result.blockers.append("endpoint_features_locked")

    @staticmethod
    def _preview_supervision_endpoint(
        endpoint: StorageEndpoint,
        flags: EndpointFeatureFlags,
        editable: bool,
        result: OnboardingPreview,
    ) -> None:
        result.changes.append("validate_supervision")
        supervision = endpoint.service_identity("supervision")
        if not (
            supervision and supervision.access_key and supervision.secret_key
        ) and not editable:
            result.blockers.append("endpoint_credentials_locked")
        if not flags.metrics_enabled:
            if editable:
                result.changes.append("enable_endpoint_supervision_features")
            else:
                result.blockers.append("endpoint_features_locked")

    def _preview_access_changes(
        self,
        actor: User,
        row: OnboardingJourney,
        draft: OnboardingDraft,
        result: OnboardingPreview,
    ) -> None:
        if draft.manager or draft.portal:
            resources = self.resources(row)
            result.changes.append(
                "resume_sample_account"
                if resources.account_id or resources.rgw_account_id
                else "create_sample_account"
            )
        if draft.manager:
            result.changes.append("grant_manager_access")
        if draft.portal:
            result.changes.extend(["validate_portal_iam", "grant_portal_access", "prepare_portal_identity"])
        if draft.private_connection:
            result.changes.append("create_private_connection")
            effective = self.access.resolve_user(actor)
            if not effective.can_create_manual_private_connections:
                result.changes.append("allow_private_connections")
        if draft.ceph_admin and not self.access.resolve_user(actor).can_access_ceph_admin:
            result.changes.append("grant_ceph_admin_access")

    def fingerprint(self, actor, row):
        draft = self.draft(row)
        endpoint = self.db.get(StorageEndpoint, draft.endpoint_id) if draft.endpoint_id else None
        actor_state = (
            actor.id,
            actor.role,
            actor.is_active,
            actor.can_access_ceph_admin,
            actor.can_create_manual_private_connections,
        )
        endpoint_state = None
        if endpoint is not None:
            runtime = endpoint.service_identity("runtime")
            supervision = endpoint.service_identity("supervision")
            credential_digest = sha256(
                "\0".join(
                    str(value or "")
                    for value in (
                        endpoint.admin_access_key,
                        endpoint.admin_secret_key,
                        runtime.access_key if runtime else None,
                        runtime.secret_key if runtime else None,
                        runtime.mode if runtime else None,
                        endpoint.ceph_admin_allowed,
                        supervision.access_key if supervision else None,
                        supervision.secret_key if supervision else None,
                    )
                ).encode()
            ).hexdigest()
            endpoint_state = (
                endpoint.id,
                endpoint.name,
                endpoint.endpoint_url,
                endpoint.provider,
                endpoint.region,
                endpoint.force_path_style,
                endpoint.verify_tls,
                endpoint.is_editable,
                endpoint.features,
                credential_digest,
            )
        return (draft.model_dump(), actor_state, endpoint_state)

    def _links(self, row, draft: OnboardingDraft) -> dict[str, str]:
        resources = self.resources(row)
        links: dict[str, str] = {}
        account_id = resources.account_id
        connection_id = resources.connection_id
        if draft.manager and account_id:
            links["manager"] = f"/manager/buckets?ctx={account_id}"
        if draft.portal and account_id:
            links["portal"] = f"/portal/storage-spaces?project={account_id}"
        if draft.private_connection and connection_id:
            links["browser"] = f"/browser?ctx=conn-{connection_id}"
            links["private_manager"] = f"/manager/buckets?ctx=conn-{connection_id}"
        if draft.ceph_admin and draft.endpoint_id:
            links["ceph_admin"] = f"/ceph-admin?ep={draft.endpoint_id}"
        return links

    def output(self, actor, row):
        draft = self.draft(row)
        return OnboardingJourneyOut(
            id=row.id,
            revision=row.revision,
            draft=draft,
            configured=bool(row.configured_at),
            preview=self.preview(actor, row) if not row.configured_at else OnboardingPreview(),
            links=self._links(row, draft),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def status(self, actor):
        self._require_admin(actor)
        preference = self.db.get(OnboardingPreference, actor.id)
        rows = self.db.scalars(
            select(OnboardingJourney)
            .where(OnboardingJourney.user_id == actor.id)
            .order_by(OnboardingJourney.updated_at.desc())
        ).all()
        journeys = [self.output(actor, row) for row in rows]
        return OnboardingStatus(
            dismissed=preference.dismissed if preference else False,
            complete=bool(rows and rows[0].configured_at),
            source=get_settings().onboarding_source,
            journeys=journeys,
            can_configure=is_superadmin_ui_role(actor.role),
        )

    def dismiss(self, actor, dismissed=True):
        self._require_admin(actor)
        actor_id = int(actor.id)
        updated_at = utcnow()

        def persist_once(write_db: Session) -> None:
            preference = write_db.get(OnboardingPreference, actor_id)
            if preference is None:
                preference = OnboardingPreference(user_id=actor_id)
                write_db.add(preference)
            preference.dismissed = dismissed
            preference.updated_at = updated_at

        run_replayable_db_unit(self.db, persist_once)
        self.audit(actor, "dismiss" if dismissed else "resume", str(actor_id))
        return self.status(actor)

    def save(self, actor, journey_id, payload):
        identifier = str(UUID(str(journey_id)))
        actor_id = int(actor.id)
        draft_payload = payload.draft.model_dump(mode="json")
        updated_at = utcnow()
        with self.editing(actor):
            def persist_once(write_db: Session) -> bool:
                row = write_db.get(OnboardingJourney, identifier)
                if row is not None and row.user_id != actor_id:
                    raise OnboardingError("journey_not_found", 404)
                if row is None:
                    if payload.revision is not None:
                        raise OnboardingError("journey_not_found", 404)
                    row = OnboardingJourney(
                        id=identifier,
                        user_id=actor_id,
                        draft=draft_payload,
                    )
                    write_db.add(row)
                else:
                    previous = self.draft(row)
                    if previous == payload.draft:
                        return False
                    if payload.revision != row.revision:
                        raise OnboardingError("stale_revision", 409)
                    if row.configured_at:
                        raise OnboardingError("configured_journey_immutable", 409)
                    resources = self.resources(row)
                    if row.pending_step or any(
                        (
                            resources.endpoint_created,
                            resources.endpoint_name,
                            resources.account_id,
                            resources.connection_id,
                            resources.rgw_account_id,
                        )
                    ):
                        raise OnboardingError(
                            "configuration_reconciliation_required",
                            409,
                        )
                    row.draft = draft_payload
                    row.revision += 1
                    row.resources = {}
                row.updated_at = updated_at
                write_db.flush()
                return True

            changed = run_replayable_db_unit(self.db, persist_once)
            row = self.db.get(OnboardingJourney, identifier, populate_existing=True)
            if row is None:  # pragma: no cover - defensive consistency check
                raise OnboardingError("journey_not_found", 404)
            if changed:
                self.audit(actor, "save", row.id)
            return self.output(actor, row)

    @staticmethod
    def _checkpoint_resources(current, updates):
        canonical = {
            **OnboardingService.resources(current).model_dump(
                mode="json", exclude_none=True
            ),
            **updates,
        }
        if canonical.get("endpoint_created") is True:
            canonical.pop("endpoint_name", None)
        if canonical.get("account_id") is not None:
            canonical.pop("rgw_account_id", None)
            canonical.pop("account_name", None)
        return OnboardingResources.model_validate(canonical).model_dump(
            mode="json", exclude_none=True
        )

    def _checkpoint(
        self,
        row,
        *,
        resources: dict[str, object],
        draft: dict[str, object] | None = None,
        local_write: Callable[[Session], dict[str, object]] | None = None,
    ) -> None:
        row_id = row.id
        updated_at = utcnow()

        def persist_once(write_db: Session) -> None:
            local_resources = local_write(write_db) if local_write is not None else {}
            current = write_db.get(OnboardingJourney, row_id)
            if current is None:
                raise OnboardingError("journey_not_found", 404)
            current.resources = self._checkpoint_resources(
                current,
                {**resources, **local_resources},
            )
            if draft is not None:
                current.draft = draft
            current.pending_step = None
            current.updated_at = updated_at

        run_replayable_db_unit(self.db, persist_once)
        self.db.refresh(row)

    def checkpoint(self, row, **resources):
        self._checkpoint(row, resources=resources)

    def checkpoint_endpoint(self, row, endpoint_id: int) -> None:
        draft = self.draft(row).model_copy(
            update={"endpoint_id": endpoint_id, "endpoint_url": ""}
        )
        self._checkpoint(
            row,
            resources={"endpoint_created": True},
            draft=draft.model_dump(mode="json"),
        )

    def checkpoint_with_local_write(
        self,
        row,
        local_write: Callable[[Session], dict[str, object]],
    ) -> None:
        self._checkpoint(row, resources={}, local_write=local_write)

    def audit(self, actor, action, identifier, *, status="success", **metadata):
        account_id = metadata.get("account_id")
        account = (
            self.db.get(S3Account, account_id)
            if isinstance(account_id, int) and account_id > 0
            else None
        )
        AuditService(self.db).record_action(
            user=actor,
            scope="admin",
            action=f"onboarding.{action}",
            entity_type="onboarding",
            entity_id=identifier,
            account=account,
            status=status,
            metadata={"workflow_id": identifier, **metadata},
        )

    def apply(self, actor, journey_id, payload):
        from app.services.onboarding_setup_service import OnboardingSetupService

        with self.editing(actor):
            row = self.get(actor, journey_id)
            if payload.revision != row.revision:
                raise OnboardingError("stale_revision", 409)
            if row.configured_at:
                return self.output(actor, row)
            preview = self.preview(actor, row)
            if preview.blockers:
                raise OnboardingError(preview.blockers[0])
            if payload.review_token != preview.review_token:
                raise OnboardingError("review_changed", 409)
            OnboardingSetupService(self).configure(actor, row, payload)
            return self.output(actor, row)
