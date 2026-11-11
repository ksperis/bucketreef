# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.db import AuthSession, User
from app.db.openstack import OpenStackCloud, OpenStackConnection, OpenStackProjectContext, OpenStackProjectCredential, OpenStackSession
from app.models.execution_context import (
    ExecutionContext,
    ExecutionContextCapabilities,
    OpenStackExecutionContextMetadata,
)
from app.models.openstack import (
    OpenStackAuthenticate,
    OpenStackCloudWrite,
    OpenStackPrivateConnectionCreate,
)
from app.models.s3_connection import S3Connection, S3ConnectionCreate
from app.services.access_context_contracts import AccountCapabilities
from app.services.keystone_client import KeystoneClient, KeystoneIdentity, OpenStackError
from app.services.openstack_access_policy import can_connect_openstack_cloud
from app.services.rgw_iam import get_iam_client
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_endpoint_repository import StorageEndpointRepository
from app.services.tags_service import TagsService
from app.utils.s3_endpoint import resolve_s3_client_options, validate_openstack_catalog_s3_endpoint
from app.utils.storage_endpoint_features import (
    resolve_endpoint_capabilities,
    resolve_iam_endpoint,
    resolve_iam_signing_region,
)
from app.utils.time import utcnow


def _resolve_guard_context(
    db: Session,
    user: User,
    auth_id: str,
    context_ref: str,
) -> S3ExecutionContext:
    return OpenStackService(db).resolve(user, auth_id, context_ref, attach_guard=False)


@dataclass(frozen=True)
class _OpenStackSessionSnapshot:
    user_id: int
    connection_id: str
    cloud_id: int
    cloud_name: str
    auth_url: str
    session_id: str
    token: str
    keystone_user_id: str
    display_name: str
    expires_at: datetime


class OpenStackService:
    def __init__(self, db: Session):
        self.db = db

    def enabled(self) -> bool:
        from app.services.app_settings_service import load_app_settings_for_db
        return load_app_settings_for_db(self.db).general.openstack_enabled

    def require_enabled(self) -> None:
        if not self.enabled():
            raise OpenStackError("feature_disabled", "OpenStack feature is disabled", 403)

    def allowed_clouds(self, user: User) -> list[OpenStackCloud]:
        if not self.enabled():
            return []
        return [cloud for cloud in self.db.scalars(select(OpenStackCloud).order_by(OpenStackCloud.name)).all()
                if can_connect_openstack_cloud(self.db, user, cloud)]

    def user_connections(self, user: User, auth_id: str) -> list[dict]:
        rows = self.db.scalars(
            select(OpenStackConnection).where(OpenStackConnection.user_id == user.id)
        ).all()
        return [self.connection_read(row, user, auth_id) for row in rows]

    def cloud(self, user: User, cloud_id: int) -> OpenStackCloud:
        self.require_enabled()
        cloud = self.db.get(OpenStackCloud, cloud_id, populate_existing=True)
        if cloud is None or not can_connect_openstack_cloud(self.db, user, cloud):
            raise OpenStackError("cloud_not_found", "OpenStack cloud is not available", 404)
        return cloud

    def save_cloud(self, payload: OpenStackCloudWrite, cloud_id: int | None = None) -> OpenStackCloud:
        self.require_enabled()
        values = payload.model_dump()

        def persist(write_db: Session) -> int:
            scoped = self if write_db is self.db else OpenStackService(write_db)
            cloud = (
                write_db.scalar(
                    select(OpenStackCloud)
                    .where(OpenStackCloud.id == cloud_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if cloud_id is not None
                else OpenStackCloud()
            )
            if cloud is None:
                raise OpenStackError(
                    "cloud_not_found", "OpenStack cloud not found", 404
                )
            # Invalidate before changing trust or grants, even when a cloud is
            # merely disabled.
            if cloud_id is not None:
                write_db.expire(cloud, ["connections"])
                cloud.config_version += 1
                for connection in cloud.connections:
                    scoped._erase_connection(connection)
            for name, value in values.items():
                setattr(cloud, name, value)
            write_db.add(cloud)
            write_db.flush()
            return int(cloud.id)

        try:
            persisted_id = run_replayable_db_unit(self.db, persist)
        except IntegrityError:
            raise OpenStackError("cloud_conflict", "OpenStack cloud name already exists", 409) from None
        cloud = self.db.get(OpenStackCloud, persisted_id, populate_existing=True)
        if cloud is None:  # pragma: no cover - defensive consistency check
            raise OpenStackError("cloud_not_found", "OpenStack cloud not found", 404)
        return cloud

    def invalidate_user_access(self, user_ids: set[int], cloud_ids: set[int]) -> None:
        if not user_ids or not cloud_ids:
            return
        connections = self.db.scalars(
            select(OpenStackConnection).where(
                OpenStackConnection.user_id.in_(user_ids),
                OpenStackConnection.cloud_id.in_(cloud_ids),
            )
        ).all()
        for connection in connections:
            self._erase_connection(connection)

    def invalidate_cloud_access(self, cloud_ids: set[int]) -> None:
        if not cloud_ids:
            return
        connections = self.db.scalars(
            select(OpenStackConnection).where(OpenStackConnection.cloud_id.in_(cloud_ids))
        ).all()
        for connection in connections:
            self._erase_connection(connection)

    def delete_cloud(self, cloud_id: int) -> None:
        self.require_enabled()

        def persist(write_db: Session) -> None:
            cloud = write_db.get(OpenStackCloud, cloud_id)
            if cloud is None:
                raise OpenStackError(
                    "cloud_not_found", "OpenStack cloud not found", 404
                )
            write_db.delete(cloud)

        run_replayable_db_unit(self.db, persist)

    def _auth(self, user: User, auth_id: str, *, lock: bool = False) -> AuthSession:
        statement = select(AuthSession).where(AuthSession.id == auth_id).execution_options(populate_existing=True)
        if lock:
            statement = statement.with_for_update()
        auth = self.db.scalar(statement)
        now = utcnow()
        current_user = self.db.get(User, user.id, populate_existing=True)
        if (not auth or auth.user_id != user.id or auth.principal_type != "user"
                or auth.revoked_at or min(auth.idle_expires_at, auth.absolute_expires_at) <= now
                or not current_user or not current_user.is_active or auth.auth_version != current_user.auth_version):
            raise OpenStackError("reauthentication_required", "The BucketReef session is no longer active")
        return auth

    def owned(self, user: User, connection_id: str) -> OpenStackConnection:
        row = self.db.get(OpenStackConnection, connection_id, populate_existing=True)
        if row is None or row.user_id != user.id:
            raise OpenStackError("connection_not_found", "OpenStack connection not found", 404)
        return row

    def _session(
        self,
        user: User,
        auth_id: str,
        connection: OpenStackConnection,
        *,
        expected_id: str | None = None,
        persist_expiration: bool = True,
    ) -> OpenStackSession:
        self._auth(user, auth_id)
        self.cloud(user, connection.cloud_id)
        row = self.db.scalar(select(OpenStackSession).where(
            OpenStackSession.connection_id == connection.id, OpenStackSession.auth_session_id == auth_id,
        ).execution_options(populate_existing=True))
        now = utcnow()
        if (
            persist_expiration
            and row is not None
            and row.expires_at <= now
            and row.token
        ):
            session_id = str(row.id)

            def persist_expiration_cleanup(write_db: Session) -> None:
                current = write_db.get(OpenStackSession, session_id)
                if (
                    current is None
                    or not current.token
                    or current.expires_at > now
                ):
                    return
                write_db.execute(
                    delete(OpenStackProjectCredential).where(
                        OpenStackProjectCredential.session_id == session_id
                    )
                )
                current.token = None

            run_replayable_db_unit(self.db, persist_expiration_cleanup)
            row = self.db.get(OpenStackSession, session_id, populate_existing=True)
        if not row or not row.token or row.cloud_version != connection.cloud.config_version or row.expires_at <= now or (expected_id is not None and row.id != expected_id):
            raise OpenStackError("reauthentication_required", "Reconnect to OpenStack")
        return row

    @staticmethod
    def _identity(connection: OpenStackConnection, session: OpenStackSession) -> KeystoneIdentity:
        return KeystoneIdentity(session.token, connection.keystone_user_id, connection.display_name, session.expires_at)

    def _snapshot_session_for_io(
        self,
        user: User,
        auth_id: str,
        connection_id: str,
    ) -> _OpenStackSessionSnapshot:
        connection = self.owned(user, connection_id)
        session = self._session(user, auth_id, connection)
        snapshot = _OpenStackSessionSnapshot(
            user_id=int(user.id),
            connection_id=str(connection.id),
            cloud_id=int(connection.cloud_id),
            cloud_name=str(connection.cloud.name),
            auth_url=str(connection.cloud.auth_url),
            session_id=str(session.id),
            token=str(session.token),
            keystone_user_id=str(connection.keystone_user_id),
            display_name=str(connection.display_name),
            expires_at=session.expires_at,
        )
        self.db.rollback()
        return snapshot

    def _revalidate_session_snapshot(
        self,
        snapshot: _OpenStackSessionSnapshot,
        auth_id: str,
    ) -> tuple[User, OpenStackConnection, OpenStackSession]:
        user = self.db.get(User, snapshot.user_id, populate_existing=True)
        if user is None:
            raise OpenStackError("reauthentication_required", "The BucketReef session is no longer active")
        connection = self.owned(user, snapshot.connection_id)
        session = self._session(
            user,
            auth_id,
            connection,
            expected_id=snapshot.session_id,
        )
        return user, connection, session

    def authenticate(self, user: User, auth_id: str, payload: OpenStackAuthenticate) -> OpenStackConnection:
        self._auth(user, auth_id)
        cloud = self.cloud(user, payload.cloud_id)
        if not (cloud.allow_password if payload.method == "password" else cloud.allow_token):
            raise OpenStackError("method_disabled", "This authentication method is disabled", 403)
        user_id = int(user.id)
        cloud_id = int(cloud.id)
        auth_url = str(cloud.auth_url)
        default_domain = str(cloud.default_domain)
        expected_version = cloud.config_version
        self.db.rollback()
        identity = KeystoneClient(auth_url).authenticate(payload, default_domain)
        identity_user_id = str(identity.user_id)
        identity_name = str(identity.name)
        identity_token = str(identity.token)
        identity_expires_at = identity.expires_at
        new_connection_id = str(uuid4())
        new_connection_created_at = utcnow()
        new_session_id = str(uuid4())

        def persist(write_db: Session) -> str:
            scoped = self if write_db is self.db else OpenStackService(write_db)
            current_user = write_db.get(User, user_id, populate_existing=True)
            if current_user is None:
                raise OpenStackError("reauthentication_required", "The BucketReef session is no longer active")
            auth = scoped._auth(current_user, auth_id, lock=True)
            write_db.scalar(
                select(OpenStackCloud)
                .where(OpenStackCloud.id == cloud_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            current_cloud = scoped.cloud(current_user, cloud_id)
            if current_cloud.config_version != expected_version:
                raise OpenStackError("configuration_changed", "OpenStack configuration changed; reconnect")
            connection = write_db.scalar(select(OpenStackConnection).where(
                OpenStackConnection.user_id == user_id,
                OpenStackConnection.cloud_id == cloud_id,
                OpenStackConnection.keystone_user_id == identity_user_id,
            ))
            if connection is None:
                connection = OpenStackConnection(
                    id=new_connection_id,
                    user_id=user_id,
                    cloud_id=cloud_id,
                    keystone_user_id=identity_user_id,
                    display_name=identity_name,
                    created_at=new_connection_created_at,
                )
                write_db.add(connection)
                write_db.flush()
            for old in write_db.scalars(select(OpenStackSession).where(
                OpenStackSession.connection_id == connection.id,
                OpenStackSession.auth_session_id == auth_id,
            )).all():
                write_db.delete(old)
            write_db.flush()
            write_db.add(OpenStackSession(
                id=new_session_id,
                connection_id=connection.id,
                auth_session_id=auth_id,
                token=identity_token,
                cloud_version=expected_version,
                expires_at=min(identity_expires_at, auth.absolute_expires_at),
            ))
            connection_id = str(connection.id)
            return connection_id

        connection_id = run_replayable_db_unit(self.db, persist)
        connection = self.db.get(OpenStackConnection, connection_id, populate_existing=True)
        if connection is None:
            raise OpenStackError("connection_not_found", "OpenStack connection not found", 404)
        return connection

    def connection_read(self, connection: OpenStackConnection, user: User, auth_id: str) -> dict:
        session = self.db.scalar(select(OpenStackSession).where(OpenStackSession.connection_id == connection.id, OpenStackSession.auth_session_id == auth_id))
        connected = False
        try:
            self._session(user, auth_id, connection)
            connected = True
        except OpenStackError:
            pass
        return dict(id=connection.id, cloud_id=connection.cloud_id, cloud_name=connection.cloud.name,
                    display_name=connection.display_name, keystone_user_id=connection.keystone_user_id,
                    connected=connected, expires_at=session.expires_at if connected else None)

    def _managed_endpoint(self, endpoint_url: str):
        try:
            canonical_url = validate_openstack_catalog_s3_endpoint(endpoint_url)
        except ValueError:
            return None
        return StorageEndpointRepository(self.db).find_by_url(canonical_url)

    def _annotate_targets(self, cloud: OpenStackCloud, targets: list[dict]) -> list[dict]:
        annotated = []
        for target in targets:
            endpoint = self._managed_endpoint(target["endpoint_url"])
            annotated.append({
                **target,
                "storage_endpoint_id": endpoint.id if endpoint is not None else None,
                "storage_endpoint_name": endpoint.name if endpoint is not None else None,
                "allowed": not cloud.managed_endpoints_only or endpoint is not None,
            })
        return annotated

    def project_access(self, user: User, auth_id: str, connection_id: str, project_id: str) -> dict:
        """Resolve the selected project's current S3 catalog targets and EC2 credentials."""
        snapshot = self._snapshot_session_for_io(user, auth_id, connection_id)
        client = KeystoneClient(snapshot.auth_url)
        projects = client.projects(snapshot.token)
        project = next((item for item in projects if item["id"] == project_id), None)
        if project is None:
            raise OpenStackError("project_not_allowed", "OpenStack project is not available", 403)
        access = client.project_access(
            KeystoneIdentity(
                snapshot.token,
                snapshot.keystone_user_id,
                snapshot.display_name,
                snapshot.expires_at,
            ),
            project_id,
        )
        _current_user, connection, _session = self._revalidate_session_snapshot(snapshot, auth_id)
        available_access_keys = {credential["access"] for credential in access["credentials"]}
        selected_credential = self.db.scalar(
            select(OpenStackProjectCredential)
            .join(OpenStackProjectContext, OpenStackProjectCredential.context_id == OpenStackProjectContext.id)
            .where(
                OpenStackProjectCredential.session_id == snapshot.session_id,
                OpenStackProjectCredential.secret_key.is_not(None),
                OpenStackProjectCredential.expires_at > utcnow(),
                OpenStackProjectContext.connection_id == connection.id,
                OpenStackProjectContext.project_id == project_id,
            )
            .order_by(OpenStackProjectCredential.validated_at.desc(), OpenStackProjectCredential.id.desc())
        )
        result = {
            "project": project,
            "targets": self._annotate_targets(connection.cloud, access["targets"]),
            "credentials": access["credentials"],
            "selected_access_key": (
                selected_credential.access_key
                if selected_credential is not None and selected_credential.access_key in available_access_keys
                else None
            ),
        }
        self.db.rollback()
        return result

    def projects(self, user: User, auth_id: str, connection_id: str) -> list[dict]:
        """Return every Keystone project currently available to one connected identity."""
        snapshot = self._snapshot_session_for_io(user, auth_id, connection_id)
        projects = KeystoneClient(snapshot.auth_url).projects(snapshot.token)
        self._revalidate_session_snapshot(snapshot, auth_id)
        result = [
            {
                "project_id": project["id"],
                "project_name": project["name"],
                "project_domain_id": project.get("domain_id"),
            }
            for project in sorted(projects, key=lambda item: (item["name"].casefold(), item["id"]))
        ]
        self.db.rollback()
        return result

    @staticmethod
    def _select_project_target(access: dict, target_id: str) -> dict:
        target = next(
            (item for item in access["targets"] if item["target_id"] == target_id),
            None,
        )
        if target is None or not target["allowed"]:
            raise OpenStackError(
                "endpoint_not_allowed",
                "S3 region is not available for this project",
                403,
            )
        return target

    @staticmethod
    def _select_project_credential(access: dict, access_key: str | None) -> dict:
        keys = access["credentials"]
        if not keys:
            raise OpenStackError(
                "no_ec2_credentials",
                "Create an EC2 credential for this project in OpenStack",
            )
        if access_key is None and len(keys) != 1:
            raise OpenStackError(
                "credential_selection_required",
                "Select an EC2 credential",
            )
        key = (
            next((item for item in keys if item["access"] == access_key), None)
            if access_key
            else keys[0]
        )
        if key is None:
            raise OpenStackError(
                "credential_not_allowed",
                "EC2 credential is not available for this project",
                403,
            )
        return key

    def create_private_connection(
        self,
        user: User,
        auth_id: str,
        connection_id: str,
        project_id: str,
        payload: OpenStackPrivateConnectionCreate,
    ) -> S3Connection:
        """Copy one current project EC2 credential into a durable private S3 connection."""
        connection = self.owned(user, connection_id)
        cloud = self.cloud(user, connection.cloud_id)
        session = self._session(user, auth_id, connection)
        session_id = session.id
        access = self.project_access(user, auth_id, connection_id, project_id)
        target = self._select_project_target(access, payload.target_id)
        key = self._select_project_credential(access, payload.access_key)

        self._auth(user, auth_id, lock=True)
        self.db.scalar(
            select(OpenStackCloud)
            .where(OpenStackCloud.id == cloud.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        self._session(user, auth_id, connection, expected_id=session_id)

        endpoint_fields = (
            {"storage_endpoint_id": target["storage_endpoint_id"]}
            if target["storage_endpoint_id"] is not None
            else {
                "endpoint_url": target["endpoint_url"],
                "region": target["region_id"],
            }
        )
        return S3ConnectionsService(self.db).create_from_validated_endpoint(
            user.id,
            S3ConnectionCreate(
                name=payload.connection_name,
                **endpoint_fields,
                access_key_id=key["access"],
                secret_access_key=key["secret"],
                access_manager=payload.access_manager,
                access_browser=payload.access_browser,
            ),
        )

    @staticmethod
    def _is_catalog_context(context: OpenStackProjectContext) -> bool:
        return bool(
            context.target_id
            and context.region_id
            and context.endpoint_url
            and context.endpoint_interface in {"public", "internal"}
        )

    def _active_sessions(self, user: User, auth_id: str | None) -> list[OpenStackSession]:
        if not auth_id:
            return []
        try:
            self._auth(user, auth_id)
        except OpenStackError:
            return []
        allowed_cloud_ids = {cloud.id for cloud in self.allowed_clouds(user)}
        now = utcnow()
        sessions = self.db.scalars(
            select(OpenStackSession)
            .join(OpenStackConnection)
            .where(
                OpenStackConnection.user_id == user.id,
                OpenStackSession.auth_session_id == auth_id,
            )
            .execution_options(populate_existing=True)
        ).all()
        return [
            session
            for session in sessions
            if session.connection.cloud_id in allowed_cloud_ids
            and session.token
            and session.expires_at > now
            and session.cloud_version == session.connection.cloud.config_version
        ]

    def pending_connection_count(self, user: User, auth_id: str | None) -> int:
        """Count connected identities that do not already expose an executable context.

        This remains a local database check so workspace discovery never makes
        workspace-access depend on Keystone network availability.
        """
        now = utcnow()
        pending = 0
        for session in self._active_sessions(user, auth_id):
            executable = any(
                credential.secret_key
                and credential.expires_at > now
                and self._is_catalog_context(credential.context)
                for credential in session.credentials
            )
            if not executable:
                pending += 1
        return pending

    def project_options(self, user: User, auth_id: str) -> dict:
        """Return Keystone projects that still need a session-bound S3 context."""
        result: list[dict] = []
        warnings: list[dict] = []
        now = utcnow()
        user_id = int(user.id)
        session_summaries = [
            {
                "connection_id": str(session.connection.id),
                "cloud_id": int(session.connection.cloud.id),
                "cloud_name": str(session.connection.cloud.name),
                "identity_name": str(session.connection.display_name),
                "keystone_user_id": str(session.connection.keystone_user_id),
            }
            for session in self._active_sessions(user, auth_id)
        ]
        self.db.rollback()
        for summary in session_summaries:
            connection_id = summary["connection_id"]
            try:
                projects = self.projects(user, auth_id, connection_id)
            except OpenStackError as exc:
                warnings.append({
                    "connection_id": connection_id,
                    "cloud_name": summary["cloud_name"],
                    "identity_name": summary["identity_name"],
                    "code": exc.code,
                })
                continue
            current_user = self.db.get(User, user_id, populate_existing=True)
            if current_user is None:
                continue
            connection = self.owned(current_user, connection_id)
            session = self._session(current_user, auth_id, connection)
            active_project_ids = {
                credential.context.project_id
                for credential in session.credentials
                if credential.secret_key
                and credential.expires_at > now
                and self._is_catalog_context(credential.context)
            }
            self.db.rollback()
            for project in sorted(
                projects,
                key=lambda item: (item["project_name"].casefold(), item["project_id"]),
            ):
                if project["project_id"] in active_project_ids:
                    continue
                result.append({
                    "connection_id": connection_id,
                    "cloud_id": summary["cloud_id"],
                    "cloud_name": summary["cloud_name"],
                    "identity_name": summary["identity_name"],
                    "keystone_user_id": summary["keystone_user_id"],
                    "project_id": project["project_id"],
                    "project_name": project["project_name"],
                    "project_domain_id": project.get("project_domain_id"),
                })
        return {"options": result, "warnings": warnings}

    def activate(self, user: User, auth_id: str, connection_id: str, project_id: str, target_id: str, access_key: str | None) -> str:
        user_id = int(user.id)
        initial = self._snapshot_session_for_io(user, auth_id, connection_id)
        session_id = initial.session_id
        access = self.project_access(user, auth_id, connection_id, project_id)
        project = access["project"]
        target = self._select_project_target(access, target_id)
        key = self._select_project_credential(access, access_key)
        cloud_id = int(initial.cloud_id)
        project_name = str(project["name"])
        target_region_id = str(target["region_id"])
        target_endpoint_url = str(target["endpoint_url"])
        target_endpoint_name = str(target["service_name"] or target["region_id"])
        target_interface = str(target["interface"])
        target_service_type = str(target["service_type"])
        key_access = str(key["access"])
        key_secret = key["secret"]
        key_expires_at = key["expires_at"]
        validated_at = utcnow()
        new_context_id = str(uuid4())
        new_credential_id = str(uuid4())

        def persist_context(write_db: Session) -> tuple[str, str]:
            scoped = self if write_db is self.db else OpenStackService(write_db)
            current_user = write_db.get(User, user_id, populate_existing=True)
            if current_user is None:
                raise OpenStackError("reauthentication_required", "The BucketReef session is no longer active")
            scoped._auth(current_user, auth_id, lock=True)
            write_db.scalar(
                select(OpenStackCloud)
                .where(OpenStackCloud.id == cloud_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            connection = scoped.owned(current_user, connection_id)
            session = scoped._session(
                current_user,
                auth_id,
                connection,
                expected_id=session_id,
                persist_expiration=False,
            )
            context = write_db.scalar(select(OpenStackProjectContext).where(
                OpenStackProjectContext.connection_id == connection.id,
                OpenStackProjectContext.project_id == project_id,
                OpenStackProjectContext.target_id == target_id,
            ))
            if context is None:
                context = OpenStackProjectContext(
                    id=new_context_id,
                    connection_id=connection.id,
                    project_id=project_id,
                    project_name=project_name,
                    target_id=target_id,
                    region_id=target_region_id,
                    endpoint_url=target_endpoint_url,
                    endpoint_name=target_endpoint_name,
                    endpoint_interface=target_interface,
                    service_type=target_service_type,
                )
                write_db.add(context)
                write_db.flush()
            else:
                context.project_name = project_name
                context.region_id = target_region_id
                context.endpoint_url = target_endpoint_url
                context.endpoint_name = target_endpoint_name
                context.endpoint_interface = target_interface
                context.service_type = target_service_type
            write_db.execute(delete(OpenStackProjectCredential).where(
                OpenStackProjectCredential.session_id == session.id,
                OpenStackProjectCredential.context_id == context.id,
            ))
            credential = OpenStackProjectCredential(
                id=new_credential_id,
                session_id=session.id,
                context_id=context.id,
                access_key=key_access,
                secret_key=key_secret,
                expires_at=min(key_expires_at, session.expires_at),
                validated_at=validated_at,
                can_manage_iam=False,
            )
            write_db.add(credential)
            write_db.flush()
            context_id = str(context.id)
            credential_id = str(credential.id)
            return context_id, credential_id

        context_id, credential_id = run_replayable_db_unit(self.db, persist_context)
        context = self.db.get(OpenStackProjectContext, context_id, populate_existing=True)
        credential = self.db.get(OpenStackProjectCredential, credential_id, populate_existing=True)
        if context is None or credential is None:
            raise OpenStackError("reauthentication_required", "Reconnect to OpenStack")
        execution = self._execution(context, credential, auth_id)
        endpoint = execution.storage_endpoint
        iam_endpoint = resolve_iam_endpoint(endpoint) if endpoint else None
        iam_region = resolve_iam_signing_region(endpoint) if endpoint else None
        _, _, _, verify_tls = resolve_s3_client_options(execution)
        probe_access_key = execution.access_key
        probe_secret_key = execution.secret_key
        self.db.rollback()
        can_manage_iam = self._probe_iam(
            probe_access_key,
            probe_secret_key,
            iam_endpoint,
            iam_region,
            verify_tls,
        )

        def persist_capability(write_db: Session) -> None:
            scoped = self if write_db is self.db else OpenStackService(write_db)
            current_user = write_db.get(User, user_id, populate_existing=True)
            if current_user is None:
                raise OpenStackError("reauthentication_required", "The BucketReef session is no longer active")
            scoped._auth(current_user, auth_id, lock=True)
            connection = scoped.owned(current_user, connection_id)
            scoped._session(
                current_user,
                auth_id,
                connection,
                expected_id=session_id,
                persist_expiration=False,
            )
            current = write_db.get(OpenStackProjectCredential, credential_id)
            if current is None or current.context_id != context_id:
                raise OpenStackError("reauthentication_required", "Reconnect to OpenStack")
            current.can_manage_iam = can_manage_iam

        run_replayable_db_unit(self.db, persist_capability)
        return f"os-{context_id}"

    @staticmethod
    def _probe_iam(
        access_key: str | None,
        secret_key: str | None,
        iam_endpoint: str | None,
        iam_region: str | None,
        verify_tls: bool,
    ) -> bool:
        if not iam_endpoint or not access_key or not secret_key:
            return False
        try:
            get_iam_client(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=iam_endpoint,
                region=iam_region,
                verify_tls=verify_tls,
            ).list_users(MaxItems=1)
            return True
        except (ClientError, BotoCoreError):
            return False

    def _execution(self, context, credential, auth_id) -> S3ExecutionContext:
        endpoint = self._managed_endpoint(context.endpoint_url)
        return S3ExecutionContext(
            context_id=f"os-{context.id}", context_kind="openstack_project",
            name=f"{context.connection.cloud.name} / {context.connection.display_name} / {context.project_name} / {context.region_id}",
            access_key=credential.access_key, secret_key=credential.secret_key,
            storage_endpoint_id=endpoint.id if endpoint is not None else None,
            storage_endpoint=endpoint,
            session_endpoint=context.endpoint_url,
            session_region=context.region_id,
            session_force_path_style=endpoint.force_path_style if endpoint is not None else False,
            session_verify_tls=endpoint.verify_tls if endpoint is not None else True,
            execution_auth_session_id=auth_id, credential_expires_at=credential.expires_at,
            openstack_session_id=credential.session_id,
            manager_capabilities=AccountCapabilities(can_manage_buckets=True, can_manage_iam=credential.can_manage_iam),
        )

    def _resolve_project_context(self, user: User, context_ref: str) -> OpenStackProjectContext:
        try:
            context_id = str(UUID(context_ref.removeprefix("os-")))
        except ValueError:
            raise OpenStackError("context_not_found", "OpenStack context not found", 404) from None
        context = self.db.get(OpenStackProjectContext, context_id, populate_existing=True)
        if context is None or context.connection.user_id != user.id:
            raise OpenStackError("context_not_found", "OpenStack context not found", 404)
        if not self._is_catalog_context(context):
            raise OpenStackError(
                "reauthentication_required",
                "Reactivate this OpenStack project to discover its S3 region",
            )
        if context.connection.cloud.managed_endpoints_only and self._managed_endpoint(context.endpoint_url) is None:
            raise OpenStackError(
                "endpoint_not_allowed",
                "This OpenStack S3 region is not managed by BucketReef",
                403,
            )
        return context

    def _active_project_credential(
        self,
        user: User,
        auth_id: str,
        context: OpenStackProjectContext,
    ) -> tuple[OpenStackSession, OpenStackProjectCredential]:
        session = self._session(user, auth_id, context.connection)
        credential = self.db.scalar(
            select(OpenStackProjectCredential)
            .where(
                OpenStackProjectCredential.session_id == session.id,
                OpenStackProjectCredential.context_id == context.id,
            )
            .execution_options(populate_existing=True)
        )
        now = utcnow()
        if credential is not None and credential.expires_at <= now:
            credential_id = str(credential.id)

            def persist_expired_credential_cleanup(write_db: Session) -> None:
                current = write_db.get(OpenStackProjectCredential, credential_id)
                if current is not None and current.expires_at <= now:
                    write_db.delete(current)

            run_replayable_db_unit(self.db, persist_expired_credential_cleanup)
            credential = None
        if credential is None or not credential.secret_key or credential.expires_at <= utcnow():
            raise OpenStackError(
                "reauthentication_required",
                "Reconnect to OpenStack and select this project",
            )
        return session, credential

    def _revalidate_project_credential(
        self,
        user: User,
        auth_id: str,
        context: OpenStackProjectContext,
        session: OpenStackSession,
        credential: OpenStackProjectCredential,
    ) -> None:
        if credential.validated_at > utcnow() - timedelta(seconds=60):
            return
        user_id = int(user.id)
        connection_id = str(context.connection.id)
        context_id = str(context.id)
        project_id = str(context.project_id)
        target_id = str(context.target_id)
        target_region_id = str(context.region_id)
        target_endpoint_url = str(context.endpoint_url)
        target_interface = str(context.endpoint_interface)
        target_service_type = str(context.service_type)
        session_id = str(session.id)
        credential_id = str(credential.id)
        key_id = str(credential.access_key)
        secret_key = credential.secret_key
        access = self.project_access(
            user,
            auth_id,
            connection_id,
            project_id,
        )
        key = next(
            (
                item
                for item in access["credentials"]
                if item["access"] == key_id and item["secret"] == secret_key
            ),
            None,
        )
        target = next(
            (item for item in access["targets"] if item["target_id"] == target_id),
            None,
        )
        target_matches = target is not None and all(
            (
                target["region_id"] == target_region_id,
                target["endpoint_url"] == target_endpoint_url,
                target["interface"] == target_interface,
                target["service_type"] == target_service_type,
            )
        )
        validated_at = utcnow()
        key_expires_at = key["expires_at"] if key is not None else None

        def persist_revalidation(write_db: Session) -> str:
            scoped = self if write_db is self.db else OpenStackService(write_db)
            current_user = write_db.get(User, user_id, populate_existing=True)
            if current_user is None:
                raise OpenStackError(
                    "reauthentication_required",
                    "The BucketReef session is no longer active",
                )
            scoped._auth(current_user, auth_id, lock=True)
            connection = scoped.owned(current_user, connection_id)
            scoped._session(
                current_user,
                auth_id,
                connection,
                expected_id=session_id,
                persist_expiration=False,
            )
            current = write_db.get(OpenStackProjectCredential, credential_id)
            if (
                current is None
                or str(current.session_id) != session_id
                or str(current.context_id) != context_id
                or current.access_key != key_id
                or current.secret_key != secret_key
            ):
                raise OpenStackError(
                    "reauthentication_required",
                    "Reconnect to OpenStack and select this project",
                )
            if key is None:
                write_db.delete(current)
                return "credential_changed"
            if not target_matches:
                write_db.delete(current)
                return "target_changed"
            current.validated_at = validated_at
            current.expires_at = min(current.expires_at, key_expires_at)
            return "valid"

        revalidation = run_replayable_db_unit(self.db, persist_revalidation)
        if revalidation == "credential_changed":
            raise OpenStackError(
                "reauthentication_required",
                "EC2 credential changed; select a valid credential",
            )
        if revalidation == "target_changed":
            raise OpenStackError(
                "reauthentication_required",
                "OpenStack S3 region changed; select the project again",
            )

    def _attach_execution_guard(
        self,
        result: S3ExecutionContext,
        user: User,
        auth_id: str,
        context_ref: str,
    ) -> None:
        from app.services.openstack_execution_guard import make_openstack_validator
        from app.services.s3_execution_client import s3_execution_cache_key

        result.access_validator = make_openstack_validator(
            self.db.get_bind(),
            user.id,
            auth_id,
            context_ref,
            s3_execution_cache_key(result),
            resolve_context=_resolve_guard_context,
        )

    def resolve(self, user: User, auth_id: str, context_ref: str, *, metadata_only: bool = False, attach_guard: bool = True) -> S3ExecutionContext:
        self.require_enabled()
        context = self._resolve_project_context(user, context_ref)
        session, credential = self._active_project_credential(user, auth_id, context)
        if not metadata_only:
            self._revalidate_project_credential(user, auth_id, context, session, credential)
        result = self._execution(context, credential, auth_id)
        auth = self._auth(user, auth_id)
        result.credential_expires_at = min(result.credential_expires_at, auth.idle_expires_at, auth.absolute_expires_at)
        if attach_guard and not metadata_only:
            self._attach_execution_guard(result, user, auth_id, context_ref)
        if metadata_only:
            result.access_key = result.secret_key = None
        return result

    def catalogue(self, user: User, auth_id: str | None) -> list[ExecutionContext]:
        if not auth_id or not self.enabled():
            return []
        contexts = self.db.scalars(select(OpenStackProjectContext).join(OpenStackConnection).where(OpenStackConnection.user_id == user.id)).all()
        result = []
        tags_service = TagsService(self.db)
        for context in contexts:
            try:
                execution = self.resolve(user, auth_id, f"os-{context.id}", metadata_only=True)
            except OpenStackError:
                continue
            endpoint = execution.storage_endpoint
            if endpoint is not None:
                caps = resolve_endpoint_capabilities(endpoint)
                caps.update({
                    "admin": False,
                    "sts": False,
                    "iam": execution.manager_capabilities.can_manage_iam,
                })
                endpoint_id = endpoint.id
                endpoint_name = endpoint.name
                endpoint_is_default = endpoint.is_default
                endpoint_provider = endpoint.provider
                endpoint_tags = tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint))
            else:
                caps = {
                    "admin": False,
                    "sts": False,
                    "usage": False,
                    "metrics": False,
                    "static_website": False,
                    "iam": execution.manager_capabilities.can_manage_iam,
                    "sns": False,
                    "sse": False,
                    "replication": False,
                }
                endpoint_id = None
                endpoint_name = context.endpoint_name
                endpoint_is_default = False
                endpoint_provider = "other"
                endpoint_tags = []
            result.append(ExecutionContext(
                kind="openstack_project", id=execution.context_id, display_name=context.project_name,
                connection_scope="private", manager_role=None, portal_role=None, rgw_account_id=None,
                endpoint_id=endpoint_id,
                endpoint_name=endpoint_name,
                endpoint_is_default=endpoint_is_default,
                endpoint_provider=endpoint_provider,
                endpoint_url=context.endpoint_url,
                storage_endpoint_capabilities=caps,
                destination_switching_allowed=False,
                execution_destinations=[],
                tags=[], endpoint_tags=endpoint_tags,
                capabilities=ExecutionContextCapabilities(can_manage_iam=execution.manager_capabilities.can_manage_iam, sts_capable=False, admin_api_capable=False),
                openstack=OpenStackExecutionContextMetadata(
                    connection_id=context.connection_id,
                    cloud_name=context.connection.cloud.name,
                    identity_name=context.connection.display_name,
                    project_id=context.project_id,
                    project_name=context.project_name,
                    region_id=context.region_id,
                ),
            ))
        return result

    def _erase_connection(self, connection: OpenStackConnection, auth_id: str | None = None) -> None:
        sessions = select(OpenStackSession.id).where(OpenStackSession.connection_id == connection.id)
        if auth_id is not None:
            sessions = sessions.where(OpenStackSession.auth_session_id == auth_id)
        rows = self.db.scalars(select(OpenStackSession).where(OpenStackSession.id.in_(sessions)).with_for_update()).all()
        for row in rows:
            self.db.execute(delete(OpenStackProjectCredential).where(OpenStackProjectCredential.session_id == row.id))
            row.token = None

    def disconnect(self, user: User, auth_id: str, connection_id: str, *, forget: bool = False) -> None:
        self.require_enabled()
        user_id = int(user.id)

        def persist(write_db: Session) -> None:
            scoped = self if write_db is self.db else OpenStackService(write_db)
            current_user = write_db.get(User, user_id, populate_existing=True)
            if current_user is None:
                raise OpenStackError(
                    "reauthentication_required",
                    "The BucketReef session is no longer active",
                )
            scoped._auth(current_user, auth_id, lock=True)
            connection = scoped.owned(current_user, connection_id)
            scoped._erase_connection(connection, None if forget else auth_id)
            if forget:
                write_db.delete(connection)

        run_replayable_db_unit(self.db, persist)
