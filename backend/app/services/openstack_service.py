# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import AuthSession, StorageEndpoint, UiGroup, User
from app.db.openstack import OpenStackCloud, OpenStackConnection, OpenStackProjectContext, OpenStackProjectCredential, OpenStackSession
from app.models.account_capabilities import AccountCapabilities
from app.models.execution_context import ExecutionContext, ExecutionContextCapabilities
from app.models.openstack import OpenStackAuthenticate, OpenStackCloudWrite
from app.services.keystone_client import KeystoneClient, KeystoneIdentity, OpenStackError
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.time import utcnow


class OpenStackService:
    def __init__(self, db: Session):
        self.db = db

    def allowed_clouds(self, user: User) -> list[OpenStackCloud]:
        from app.services.effective_access_service import EffectiveAccessService
        access = EffectiveAccessService(self.db)
        return [cloud for cloud in self.db.scalars(select(OpenStackCloud).order_by(OpenStackCloud.name)).all()
                if access.can_connect_openstack_cloud(user, cloud)]

    def cloud(self, user: User, cloud_id: int) -> OpenStackCloud:
        from app.services.effective_access_service import EffectiveAccessService
        cloud = self.db.get(OpenStackCloud, cloud_id, populate_existing=True)
        if cloud is None or not EffectiveAccessService(self.db).can_connect_openstack_cloud(user, cloud):
            raise OpenStackError("cloud_not_found", "OpenStack cloud is not available", 404)
        return cloud

    def save_cloud(self, payload: OpenStackCloudWrite, cloud_id: int | None = None) -> OpenStackCloud:
        cloud = self.db.scalar(select(OpenStackCloud).where(OpenStackCloud.id == cloud_id).with_for_update().execution_options(populate_existing=True)) if cloud_id is not None else OpenStackCloud()
        if cloud is None:
            raise OpenStackError("cloud_not_found", "OpenStack cloud not found", 404)
        values = payload.model_dump(exclude={"endpoint_ids", "user_ids", "group_ids"})
        refs = {}
        for field, model, ids in (("endpoints", StorageEndpoint, payload.endpoint_ids), ("users", User, payload.user_ids), ("groups", UiGroup, payload.group_ids)):
            rows = self.db.scalars(select(model).where(model.id.in_(set(ids)))).all()
            if len(rows) != len(set(ids)):
                raise OpenStackError("invalid_reference", "An endpoint, user or group does not exist", 422)
            refs[field] = rows
        # Invalidate before changing trust or grants, even when a cloud is merely disabled.
        if cloud_id is not None:
            self.db.expire(cloud, ["connections"])
            cloud.config_version += 1
            for connection in cloud.connections:
                self._erase_connection(connection)
        for name, value in values.items():
            setattr(cloud, name, value)
        for name, rows in refs.items():
            setattr(cloud, name, rows)
        self.db.add(cloud)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise OpenStackError("cloud_conflict", "OpenStack cloud name already exists", 409) from None
        return cloud

    def delete_cloud(self, cloud_id: int) -> None:
        cloud = self.db.get(OpenStackCloud, cloud_id)
        if cloud is None:
            raise OpenStackError("cloud_not_found", "OpenStack cloud not found", 404)
        self.db.delete(cloud)
        self.db.commit()

    def invalidate_endpoint_trust(self, endpoint_id: int) -> None:
        """Join the endpoint update transaction; serialize with credential writes."""
        from app.db.openstack import cloud_endpoints
        cloud_ids = select(cloud_endpoints.c.cloud_id).where(cloud_endpoints.c.endpoint_id == endpoint_id)
        clouds = self.db.scalars(select(OpenStackCloud).where(OpenStackCloud.id.in_(cloud_ids))
                                 .order_by(OpenStackCloud.id).with_for_update().execution_options(populate_existing=True)).all()
        for cloud in clouds:
            cloud.config_version += 1
            self.db.expire(cloud, ["connections"])
            for connection in cloud.connections:
                self._erase_connection(connection)

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

    def _session(self, user: User, auth_id: str, connection: OpenStackConnection, *, expected_id: str | None = None) -> OpenStackSession:
        self._auth(user, auth_id)
        self.cloud(user, connection.cloud_id)
        row = self.db.scalar(select(OpenStackSession).where(
            OpenStackSession.connection_id == connection.id, OpenStackSession.auth_session_id == auth_id,
        ).execution_options(populate_existing=True))
        if row is not None and row.expires_at <= utcnow() and row.token:
            self.db.execute(delete(OpenStackProjectCredential).where(OpenStackProjectCredential.session_id == row.id))
            row.token = None
            self.db.commit()
        if not row or not row.token or row.cloud_version != connection.cloud.config_version or row.expires_at <= utcnow() or (expected_id is not None and row.id != expected_id):
            raise OpenStackError("reauthentication_required", "Reconnect to OpenStack")
        return row

    @staticmethod
    def _identity(connection: OpenStackConnection, session: OpenStackSession) -> KeystoneIdentity:
        return KeystoneIdentity(session.token, connection.keystone_user_id, connection.display_name, session.expires_at)

    def authenticate(self, user: User, auth_id: str, payload: OpenStackAuthenticate) -> OpenStackConnection:
        self._auth(user, auth_id)
        cloud = self.cloud(user, payload.cloud_id)
        if not (cloud.allow_password if payload.method == "password" else cloud.allow_token):
            raise OpenStackError("method_disabled", "This authentication method is disabled", 403)
        expected_version = cloud.config_version
        identity = KeystoneClient(cloud.auth_url).authenticate(payload, cloud.default_domain)
        auth = self._auth(user, auth_id, lock=True)
        # Repeat local authorization after the network call.
        self.db.scalar(select(OpenStackCloud).where(OpenStackCloud.id == cloud.id).with_for_update().execution_options(populate_existing=True))
        current_cloud = self.cloud(user, cloud.id)
        if current_cloud.config_version != expected_version:
            raise OpenStackError("configuration_changed", "OpenStack configuration changed; reconnect")
        connection = self.db.scalar(select(OpenStackConnection).where(
            OpenStackConnection.user_id == user.id, OpenStackConnection.cloud_id == cloud.id,
            OpenStackConnection.keystone_user_id == identity.user_id,
        ))
        if connection is None:
            connection = OpenStackConnection(user_id=user.id, cloud_id=cloud.id, keystone_user_id=identity.user_id, display_name=identity.name)
            self.db.add(connection)
            self.db.flush()
        for old in self.db.scalars(select(OpenStackSession).where(OpenStackSession.connection_id == connection.id, OpenStackSession.auth_session_id == auth_id)).all():
            self.db.delete(old)
        self.db.flush()
        self.db.add(OpenStackSession(connection_id=connection.id, auth_session_id=auth_id, token=identity.token, cloud_version=expected_version,
                                    expires_at=min(identity.expires_at, auth.absolute_expires_at)))
        self.db.commit()
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

    def projects(self, user: User, auth_id: str, connection_id: str) -> list[dict]:
        connection = self.owned(user, connection_id)
        session = self._session(user, auth_id, connection)
        projects = KeystoneClient(connection.cloud.auth_url).projects(session.token)
        self._session(user, auth_id, connection, expected_id=session.id)
        return projects

    def keys(self, user: User, auth_id: str, connection_id: str, project_id: str) -> list[dict]:
        connection = self.owned(user, connection_id)
        session = self._session(user, auth_id, connection)
        keys = KeystoneClient(connection.cloud.auth_url).credentials(self._identity(connection, session), project_id)
        self._session(user, auth_id, connection, expected_id=session.id)
        return keys

    def activate(self, user: User, auth_id: str, connection_id: str, project_id: str, endpoint_id: int, access_key: str | None) -> str:
        connection = self.owned(user, connection_id)
        cloud = self.cloud(user, connection.cloud_id)
        if endpoint_id not in {item.id for item in cloud.endpoints}:
            raise OpenStackError("endpoint_not_allowed", "S3 endpoint is not available for this cloud", 403)
        projects = self.projects(user, auth_id, connection_id)
        project = next((item for item in projects if item["id"] == project_id), None)
        if not project:
            raise OpenStackError("project_not_allowed", "OpenStack project is not available", 403)
        session = self._session(user, auth_id, connection)
        session_id = session.id
        keys = self.keys(user, auth_id, connection_id, project_id)
        if not keys:
            raise OpenStackError("no_ec2_credentials", "Create an EC2 credential for this project in OpenStack")
        if access_key is None and len(keys) != 1:
            raise OpenStackError("credential_selection_required", "Select an EC2 credential")
        key = next((key for key in keys if key["access"] == access_key), None) if access_key else keys[0]
        if not key:
            raise OpenStackError("credential_not_allowed", "EC2 credential is not available for this project", 403)
        self._auth(user, auth_id, lock=True)
        self.db.scalar(select(OpenStackCloud).where(OpenStackCloud.id == cloud.id).with_for_update().execution_options(populate_existing=True))
        session = self._session(user, auth_id, connection, expected_id=session_id)
        self.db.refresh(cloud)
        if endpoint_id not in {item.id for item in cloud.endpoints}:
            raise OpenStackError("endpoint_not_allowed", "S3 endpoint was removed", 403)
        context = self.db.scalar(select(OpenStackProjectContext).where(
            OpenStackProjectContext.connection_id == connection.id, OpenStackProjectContext.project_id == project_id,
            OpenStackProjectContext.endpoint_id == endpoint_id,
        ))
        if context is None:
            context = OpenStackProjectContext(connection_id=connection.id, project_id=project_id, project_name=project["name"], endpoint_id=endpoint_id)
            self.db.add(context)
            self.db.flush()
        self.db.execute(delete(OpenStackProjectCredential).where(OpenStackProjectCredential.session_id == session.id, OpenStackProjectCredential.context_id == context.id))
        credential = OpenStackProjectCredential(session_id=session.id, context_id=context.id, access_key=key["access"], secret_key=key["secret"],
                                              expires_at=min(key["expires_at"], session.expires_at), validated_at=utcnow())
        self.db.add(credential)
        self.db.flush()
        credential.can_manage_iam = self._probe_iam(context, credential, auth_id)
        self._auth(user, auth_id, lock=True)
        self._session(user, auth_id, connection, expected_id=session_id)
        self.db.commit()
        return f"os-{context.id}"

    def _probe_iam(self, context, credential, auth_id) -> bool:
        from app.services.s3_connection_capabilities_service import probe_execution_can_manage_iam
        return probe_execution_can_manage_iam(self._execution(context, credential, auth_id))

    @staticmethod
    def _execution(context, credential, auth_id) -> S3ExecutionContext:
        endpoint = context.endpoint
        return S3ExecutionContext(
            context_id=f"os-{context.id}", context_kind="openstack_project",
            name=f"{context.connection.cloud.name} / {context.connection.display_name} / {context.project_name} / {endpoint.name}",
            access_key=credential.access_key, secret_key=credential.secret_key,
            storage_endpoint_id=endpoint.id, storage_endpoint=endpoint,
            execution_auth_session_id=auth_id, credential_expires_at=credential.expires_at,
            openstack_session_id=credential.session_id,
            manager_capabilities=AccountCapabilities(can_manage_buckets=True, can_manage_iam=credential.can_manage_iam),
        )

    def resolve(self, user: User, auth_id: str, context_ref: str, *, metadata_only: bool = False, attach_guard: bool = True) -> S3ExecutionContext:
        try:
            context_id = str(UUID(context_ref.removeprefix("os-")))
        except ValueError:
            raise OpenStackError("context_not_found", "OpenStack context not found", 404) from None
        context = self.db.get(OpenStackProjectContext, context_id, populate_existing=True)
        if context is None or context.connection.user_id != user.id:
            raise OpenStackError("context_not_found", "OpenStack context not found", 404)
        connection = context.connection
        session = self._session(user, auth_id, connection)
        if context.endpoint_id not in {item.id for item in self.cloud(user, connection.cloud_id).endpoints}:
            raise OpenStackError("endpoint_not_allowed", "S3 endpoint is no longer available", 403)
        credential = self.db.scalar(select(OpenStackProjectCredential).where(
            OpenStackProjectCredential.session_id == session.id, OpenStackProjectCredential.context_id == context.id,
        ).execution_options(populate_existing=True))
        if credential is not None and credential.expires_at <= utcnow():
            self.db.delete(credential)
            self.db.commit()
            credential = None
        if not credential or not credential.secret_key or credential.expires_at <= utcnow():
            raise OpenStackError("reauthentication_required", "Reconnect to OpenStack and select this project")
        if not metadata_only and credential.validated_at <= utcnow() - timedelta(seconds=60):
            session_id, key_id = session.id, credential.access_key
            keys = self.keys(user, auth_id, connection.id, context.project_id)
            key = next((item for item in keys if item["access"] == key_id and item["secret"] == credential.secret_key), None)
            if key is None:
                self.db.delete(credential)
                self.db.commit()
                raise OpenStackError("reauthentication_required", "EC2 credential changed; select a valid credential")
            self._auth(user, auth_id, lock=True)
            self._session(user, auth_id, connection, expected_id=session_id)
            self.db.refresh(credential)
            credential.validated_at = utcnow()
            credential.expires_at = min(credential.expires_at, key["expires_at"])
            self.db.commit()
        result = self._execution(context, credential, auth_id)
        auth = self._auth(user, auth_id)
        result.credential_expires_at = min(result.credential_expires_at, auth.idle_expires_at, auth.absolute_expires_at)
        if attach_guard and not metadata_only:
            from app.services.openstack_execution_guard import make_openstack_validator
            from app.services.s3_execution_client import s3_execution_cache_key
            result.access_validator = make_openstack_validator(self.db.get_bind(), user.id, auth_id, context_ref, s3_execution_cache_key(result))
        if metadata_only:
            result.access_key = result.secret_key = None
        return result

    def catalogue(self, user: User, auth_id: str | None) -> list[ExecutionContext]:
        if not auth_id:
            return []
        from app.services.mappers.execution_context import _storage_endpoint_projection
        contexts = self.db.scalars(select(OpenStackProjectContext).join(OpenStackConnection).where(OpenStackConnection.user_id == user.id)).all()
        result = []
        for context in contexts:
            try:
                execution = self.resolve(user, auth_id, f"os-{context.id}", metadata_only=True)
            except OpenStackError:
                continue
            caps = {"admin": False, "metrics": False, "usage": False, "sts": False, "iam": execution.manager_capabilities.can_manage_iam}
            result.append(ExecutionContext(
                kind="openstack_project", id=execution.context_id, display_name=execution.name,
                connection_scope="private", manager_role=None, portal_role=None, rgw_account_id=None,
                **_storage_endpoint_projection(context.endpoint, capability_overrides=caps), tags=[], endpoint_tags=[],
                capabilities=ExecutionContextCapabilities(can_manage_iam=execution.manager_capabilities.can_manage_iam, sts_capable=False, admin_api_capable=False),
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
        self._auth(user, auth_id, lock=True)
        connection = self.owned(user, connection_id)
        self._erase_connection(connection, None if forget else auth_id)
        if forget:
            self.db.delete(connection)
        self.db.commit()
