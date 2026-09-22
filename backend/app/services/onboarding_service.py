# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Simplified first-run setup; authorization remains owned by EffectiveAccessService."""
from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import json
from uuid import UUID

from app.core.config import get_settings
from app.db import (
    OnboardingJourney,
    OnboardingPreference,
    S3Account,
    StorageEndpoint,
    StorageProvider,
    User,
    is_admin_ui_role,
    is_superadmin_ui_role,
)
from app.models.onboarding import (
    OnboardingDraft,
    OnboardingJourneyOut,
    OnboardingPreview,
    OnboardingStatus,
)
from app.services.app_settings_service import (
    get_general_feature_locks,
    load_app_settings_for_db,
)
from app.services.audit_service import AuditService
from app.services.effective_access_service import EffectiveAccessService
from app.services.operation_lease_service import OperationLeaseService
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow


REQUIRED_FEATURES = {
    "manager": ("manager_enabled",),
    "portal": ("portal_enabled", "browser_enabled", "browser_portal_enabled"),
    "private_connection": (
        "browser_enabled",
        "browser_root_enabled",
        "manager_enabled",
    ),
    "ceph_admin": ("ceph_admin_enabled",),
}


class OnboardingError(ValueError):
    def __init__(self, code: str, status_code: int = 400):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class OnboardingService:
    def __init__(self, db):
        self.db = db
        self.access = EffectiveAccessService(db)
        self.endpoints = get_storage_endpoints_service(db)

    def _require_admin(self, actor, *, write=False):
        allowed = is_superadmin_ui_role(actor.role) if write else is_admin_ui_role(actor.role)
        if not actor.is_active or not allowed:
            raise OnboardingError("admin_required", 403)

    @staticmethod
    def is_v2(row) -> bool:
        try:
            return json.loads(row.draft_json).get("version") == 2
        except (TypeError, ValueError, AttributeError):
            return False

    def get(self, actor, journey_id):
        self._require_admin(actor)
        row = self.db.query(OnboardingJourney).filter_by(
            id=str(journey_id), user_id=actor.id
        ).first()
        if row is None or not self.is_v2(row):
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
        data = json.loads(row.draft_json)
        resources = json.loads(row.resources_json)
        if resources.get("endpoint_id"):
            data["endpoint_id"] = resources["endpoint_id"]
            data["endpoint_url"] = ""
        return OnboardingDraft.model_validate(data)

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
        row = OnboardingJourney(draft_json=draft.model_dump_json(), resources_json="{}")
        return self.preview(actor, row)

    def _required_feature_fields(self, draft: OnboardingDraft) -> tuple[str, ...]:
        fields: list[str] = []
        for option in draft.selected_options:
            for field in REQUIRED_FEATURES[option]:
                if field not in fields:
                    fields.append(field)
        return tuple(fields)

    def _preview(self, actor, row):
        draft = self.draft(row)
        result = OnboardingPreview()
        settings = load_app_settings_for_db(self.db)
        locks = get_general_feature_locks()

        if not draft.selected_options:
            result.blockers.append("selection_required")

        for field in self._required_feature_fields(draft):
            if getattr(settings.general, field):
                continue
            lock = getattr(locks, field, None)
            if lock and lock.forced:
                result.blockers.append(f"env_locked:{lock.source}")
            else:
                result.features.append(field)

        endpoint = self.db.get(StorageEndpoint, draft.endpoint_id) if draft.endpoint_id else None
        if draft.endpoint_id and endpoint is None:
            result.blockers.append("endpoint_unavailable")
            return result

        needs_ceph = draft.manager or draft.portal or draft.ceph_admin
        if endpoint is None:
            if not draft.endpoint_url:
                result.blockers.append("endpoint_required")
            else:
                result.changes.append("create_ceph_endpoint")
            if self.endpoints.env_endpoints_locked():
                result.blockers.append("endpoints_locked")
        elif needs_ceph and endpoint.provider != StorageProvider.CEPH.value:
            result.blockers.append("ceph_endpoint_required")

        if endpoint is not None and endpoint.provider == StorageProvider.CEPH.value:
            editable = endpoint.is_editable and not self.endpoints.env_endpoints_locked()
            flags = resolve_feature_flags(endpoint)
            if draft.manager or draft.portal:
                if not (endpoint.admin_access_key and endpoint.admin_secret_key):
                    result.blockers.append("endpoint_admin_credentials_required")
                else:
                    result.changes.append("validate_ceph_account_api")
                if not (flags.admin_enabled and flags.account_enabled):
                    if editable:
                        result.changes.append("enable_endpoint_account_features")
                    else:
                        result.blockers.append("endpoint_features_locked")
                if draft.portal and not flags.iam_enabled and not editable:
                    result.blockers.append("endpoint_features_locked")
            if draft.ceph_admin:
                if not (
                    endpoint.ceph_admin_access_key
                    and endpoint.ceph_admin_secret_key
                ):
                    result.blockers.append("ceph_admin_credentials_required")
                else:
                    result.changes.append("validate_ceph_admin")

        if endpoint is None and (draft.manager or draft.portal):
            result.changes.append("validate_ceph_account_api")
        if endpoint is None and draft.ceph_admin:
            result.changes.append("validate_ceph_admin")

        if draft.manager or draft.portal:
            resources = json.loads(row.resources_json)
            result.changes.append(
                "resume_sample_account"
                if resources.get("rgw_account_id")
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

        return result

    def fingerprint(self, actor, row):
        draft = self.draft(row)
        endpoint = self.db.get(StorageEndpoint, draft.endpoint_id) if draft.endpoint_id else None
        actor_state = (
            actor.id,
            actor.role,
            actor.is_active,
            bool(actor.can_access_ceph_admin),
            bool(actor.can_create_manual_private_connections),
        )
        endpoint_state = None
        if endpoint is not None:
            credential_digest = sha256(
                "\0".join(
                    str(value or "")
                    for value in (
                        endpoint.admin_access_key,
                        endpoint.admin_secret_key,
                        endpoint.ceph_admin_access_key,
                        endpoint.ceph_admin_secret_key,
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
                endpoint.features_config,
                credential_digest,
            )
        return (draft.model_dump(), actor_state, endpoint_state)

    def _links(self, row, draft: OnboardingDraft) -> dict[str, str]:
        resources = json.loads(row.resources_json)
        links: dict[str, str] = {}
        account_id = resources.get("account_id")
        connection_id = resources.get("connection_id")
        endpoint_id = resources.get("endpoint_id") or draft.endpoint_id
        if draft.manager and account_id:
            links["manager"] = f"/manager/buckets?ctx={account_id}"
        if draft.portal and account_id:
            links["portal"] = f"/portal/storage-spaces?project={account_id}"
        if draft.private_connection and connection_id:
            links["browser"] = f"/browser?ctx=conn-{connection_id}"
            links["private_manager"] = f"/manager/buckets?ctx=conn-{connection_id}"
        if draft.ceph_admin and endpoint_id:
            links["ceph_admin"] = f"/ceph-admin?ep={endpoint_id}"
        return links

    def output(self, actor, row):
        draft = self.draft(row)
        return OnboardingJourneyOut(
            id=row.id,
            revision=row.revision,
            draft=draft,
            resources=json.loads(row.resources_json),
            pending_step=row.pending_step,
            configured=bool(row.configured_at),
            preview=self.preview(actor, row) if not row.configured_at else OnboardingPreview(),
            links=self._links(row, draft),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def status(self, actor):
        self._require_admin(actor)
        preference = self.db.get(OnboardingPreference, actor.id)
        rows = (
            self.db.query(OnboardingJourney)
            .filter_by(user_id=actor.id)
            .order_by(OnboardingJourney.updated_at.desc())
            .all()
        )
        v2_rows = [row for row in rows if self.is_v2(row)]
        journeys = [self.output(actor, row) for row in v2_rows]
        complete = (
            bool(v2_rows[0].configured_at)
            if v2_rows
            else any(row.configured_at for row in rows)
        )
        endpoint_configured = self.db.query(StorageEndpoint.id).first() is not None
        storage_access_configured = (
            self.db.query(S3Account.id).first() is not None
            or bool(self.access.list_workspace_connections(actor, workspace="manager"))
        )
        return OnboardingStatus(
            dismissed=preference.dismissed if preference else False,
            complete=complete,
            endpoint_configured=endpoint_configured,
            storage_access_configured=storage_access_configured,
            source=getattr(get_settings(), "onboarding_source", "standard"),
            journeys=journeys,
            can_configure=is_superadmin_ui_role(actor.role),
            actor_id=actor.id,
        )

    def dismiss(self, actor, dismissed=True):
        self._require_admin(actor)
        preference = self.db.get(OnboardingPreference, actor.id)
        if preference is None:
            preference = OnboardingPreference(user_id=actor.id)
            self.db.add(preference)
        preference.dismissed = dismissed
        preference.updated_at = utcnow()
        self.db.commit()
        self.audit(actor, "dismiss" if dismissed else "resume", str(actor.id))
        return self.status(actor)

    def save(self, actor, journey_id, payload):
        identifier = str(UUID(str(journey_id)))
        with self.editing(actor):
            row = self.db.get(OnboardingJourney, identifier)
            if row is not None and (row.user_id != actor.id or not self.is_v2(row)):
                raise OnboardingError("journey_not_found", 404)
            if row is None:
                if payload.revision is not None:
                    raise OnboardingError("journey_not_found", 404)
                row = OnboardingJourney(
                    id=identifier,
                    user_id=actor.id,
                    draft_json=payload.draft.model_dump_json(),
                )
                self.db.add(row)
            else:
                previous = self.draft(row)
                if previous == payload.draft:
                    return self.output(actor, row)
                if payload.revision != row.revision:
                    raise OnboardingError("stale_revision", 409)
                if row.configured_at:
                    raise OnboardingError("configured_journey_immutable", 409)
                resources = json.loads(row.resources_json)
                if row.pending_step or any(
                    resources.get(key)
                    for key in ("endpoint_id", "account_id", "connection_id", "rgw_account_id")
                ):
                    raise OnboardingError("configuration_reconciliation_required", 409)
                row.draft_json = payload.draft.model_dump_json()
                row.revision += 1
                row.resources_json = "{}"
            row.updated_at = utcnow()
            self.db.commit()
            self.audit(actor, "save", row.id)
            return self.output(actor, row)

    def checkpoint(self, row, **resources):
        current = json.loads(row.resources_json)
        current.update(resources)
        row.resources_json = json.dumps(current)
        row.pending_step = None
        row.updated_at = utcnow()
        self.db.commit()

    def audit(self, actor, action, identifier, *, status="success", **metadata):
        AuditService(self.db).record_action(
            user=actor,
            scope="admin",
            action=f"onboarding.{action}",
            entity_type="onboarding",
            entity_id=identifier,
            account_id=metadata.get("account_id"),
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
            OnboardingSetupService(self).configure(actor, row, payload, preview)
            return self.output(actor, row)
