# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.domain_errors import S3ConnectionConflictError, S3ConnectionNotFoundError
from app.db.s3_connection import ManagedPrivateAccess, S3Connection as DBS3Connection, UserS3Connection
from app.models.s3_connection import (
    S3_CONNECTION_ENDPOINT_FIELDS,
    S3Connection,
    S3ConnectionCreate,
    S3ConnectionUpdate,
)
from app.models.s3_connection_admin import (
    S3ConnectionAdminCreate,
    S3ConnectionAdminUpdate,
)
from app.services.mappers.s3_connection import s3_connection_from_db
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.s3_connection_associations_service import (
    S3ConnectionAssociationsService,
)
from app.services.s3_connection_capabilities_service import refresh_connection_detected_capabilities
from app.services.s3_connection_endpoint_planner import S3ConnectionEndpointPlanner
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.feature_policy_service import validate_manager_overrides
from app.services.tags_service import TagsService
from app.utils.connection_rgw_identity import normalize_connection_rgw_identity
from app.utils.s3_connection_capabilities import (
    parse_s3_connection_capabilities,
    s3_connection_can_manage_iam,
)
from app.utils.name_ordering import name_order_by
from app.utils.time import utcnow


ACTIVE_MANAGED_SOURCE_DELETE_ERROR = (
    "Delete managed private accesses created from this source connection first"
)
ACTIVE_MANAGED_SOURCE_UPDATE_ERROR = (
    "Connection endpoint and provenance are locked while managed private accesses depend on it"
)
ACTIVE_MANAGED_SOURCE_CREDENTIALS_ERROR = (
    "Connection credentials are locked while managed private accesses depend on this source"
)
_ADMIN_SHARED_SOURCE_IMMUTABLE_FIELDS = S3_CONNECTION_ENDPOINT_FIELDS | {
    "is_active",
    "rgw_user_uid",
    "rgw_tenant",
    "rgw_account_id",
}
_RGW_IDENTITY_FIELDS = {"rgw_user_uid", "rgw_tenant", "rgw_account_id"}
_CONNECTION_CREDENTIAL_FIELDS = {"access_key_id", "secret_access_key"}
_CAPABILITY_PROBE_FIELDS = {
    "storage_endpoint_id",
    "endpoint_url",
    "region",
    "verify_tls",
}
_PRIVATE_SERVER_MANAGED_IMMUTABLE_FIELDS = (
    S3_CONNECTION_ENDPOINT_FIELDS
    | _RGW_IDENTITY_FIELDS
    | _CONNECTION_CREDENTIAL_FIELDS
)
_PRIVATE_MANAGED_SOURCE_IMMUTABLE_FIELDS = (
    S3_CONNECTION_ENDPOINT_FIELDS | _CONNECTION_CREDENTIAL_FIELDS
)


class S3ConnectionsService:
    """CRUD for S3 connections."""

    def __init__(self, db: Session):
        self.db = db
        self.tags = TagsService(db)
        self.associations = S3ConnectionAssociationsService(db)
        self.endpoint_planner = S3ConnectionEndpointPlanner(db)

    def list_for_user(self, user_id: int) -> list[S3Connection]:
        """List connections visible to a UI user."""
        rows = (
            self.db.query(DBS3Connection)
            .outerjoin(UserS3Connection, UserS3Connection.s3_connection_id == DBS3Connection.id)
            .filter(
                ((DBS3Connection.is_shared.is_(False)) & (DBS3Connection.created_by_user_id == user_id))
                | ((DBS3Connection.is_shared.is_(True)) & (UserS3Connection.user_id == user_id)),
            )
            .distinct()
            .order_by(*name_order_by(DBS3Connection))
            .all()
        )
        return [self._to_model(r) for r in rows]

    def list_owned_private(self, user_id: int) -> list[S3Connection]:
        """List private connections managed by the authenticated creator."""
        rows = (
            self.db.query(DBS3Connection)
            .filter(
                DBS3Connection.created_by_user_id == user_id,
                DBS3Connection.is_shared.is_(False),
            )
            .order_by(*name_order_by(DBS3Connection))
            .all()
        )
        return [self._to_model(r) for r in rows]

    @staticmethod
    def admin_shared_predicates():
        """Return the single scope used by every Admin selector."""
        return (DBS3Connection.is_shared.is_(True),)

    def admin_shared_query(self):
        return self.db.query(DBS3Connection).filter(*self.admin_shared_predicates())

    def get_admin_shared(self, connection_id: int) -> DBS3Connection:
        row = self.admin_shared_query().filter(DBS3Connection.id == connection_id).first()
        if row is None:
            raise S3ConnectionNotFoundError("S3Connection not found")
        return row

    def create_admin_shared(
        self,
        created_by_user_id: int,
        payload: S3ConnectionAdminCreate,
    ) -> DBS3Connection:
        storage_endpoint_id, custom_endpoint_config = (
            self.endpoint_planner.plan(
                None,
                payload,
                enforce_manual_endpoint_policy=False,
            )
        )
        rgw_user_uid, rgw_tenant, rgw_account_id = normalize_connection_rgw_identity(
            payload.rgw_user_uid,
            payload.rgw_tenant,
            payload.rgw_account_id,
        )
        row = DBS3Connection(
            created_by_user_id=created_by_user_id,
            name=payload.name,
            storage_endpoint_id=storage_endpoint_id,
            custom_endpoint_config=custom_endpoint_config,
            is_shared=True,
            is_active=True,
            access_manager=True,
            access_browser=False,
            remediation_required=False,
            remediation_reason=None,
            rgw_user_uid=rgw_user_uid,
            rgw_tenant=rgw_tenant,
            rgw_account_id=rgw_account_id,
            access_key_id=payload.access_key_id,
            secret_access_key=payload.secret_access_key,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        self.db.flush()
        self.tags.replace_connection_tags(row, payload.tags)
        self._refresh_detected_capabilities(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def update_admin_shared(
        self,
        row: DBS3Connection,
        payload: S3ConnectionAdminUpdate,
    ) -> DBS3Connection:
        validate_manager_overrides(
            payload,
            load_app_settings_for_db_readonly(self.db).manager.feature_policies,
            row,
        )
        update_credentials = payload.credentials is not None
        endpoint_plan, group_ids, user_ids = self._prepare_admin_shared_update(
            row,
            payload,
            update_credentials=update_credentials,
        )
        payload_data = payload.model_dump(exclude_unset=True)
        endpoint_changed = endpoint_plan is not None and endpoint_plan != (
            row.storage_endpoint_id,
            row.custom_endpoint_config,
        )
        if payload.name is not None:
            row.name = payload.name
        if "is_active" in payload_data:
            row.is_active = bool(payload.is_active)
        if endpoint_plan is not None:
            row.storage_endpoint_id, row.custom_endpoint_config = endpoint_plan
        row.access_browser = False
        if payload.remediation_action == "activate_manager":
            row.access_manager = True
            row.remediation_required = False
            row.remediation_reason = None
            row.is_active = True
        self._apply_rgw_identity_update(row, payload, payload_data)
        if endpoint_changed and not _RGW_IDENTITY_FIELDS.intersection(payload_data):
            row.rgw_user_uid = None
            row.rgw_tenant = None
            row.rgw_account_id = None
        if "allow_activity_history" in payload_data:
            row.allow_activity_history = payload.allow_activity_history
        if "tags" in payload_data:
            self.tags.replace_connection_tags(row, payload.tags)
        self.associations.replace_links(
            row.id,
            group_ids=group_ids,
            user_ids=user_ids,
        )
        if payload.credentials is not None:
            access_key_changed = row.access_key_id != payload.credentials.access_key_id
            row.access_key_id = payload.credentials.access_key_id
            row.secret_access_key = payload.credentials.secret_access_key
            if access_key_changed and not _RGW_IDENTITY_FIELDS.intersection(payload_data):
                row.rgw_user_uid = None
                row.rgw_tenant = None
                row.rgw_account_id = None
        if _CAPABILITY_PROBE_FIELDS & payload_data.keys() or update_credentials:
            self._refresh_detected_capabilities(row)
        row.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(row)
        return row

    def get_owned(self, user_id: int, connection_id: int) -> DBS3Connection:
        row = (
            self.db.query(DBS3Connection)
            .filter(DBS3Connection.created_by_user_id == user_id, DBS3Connection.id == connection_id)
            .first()
        )
        if not row:
            raise S3ConnectionNotFoundError("S3Connection not found")
        if row.is_shared:
            raise S3ConnectionNotFoundError("S3Connection not found")
        return row

    def create(self, user_id: int, payload: S3ConnectionCreate, *, commit: bool = True) -> S3Connection:
        storage_endpoint_id, custom_endpoint_config = (
            self.endpoint_planner.plan(
                None,
                payload,
                enforce_manual_endpoint_policy=True,
            )
        )
        access_manager, access_browser = self._resolve_access_flags(
            access_manager=payload.access_manager,
            access_browser=payload.access_browser,
        )
        rgw_user_uid, rgw_tenant, rgw_account_id = normalize_connection_rgw_identity(
            payload.rgw_user_uid,
            payload.rgw_tenant,
            payload.rgw_account_id,
        )
        row = DBS3Connection(
            created_by_user_id=user_id,
            name=payload.name,
            storage_endpoint_id=storage_endpoint_id,
            custom_endpoint_config=custom_endpoint_config,
            is_shared=False,
            is_active=True,
            access_manager=access_manager,
            access_browser=access_browser,
            rgw_user_uid=rgw_user_uid,
            rgw_tenant=rgw_tenant,
            rgw_account_id=rgw_account_id,
            access_key_id=payload.access_key_id,
            secret_access_key=payload.secret_access_key,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        self.db.flush()
        self.tags.replace_connection_tags(row, payload.tags)
        self._refresh_detected_capabilities(row)
        if commit:
            self.db.commit()
            self.db.refresh(row)
        else:
            self.db.flush()
        return self._to_model(row)

    def update(self, user_id: int, connection_id: int, payload: S3ConnectionUpdate) -> S3Connection:
        row = self.get_owned(user_id, connection_id)
        payload_data = payload.model_dump(exclude_unset=True)
        self._validate_private_update_mutability(row, payload_data)
        endpoint_plan = self._plan_private_endpoint_update(row, payload, payload_data)
        should_probe_iam = self._apply_private_update(
            row,
            payload,
            payload_data,
            endpoint_plan=endpoint_plan,
        )
        if should_probe_iam:
            self._refresh_detected_capabilities(row)
        row.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(row)
        return self._to_model(row)

    def _validate_private_update_mutability(
        self,
        row: DBS3Connection,
        payload_data: dict[str, Any],
    ) -> None:
        if row.server_managed and _PRIVATE_SERVER_MANAGED_IMMUTABLE_FIELDS.intersection(payload_data):
            raise S3ConnectionConflictError(
                "Server-managed connection provenance, endpoint, and credentials are immutable"
            )
        if (
            self.is_active_managed_source(row.id)
            and _PRIVATE_MANAGED_SOURCE_IMMUTABLE_FIELDS.intersection(payload_data)
        ):
            raise S3ConnectionConflictError(
                "Connection endpoint and credentials are locked while managed private accesses depend on it"
            )

    def _plan_private_endpoint_update(
        self,
        row: DBS3Connection,
        payload: S3ConnectionUpdate,
        payload_data: dict[str, Any],
    ) -> Optional[tuple[Optional[int], Optional[str]]]:
        should_validate_existing_manual_endpoint = (
            not row.server_managed and row.storage_endpoint_id is None
        )
        if (
            S3_CONNECTION_ENDPOINT_FIELDS & payload_data.keys()
            or should_validate_existing_manual_endpoint
        ):
            return self.endpoint_planner.plan(
                row,
                payload,
                enforce_manual_endpoint_policy=True,
            )
        return None

    def _apply_private_update(
        self,
        row: DBS3Connection,
        payload: S3ConnectionUpdate,
        payload_data: dict[str, Any],
        *,
        endpoint_plan: Optional[tuple[Optional[int], Optional[str]]],
    ) -> bool:
        endpoint_changed = endpoint_plan is not None and endpoint_plan != (
            row.storage_endpoint_id,
            row.custom_endpoint_config,
        )
        should_probe_iam = False
        if payload.name is not None:
            row.name = payload.name
        if "is_active" in payload_data:
            row.is_active = bool(payload.is_active)
        if endpoint_plan is not None:
            row.storage_endpoint_id, row.custom_endpoint_config = endpoint_plan
            should_probe_iam = bool(_CAPABILITY_PROBE_FIELDS & payload_data.keys())
        access_key_changed = payload.access_key_id is not None and row.access_key_id != payload.access_key_id
        if payload.access_key_id is not None:
            row.access_key_id = payload.access_key_id
            should_probe_iam = True
        if payload.secret_access_key is not None:
            row.secret_access_key = payload.secret_access_key
            should_probe_iam = True
        if "access_manager" in payload_data or "access_browser" in payload_data:
            access_manager, access_browser = self._resolve_access_flags(
                access_manager=payload.access_manager if "access_manager" in payload_data else bool(row.access_manager),
                access_browser=payload.access_browser if "access_browser" in payload_data else bool(row.access_browser),
            )
            row.access_manager = access_manager
            row.access_browser = access_browser
        self._apply_rgw_identity_update(row, payload, payload_data)
        if (access_key_changed or endpoint_changed) and not _RGW_IDENTITY_FIELDS.intersection(payload_data):
            row.rgw_user_uid = None
            row.rgw_tenant = None
            row.rgw_account_id = None
        if "tags" in payload_data:
            self.tags.replace_connection_tags(row, payload.tags)
        return should_probe_iam

    def delete(self, user_id: int, connection_id: int) -> None:
        row = self.get_owned(user_id, connection_id)
        if row.server_managed:
            raise S3ConnectionConflictError(
                "Server-managed connections must be deleted by the provisioning service"
            )
        if self.is_active_managed_source(row.id):
            raise S3ConnectionConflictError(ACTIVE_MANAGED_SOURCE_DELETE_ERROR)
        self._delete_entry(row)

    def delete_admin_shared(self, row: DBS3Connection) -> None:
        if self.is_active_managed_source(row.id):
            raise S3ConnectionConflictError(ACTIVE_MANAGED_SOURCE_DELETE_ERROR)
        self._delete_entry(row)

    def _prepare_admin_shared_update(
        self,
        row: DBS3Connection,
        payload: S3ConnectionAdminUpdate,
        *,
        update_credentials: bool,
    ) -> tuple[
        Optional[tuple[Optional[int], Optional[str]]],
        Optional[list[int]],
        Optional[list[int]],
    ]:
        fields_set = payload.model_fields_set
        if (
            self.is_active_managed_source(row.id)
            and _ADMIN_SHARED_SOURCE_IMMUTABLE_FIELDS & fields_set
        ):
            raise S3ConnectionConflictError(ACTIVE_MANAGED_SOURCE_UPDATE_ERROR)
        if update_credentials and self.is_active_managed_source(row.id):
            raise S3ConnectionConflictError(ACTIVE_MANAGED_SOURCE_CREDENTIALS_ERROR)
        endpoint_plan = None
        if S3_CONNECTION_ENDPOINT_FIELDS & fields_set:
            endpoint_plan = self.endpoint_planner.plan(
                row,
                payload,
                enforce_manual_endpoint_policy=False,
            )
        group_ids, user_ids = self.associations.validate_updates(
            group_ids=payload.group_ids,
            user_ids=payload.user_ids,
        )
        return endpoint_plan, group_ids, user_ids

    def _delete_entry(self, row: DBS3Connection) -> None:
        context_id = f"conn-{row.id}"
        purge = ResourceDeletionPurgeService(self.db)
        try:
            purge.validate_execution_context_cleanup(context_id)
        except ValueError as exc:
            raise S3ConnectionConflictError(str(exc)) from exc
        domain_kind, _owner_user_id = self.tags.resolve_connection_domain(row)
        self.associations.delete_links(row.id)
        purge.purge_execution_context_data(context_id)
        self.db.delete(row)
        self.db.flush()
        self.tags.cleanup_orphan_definitions(domain_kinds=[domain_kind])
        self.db.commit()

    def _resolve_access_flags(self, *, access_manager: Optional[bool], access_browser: Optional[bool]) -> tuple[bool, bool]:
        manager = bool(access_manager)
        browser = bool(access_browser)
        if not manager and not browser:
            raise ValueError("At least one access flag must be enabled")
        return manager, browser

    def _refresh_detected_capabilities(self, row: DBS3Connection) -> None:
        refresh_connection_detected_capabilities(row)

    @staticmethod
    def _apply_rgw_identity_update(
        row: DBS3Connection,
        payload: S3ConnectionUpdate | S3ConnectionAdminUpdate,
        payload_data: dict[str, Any],
    ) -> None:
        if not _RGW_IDENTITY_FIELDS.intersection(payload_data):
            return
        user_uid, tenant, account_id = normalize_connection_rgw_identity(
            payload.rgw_user_uid if "rgw_user_uid" in payload_data else row.rgw_user_uid,
            payload.rgw_tenant if "rgw_tenant" in payload_data else row.rgw_tenant,
            payload.rgw_account_id if "rgw_account_id" in payload_data else row.rgw_account_id,
        )
        row.rgw_user_uid = user_uid
        row.rgw_tenant = tenant
        row.rgw_account_id = account_id

    def _capabilities(self, row: DBS3Connection) -> dict[str, Any]:
        return parse_s3_connection_capabilities(row.capabilities_json)

    def _to_model(self, row: DBS3Connection) -> S3Connection:
        return s3_connection_from_db(
            row,
            capabilities=self._capabilities(row),
            tags=self.tags.get_connection_tags(row),
        )

    def serialize(self, row: DBS3Connection) -> S3Connection:
        return self._to_model(row)

    def touch_usage(self, row: DBS3Connection) -> None:
        now = utcnow()
        (
            self.db.query(DBS3Connection)
            .filter(DBS3Connection.id == row.id)
            .update(
                {
                    DBS3Connection.last_used_at: now,
                    DBS3Connection.updated_at: now,
                },
                synchronize_session=False,
            )
        )
        self.db.commit()
        self.db.refresh(row)

    def is_active_managed_source(self, connection_id: int) -> bool:
        return (
            self.db.query(ManagedPrivateAccess.id)
            .filter(
                ManagedPrivateAccess.source_context_type == "connection",
                ManagedPrivateAccess.source_context_id == connection_id,
                ManagedPrivateAccess.state.in_(("provisioning", "active", "deleting", "cleanup_pending")),
            )
            .first()
            is not None
        )
