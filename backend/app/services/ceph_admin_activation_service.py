# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import StorageEndpoint
from app.services.app_settings_service import (
    _load_persisted_settings_from_db, _save_persisted_settings_to_db,
    get_general_feature_locks, load_app_settings_for_db_readonly,
)
from app.services.endpoint_service_identities import EndpointServiceIdentityService
from app.services.operation_lease_service import OperationLeaseService


class CephAdminActivationService:
    def __init__(self, db, actor):
        self.db, self.actor = db, actor

    def apply(self, *, enabled, endpoint_ids, grant_current_user=False):
        lock = get_general_feature_locks().ceph_admin_enabled
        if lock.forced and lock.value != enabled:
            raise ValueError(f"Ceph Admin is locked by {lock.source}.")
        lease = OperationLeaseService(self.db)
        handle = lease.acquire("ceph-admin:activation", ttl_seconds=7200)
        if handle is None:
            raise ValueError("Ceph Admin activation is already running.")
        try:
            endpoints = self.db.query(StorageEndpoint).filter(StorageEndpoint.provider == "ceph").all()
            selected = set(endpoint_ids)
            if enabled and (not selected or not selected <= {ep.id for ep in endpoints}):
                raise ValueError("Select at least one existing Ceph endpoint.")
            identities = EndpointServiceIdentityService(self.db, actor=self.actor)
            if enabled:
                for endpoint in endpoints:
                    if endpoint.id in selected:
                        _, permissions = identities.admin_permissions(endpoint)
                        if not permissions.users_write:
                            raise ValueError(f"Endpoint '{endpoint.name}' requires Admin Ops users=write.")
                for endpoint in endpoints:
                    endpoint.ceph_admin_allowed = endpoint.id in selected
                self.db.commit()
            # Workspace access is stopped before remote revocation on disable.
            settings = _load_persisted_settings_from_db(self.db).model_copy(deep=True)
            settings.general.ceph_admin_enabled = enabled
            _save_persisted_settings_to_db(self.db, settings)
            results = []
            for endpoint in endpoints:
                operation_error = None
                try:
                    identities.reconcile(endpoint, ceph_admin_enabled=enabled)
                except (ValueError, RuntimeError):
                    # Other endpoints continue; stored state exposes pending work.
                    self.db.rollback()
                    operation_error = "Configuration is pending; retry when the endpoint identity workflow is available."
                identity = endpoint.service_identity("ceph_admin")
                active = bool(not operation_error and enabled and endpoint.ceph_admin_allowed and identity and identity.mode == "managed"
                              and identity.status == "ready")
                results.append({"endpoint_id": endpoint.id, "active": active,
                                "status": identity.status if identity else "disabled",
                                "error": operation_error or (identity.last_error if identity else None)})
            if enabled and grant_current_user and any(row["active"] for row in results):
                from app.models.user import UserUpdate
                from app.services.users_service import get_users_service
                get_users_service(self.db).update_user(self.actor.id, UserUpdate(can_access_ceph_admin=True))
            return {"enabled": load_app_settings_for_db_readonly(self.db).general.ceph_admin_enabled, "endpoints": results}
        finally:
            lease.release(handle)
