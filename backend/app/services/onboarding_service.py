# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Individual guided setup; authorization remains owned by EffectiveAccessService."""
from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import json
from urllib.parse import urlencode, quote
from uuid import UUID

from app.core.config import get_settings
from app.db import (
    OnboardingJourney, OnboardingPreference, S3Account, S3Connection,
    StorageEndpoint, StorageProvider, User, AccountIAMUser, UserS3Account, is_admin_ui_role, is_superadmin_ui_role,
    PortalStorageSpaceMetadata,
)
from app.models.onboarding import (
    OnboardingDraft, OnboardingJourneyOut, OnboardingOption,
    OnboardingPreview, OnboardingStatus,
    OnboardingSpaceOption,
)
from app.services.app_settings_service import get_general_feature_locks, load_app_settings_for_db
from app.services.audit_service import AuditService
from app.services.effective_access_service import EffectiveAccessService
from app.services.operation_lease_service import OperationLeaseService
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow


REQUIRED_FEATURES = {
    "browser": ("browser_enabled", "browser_root_enabled"),
    "manager": ("manager_enabled",),
    "portal": ("portal_enabled", "browser_enabled", "browser_portal_enabled"),
    "ceph-admin": ("ceph_admin_enabled",),
}
PERSONAL_CHECKS = {"backup", "restore", "updates"}
ORGANIZATION_CHECKS = PERSONAL_CHECKS | {"identities", "ownership", "pilot_allowed", "pilot_denied", "isolation"}


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

    def get(self, actor, journey_id):
        self._require_admin(actor)
        row = self.db.query(OnboardingJourney).filter_by(id=str(journey_id), user_id=actor.id).first()
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
    def draft(row):
        data = json.loads(row.draft_json)
        resources = json.loads(row.resources_json)
        for key in ("endpoint_id", "account_id", "connection_id", "space_id"):
            if resources.get(key):
                data[key] = resources[key]
        if data.get("space_id"):
            data["space_name"] = ""
        return OnboardingDraft.model_validate(data)

    def target(self, actor, draft):
        target = self.db.get(User, draft.beneficiary_user_id or actor.id)
        if target is None or not target.is_active:
            raise OnboardingError("beneficiary_unavailable")
        return target

    def preview(self, actor, row):
        self._require_admin(actor)
        if not is_superadmin_ui_role(actor.role):
            return OnboardingPreview(blockers=["superadmin_required"])
        result = self._preview(actor, row)
        draft = self.draft(row)
        try:
            fingerprint = self.fingerprint(actor, row)
        except OnboardingError:
            fingerprint = "unavailable"
        result.review_token = sha256(json.dumps(
            [draft.model_dump(), result.model_dump(exclude={"review_token"}), fingerprint],
            sort_keys=True, default=str,
        ).encode()).hexdigest()
        return result

    def preview_draft(self, actor, draft, journey_id=None):
        self._require_admin(actor)
        if journey_id is not None:
            existing = self.get(actor, journey_id)
            if self.draft(existing) == draft:
                return self.preview(actor, existing)
        row = OnboardingJourney(draft_json=draft.model_dump_json(), resources_json="{}")
        return self.preview(actor, row)

    def connection_for_actor(self, actor, connection_id):
        """Resolve only an owned private connection or an authorized shared one.

        Do not load a foreign private row even for preview/fingerprinting: both
        error differences and its credential digest can disclose private state.
        """
        if not connection_id:
            return None
        owned = self.db.query(S3Connection).filter_by(
            id=connection_id, created_by_user_id=actor.id, is_shared=False,
        ).first()
        if owned is not None:
            return owned
        return next((connection for connection in self.access.list_workspace_connections(actor, workspace="manager")
                     if connection.id == connection_id), None)

    def _preview(self, actor, row):
        draft = self.draft(row)
        result = OnboardingPreview()
        if draft.prefix and not draft.prefix.endswith("/"):
            # Browser's path selector addresses folders. Reject an ambiguous
            # link instead of silently changing the literal prefix checked here.
            result.blockers.append("browser_folder_prefix_required")
        settings = load_app_settings_for_db(self.db)
        locks = get_general_feature_locks()
        for field in REQUIRED_FEATURES[draft.workspace]:
            if not getattr(settings.general, field):
                lock = getattr(locks, field, None)
                if lock and lock.forced:
                    result.blockers.append(f"env_locked:{lock.source}")
                else:
                    result.features.append(field)
        if not is_superadmin_ui_role(actor.role):
            result.blockers.append("superadmin_required")
        try:
            target = self.target(actor, draft)
        except OnboardingError as exc:
            result.blockers.append(exc.code)
            return result
        effective = self.access.resolve_user(target)
        endpoint = self.db.get(StorageEndpoint, draft.endpoint_id) if draft.endpoint_id else None
        account = self.db.get(S3Account, draft.account_id) if draft.account_id else None
        if draft.account_id and account is None:
            result.blockers.append("account_unavailable")
        if account is not None:
            if draft.endpoint_id and account.storage_endpoint_id != draft.endpoint_id:
                result.blockers.append("account_endpoint_mismatch")
            endpoint = account.storage_endpoint
        if draft.endpoint_id and endpoint is None:
            result.blockers.append("endpoint_unavailable")
        if draft.resource_kind == "connection":
            if target.id != actor.id:
                result.blockers.append("private_connection_owner_required")
            connection = self.connection_for_actor(actor, draft.connection_id)
            if draft.connection_id:
                owned = connection is not None and not connection.is_shared and connection.created_by_user_id == actor.id
                usable = connection is not None and connection.is_active and (connection.expires_at is None or connection.expires_at > utcnow())
                if not usable or (draft.workspace == "manager" and connection.remediation_required):
                    result.blockers.append("connection_unavailable")
                elif connection.storage_endpoint_id and connection.storage_endpoint is None:
                    result.blockers.append("endpoint_unavailable")
                elif draft.endpoint_id and connection.storage_endpoint_id != draft.endpoint_id:
                    result.blockers.append("connection_endpoint_mismatch")
                elif not self.access.connection_is_allowed(target, connection, workspace=draft.workspace):
                    if owned:
                        result.changes.append("enable_connection_workspace")
                        if not draft.grant_access:
                            result.blockers.append("explicit_access_required")
                    else:
                        result.blockers.append("connection_not_authorized")
            else:
                result.changes.append("create_private_connection")
                if not draft.endpoint_id and not draft.endpoint_url:
                    result.blockers.append("endpoint_required")
                if not effective.can_create_manual_private_connections:
                    result.changes.append("allow_private_connections")
                    if not draft.grant_access:
                        result.blockers.append("explicit_access_required")
        else:
            if endpoint is None and not draft.endpoint_id and not draft.account_id:
                result.changes.append("create_ceph_endpoint")
                if not draft.endpoint_url:
                    result.blockers.append("endpoint_required")
                if self.endpoints.env_endpoints_locked():
                    result.blockers.append("endpoints_locked")
            if endpoint is not None:
                if endpoint.provider != StorageProvider.CEPH.value:
                    result.blockers.append("ceph_endpoint_required")
                editable = endpoint.is_editable and not self.endpoints.env_endpoints_locked()
                flags = resolve_feature_flags(endpoint)
                needs_credentials = (
                    not (endpoint.ceph_admin_access_key and endpoint.ceph_admin_secret_key)
                    if draft.workspace == "ceph-admin"
                    else not draft.account_id and not (endpoint.admin_access_key and endpoint.admin_secret_key)
                )
                if needs_credentials:
                    (result.changes if editable else result.blockers).append(
                        "configure_endpoint_credentials" if editable else "endpoint_credentials_locked"
                    )
                if draft.resource_kind == "account" and not draft.account_id and not (flags.admin_enabled and flags.account_enabled):
                    (result.changes if editable else result.blockers).append(
                        "detect_account_api" if editable else "endpoint_features_locked"
                    )
                if draft.workspace == "portal" and not flags.iam_enabled:
                    (result.changes if editable else result.blockers).append(
                        "detect_portal_iam" if editable else "endpoint_features_locked"
                    )
            if draft.resource_kind == "account":
                if not draft.account_id:
                    reserved_id = json.loads(row.resources_json).get("rgw_account_id")
                    result.changes.append("resume_rgw_account" if reserved_id else "create_rgw_account")
                    existing_account = self.db.query(S3Account).filter_by(name=draft.name).first()
                    if existing_account is not None and (
                        existing_account.rgw_account_id != reserved_id or endpoint is None
                        or existing_account.storage_endpoint_id != endpoint.id
                    ):
                        result.blockers.append("account_name_exists")
                link = effective.account_link_for(draft.account_id) if draft.account_id else None
                authorized = bool(link and (
                    self.access.manager_account_allowed(link) if draft.workspace == "manager"
                    else link.portal_role is not None
                ))
                if draft.workspace == "portal" and draft.space_name and draft.space_visibility == "shared" and link and link.portal_role != "portal_manager":
                    authorized = False
                if not authorized:
                    result.changes.append("grant_manager_access" if draft.workspace == "manager" else "grant_portal_access")
                    if target.role == "ui_none":
                        result.changes.append("enable_ui_user")
                    if not draft.grant_access:
                        result.blockers.append("explicit_access_required")
                if draft.workspace == "portal" and draft.space_name:
                    from app.services.portal_service import get_portal_service

                    portal_settings = get_portal_service(self.db).get_effective_portal_settings(account, base_settings=settings.portal) if account else settings.portal
                    if draft.space_visibility == "private" and not portal_settings.allow_private_storage_space_create:
                        result.blockers.append("private_spaces_disabled")
                    if target.id != actor.id:
                        result.blockers.append("pilot_creates_own_space")
                    else:
                        result.changes.append("create_storage_space")
                if draft.workspace == "portal" and draft.account_id and not self.db.query(AccountIAMUser.id).filter_by(user_id=target.id, account_id=draft.account_id).first():
                    result.changes.append("prepare_portal_identity")
                if draft.workspace == "portal" and draft.space_id and account is not None:
                    from app.services.portal_service import get_portal_service

                    role = link.portal_role if link else None
                    # A prospective project-manager assignment is already in the
                    # confirmation summary. After setup only effective access counts.
                    if "grant_portal_access" in result.changes and draft.grant_access:
                        role = "portal_manager"
                    spaces = get_portal_service(self.db).list_existing_user_storage_space_access(target, account, role)
                    if draft.space_id not in spaces:
                        result.blockers.append("space_unavailable")
            else:
                if not is_admin_ui_role(target.role):
                    result.blockers.append("ceph_admin_role_required")
                elif not effective.can_access_ceph_admin:
                    result.changes.append("grant_ceph_admin_access")
                    if not draft.grant_access:
                        result.blockers.append("explicit_access_required")
        if row.pending_step == "space":
            result.blockers.append("space_reconciliation_required")
        return result

    def fingerprint(self, actor, row):
        """Local revocation/rotation detection; never a claim of live S3 permission."""
        draft = self.draft(row)
        target = self.target(actor, draft)
        effective = self.access.resolve_user(target)
        parts = [draft.model_dump(exclude={"intent", "grant_access", "name"}), effective.account_links,
                 (target.id, target.role, target.is_active, target.full_name, target.email,
                  effective.can_access_ceph_admin, effective.can_create_manual_private_connections)]
        for cls, identifier in ((S3Connection, draft.connection_id), (S3Account, draft.account_id), (StorageEndpoint, draft.endpoint_id)):
            resource = (self.connection_for_actor(actor, identifier) if cls is S3Connection
                        else self.db.get(cls, identifier) if identifier else None)
            if resource is not None:
                parts.append((cls.__name__, resource.id, resource.name))
                if isinstance(resource, S3Connection):
                    # touch_usage also advances updated_at on every workspace
                    # visit. Only execution/access changes invalidate this proof.
                    # Credential values participate in the digest, never in the
                    # persisted evidence or API response.
                    parts.append(tuple(getattr(resource, field) for field in (
                        "created_by_user_id", "is_shared", "is_active",
                        "access_manager", "access_browser", "remediation_required",
                        "storage_endpoint_id", "custom_endpoint_config",
                        "access_key_id", "secret_access_key", "session_token", "expires_at",
                    )))
                else:
                    parts.append(str(resource.updated_at))
                endpoint = resource if cls is StorageEndpoint else getattr(resource, "storage_endpoint", None)
                if endpoint is not None:
                    parts.append((endpoint.id, str(endpoint.updated_at), endpoint.features_config))
        if draft.account_id:
            for link in self.db.query(UserS3Account).filter_by(user_id=target.id, account_id=draft.account_id).all():
                parts.append((link.id, str(link.updated_at), link.manager_role, link.portal_role))
            for link in self.db.query(AccountIAMUser).filter_by(user_id=target.id, account_id=draft.account_id).all():
                # Only the digest is persisted. Rotation invalidates old proof.
                parts.append((link.id, link.active_access_key, link.active_secret_key))
            if draft.workspace == "portal" and draft.space_id:
                space = self.db.query(PortalStorageSpaceMetadata).filter_by(account_id=draft.account_id, bucket_name=draft.space_id).first()
                if space is not None:
                    parts.append((space.id, str(space.updated_at), str(space.archived_at), space.visibility,
                                  space.owner_user_id, space.share_scope, space.account_member_role,
                                  sorted((grant.user_id, grant.role) for grant in space.grants)))
        return sha256(json.dumps(parts, default=str, sort_keys=True).encode()).hexdigest()

    def output(self, actor, row):
        draft = self.draft(row)
        preview = self.preview(actor, row)
        configured = bool(row.configured_at and not row.pending_step and not (preview.features or preview.changes or preview.blockers))
        evidence = json.loads(row.evidence_json)
        readiness = json.loads(row.readiness_json)
        fingerprint = self.fingerprint(actor, row) if configured else None
        current = configured and evidence.get("fingerprint") == fingerprint
        validated = bool(current and row.validated_at)
        checks = ORGANIZATION_CHECKS if draft.intent == "organization" else PERSONAL_CHECKS
        public_readiness = {
            key: {**{field: value for field, value in entry.items() if field != "fingerprint"},
                  "current": bool(configured and entry.get("fingerprint") == fingerprint)}
            for key, entry in readiness.items()
        }
        ready = bool(draft.intent != "evaluate" and validated and all(
            public_readiness.get(key, {}).get("checked") and public_readiness.get(key, {}).get("current") for key in checks
        ))
        public_evidence = {key: value for key, value in evidence.items() if key != "fingerprint"}
        public_evidence["current"] = bool(current)
        return OnboardingJourneyOut(
            id=row.id, revision=row.revision, draft=draft,
            resources=json.loads(row.resources_json), evidence=public_evidence,
            readiness=public_readiness, pending_step=row.pending_step,
            configured=configured, usage_validated=validated, ready=ready,
            preview=preview, open_url=self.open_url(draft) if configured else None,
            created_at=row.created_at, updated_at=row.updated_at,
        )

    @staticmethod
    def open_url(draft):
        if draft.workspace == "ceph-admin":
            return "/ceph-admin?" + urlencode({"ep": draft.endpoint_id})
        if draft.workspace == "portal":
            path = "/portal/storage-spaces"
            if draft.space_id:
                path += "/" + quote(draft.space_id, safe="")
            return path + "?" + urlencode({"project": draft.account_id})
        context = f"conn-{draft.connection_id}" if draft.resource_kind == "connection" else str(draft.account_id)
        query = {"ctx": context}
        if draft.workspace == "manager":
            path = "/manager/buckets"
            if draft.bucket:
                path += "/" + quote(draft.bucket, safe="")
            return path + "?" + urlencode(query)
        if draft.bucket:
            query["bucket"] = draft.bucket
        if draft.prefix and draft.workspace == "browser":
            query["prefix"] = draft.prefix
        return "/browser?" + urlencode(query)

    def status(self, actor):
        self._require_admin(actor)
        preference = self.db.get(OnboardingPreference, actor.id)
        rows = self.db.query(OnboardingJourney).filter_by(user_id=actor.id).order_by(OnboardingJourney.updated_at.desc()).all()
        journeys = [self.output(actor, row) for row in rows]
        endpoints = self.db.query(StorageEndpoint).order_by(StorageEndpoint.name).all()
        accounts = self.db.query(S3Account).order_by(S3Account.name).all()
        allowed_connections = {
            connection.id: connection
            for workspace in ("browser", "manager")
            for connection in self.access.list_workspace_connections(actor, workspace=workspace)
        }
        for connection in self.db.query(S3Connection).filter_by(created_by_user_id=actor.id, is_shared=False, is_active=True).all():
            if connection.expires_at is None or connection.expires_at > utcnow():
                allowed_connections[connection.id] = connection
        def options(values):
            return [OnboardingOption(id=value.id, name=value.name,
                                     endpoint_id=getattr(value, "storage_endpoint_id", None),
                                     is_shared=bool(getattr(value, "is_shared", False)),
                                     provider=str(value.provider) if isinstance(value, StorageEndpoint) else None)
                    for value in values]

        from app.services.portal_service import get_portal_service

        portal = get_portal_service(self.db)
        effective = self.access.resolve_user(actor)
        spaces = []
        for account in self.access.list_portal_accounts(actor, resolved=effective):
            allowed = portal.list_existing_user_storage_space_access(actor, account, effective.account_link_for(account.id).portal_role)
            for space in self.db.query(PortalStorageSpaceMetadata).filter_by(account_id=account.id).all():
                if space.bucket_name in allowed:
                    spaces.append(OnboardingSpaceOption(id=space.bucket_name, name=space.display_name or space.bucket_name, account_id=account.id))
        return OnboardingStatus(
            dismissed=preference.dismissed if preference else False,
            complete=any(journey.usage_validated for journey in journeys),
            endpoint_configured=bool(endpoints), storage_access_configured=bool(allowed_connections or accounts),
            source=getattr(get_settings(), "onboarding_source", "standard"), journeys=journeys,
            endpoints=options(endpoints), accounts=options(accounts), connections=options(allowed_connections.values()),
            users=[OnboardingOption(id=user.id, name=user.full_name or user.email) for user in self.db.query(User).filter_by(is_active=True).all()],
            can_configure=is_superadmin_ui_role(actor.role),
            actor_id=actor.id,
            spaces=spaces,
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
            if row is not None and row.user_id != actor.id:
                raise OnboardingError("journey_not_found", 404)
            if row is None:
                if payload.revision is not None:
                    raise OnboardingError("journey_not_found", 404)
                row = OnboardingJourney(id=identifier, user_id=actor.id, draft_json=payload.draft.model_dump_json())
                self.db.add(row)
            else:
                previous = self.draft(row)
                if previous == payload.draft:
                    return self.output(actor, row)
                if payload.revision != row.revision:
                    raise OnboardingError("stale_revision", 409)
                if row.pending_step == "space" and not payload.draft.space_id:
                    raise OnboardingError("space_reconciliation_required", 409)
                if row.pending_step == "account" and previous.model_dump(exclude={"intent"}) != payload.draft.model_dump(exclude={"intent"}):
                    raise OnboardingError("account_reconciliation_required", 409)
                ignored = {"intent", "grant_access"}
                if previous.connection_id or previous.account_id or previous.resource_kind == "endpoint" and previous.endpoint_id:
                    ignored.add("name")
                scope_changed = previous.model_dump(exclude=ignored) != payload.draft.model_dump(exclude=ignored)
                if scope_changed:
                    row.resources_json = "{}"
                    row.evidence_json = "{}"
                    row.readiness_json = "{}"
                    row.configured_at = None
                    row.validated_at = None
                    row.pending_step = None
                row.draft_json = payload.draft.model_dump_json()
                row.revision += 1
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
            user=actor, scope="admin", action=f"onboarding.{action}",
            entity_type="onboarding", entity_id=identifier,
            account_id=metadata.get("account_id"), status=status,
            metadata={"workflow_id": identifier, **metadata},
        )

    def attest(self, actor, journey_id, payload):
        with self.editing(actor):
            row = self.get(actor, journey_id)
            if row.revision != payload.revision:
                raise OnboardingError("stale_revision", 409)
            if not self.output(actor, row).configured:
                raise OnboardingError("configure_first")
            if payload.checked and payload.check in {"usage", "pilot_allowed", "pilot_denied", "isolation"} and not payload.note.strip():
                raise OnboardingError("validation_note_required")
            entry = {"checked": payload.checked, "note": payload.note, "actor_id": actor.id, "at": utcnow().isoformat(), "source": "operator", "fingerprint": self.fingerprint(actor, row)}
            if payload.check == "usage":
                row.validated_at = utcnow() if payload.checked else None
                row.evidence_json = json.dumps({**entry, "fingerprint": self.fingerprint(actor, row), "operation": "operator_attestation"})
            else:
                readiness = json.loads(row.readiness_json)
                readiness[payload.check] = entry
                row.readiness_json = json.dumps(readiness)
            row.updated_at = utcnow()
            self.db.commit()
            self.audit(actor, "attest", row.id, check=payload.check, checked=payload.checked)
            return self.output(actor, row)

    def apply(self, actor, journey_id, payload):
        from app.services.onboarding_setup_service import OnboardingSetupService

        with self.editing(actor):
            row = self.get(actor, journey_id)
            if payload.revision != row.revision:
                raise OnboardingError("stale_revision", 409)
            preview = self.preview(actor, row)
            if preview.blockers:
                raise OnboardingError(preview.blockers[0])
            if not self.output(actor, row).configured and payload.review_token != preview.review_token:
                raise OnboardingError("review_changed", 409)
            if not self.output(actor, row).configured:
                OnboardingSetupService(self).configure(actor, row, payload, preview)
            return self.output(actor, row)

    def verify(self, actor, journey_id, revision):
        from app.services.onboarding_setup_service import OnboardingSetupService

        with self.editing(actor):
            row = self.get(actor, journey_id)
            if revision != row.revision:
                raise OnboardingError("stale_revision", 409)
            if not self.output(actor, row).configured:
                raise OnboardingError("configure_first")
            if self.target(actor, self.draft(row)).id != actor.id:
                raise OnboardingError("pilot_login_required")
            # A failed recheck must not leave a previous success displayed.
            row.validated_at = None
            row.evidence_json = "{}"
            self.db.commit()
            draft = self.draft(row)
            audit_context = {"workspace": draft.workspace, "account_id": draft.account_id}
            self.audit(actor, "verification_started", row.id, **audit_context)
            try:
                evidence = OnboardingSetupService(self).verify(actor, row)
            except Exception:
                # Only the workflow outcome is audited, never storage errors,
                # credentials, object keys, or per-request probe details.
                self.audit(actor, "verification_failed", row.id, status="error", **audit_context)
                raise
            row.validated_at = utcnow()
            row.evidence_json = json.dumps({
                **evidence, "source": "automatic", "actor_id": actor.id,
                "at": row.validated_at.isoformat(), "fingerprint": self.fingerprint(actor, row),
            })
            row.updated_at = utcnow()
            self.db.commit()
            self.audit(actor, "verified", row.id, **audit_context)
            return self.output(actor, row)
