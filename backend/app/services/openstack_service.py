# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import AuthSession, UiGroup, User
from app.db.openstack import OpenStackCloud, OpenStackConnection, OpenStackProjectContext, OpenStackProjectCredential, OpenStackSession
from app.models.account_capabilities import AccountCapabilities
from app.models.execution_context import (
    ExecutionContext,
    ExecutionContextCapabilities,
    OpenStackExecutionContextMetadata,
)
from app.models.openstack import OpenStackAuthenticate, OpenStackCloudWrite
from app.services.keystone_client import KeystoneClient, KeystoneIdentity, OpenStackError
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_endpoints_service import StorageEndpointsService
from app.services.tags_service import TagsService
from app.utils.s3_endpoint import validate_openstack_catalog_s3_endpoint
from app.utils.storage_endpoint_features import features_to_capabilities, normalize_features_config
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
        values = payload.model_dump(exclude={"user_ids", "group_ids"})
        refs = {}
        for field, model, ids in (("users", User, payload.user_ids), ("groups", UiGroup, payload.group_ids)):
            rows = self.db.scalars(select(model).where(model.id.in_(set(ids)))).all()
            if len(rows) != len(set(ids)):
                raise OpenStackError("invalid_reference", "A user or group does not exist", 422)
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

    def _managed_endpoint(self, endpoint_url: str):
        try:
            canonical_url = validate_openstack_catalog_s3_endpoint(endpoint_url)
        except ValueError:
            return None
        return StorageEndpointsService(self.db).find_endpoint_record_by_url(canonical_url)

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
        connection = self.owned(user, connection_id)
        session = self._session(user, auth_id, connection)
        session_id = session.id
        client = KeystoneClient(connection.cloud.auth_url)
        projects = client.projects(session.token)
        project = next((item for item in projects if item["id"] == project_id), None)
        if project is None:
            raise OpenStackError("project_not_allowed", "OpenStack project is not available", 403)
        access = client.project_access(self._identity(connection, session), project_id)
        self._session(user, auth_id, connection, expected_id=session_id)
        return {
            "project": project,
            "targets": self._annotate_targets(connection.cloud, access["targets"]),
            "credentials": access["credentials"],
        }

    @staticmethod
    def _is_catalog_context(context: OpenStackProjectContext) -> bool:
        return bool(
            context.target_id
            and not context.target_id.startswith("legacy-storage-endpoint:")
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

    def project_options(self, user: User, auth_id: str) -> list[dict]:
        """Return Keystone projects that still need a session-bound S3 context."""
        result: list[dict] = []
        now = utcnow()
        for session in self._active_sessions(user, auth_id):
            connection = session.connection
            cloud = self.cloud(user, connection.cloud_id)
            projects = KeystoneClient(cloud.auth_url).projects(session.token)
            self._session(user, auth_id, connection, expected_id=session.id)
            active_project_ids = {
                credential.context.project_id
                for credential in session.credentials
                if credential.secret_key
                and credential.expires_at > now
                and self._is_catalog_context(credential.context)
            }
            for project in sorted(projects, key=lambda item: (item["name"].casefold(), item["id"])):
                if project["id"] in active_project_ids:
                    continue
                result.append({
                    "connection_id": connection.id,
                    "cloud_id": cloud.id,
                    "cloud_name": cloud.name,
                    "identity_name": connection.display_name,
                    "keystone_user_id": connection.keystone_user_id,
                    "project_id": project["id"],
                    "project_name": project["name"],
                    "project_domain_id": project.get("domain_id"),
                })
        return result

    def keys(self, user: User, auth_id: str, connection_id: str, project_id: str) -> list[dict]:
        return self.project_access(user, auth_id, connection_id, project_id)["credentials"]

    def activate(self, user: User, auth_id: str, connection_id: str, project_id: str, target_id: str, access_key: str | None) -> str:
        connection = self.owned(user, connection_id)
        cloud = self.cloud(user, connection.cloud_id)
        session = self._session(user, auth_id, connection)
        session_id = session.id
        access = self.project_access(user, auth_id, connection_id, project_id)
        project = access["project"]
        target = next((item for item in access["targets"] if item["target_id"] == target_id), None)
        if target is None or not target["allowed"]:
            raise OpenStackError("endpoint_not_allowed", "S3 region is not available for this project", 403)
        keys = access["credentials"]
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
        context = self.db.scalar(select(OpenStackProjectContext).where(
            OpenStackProjectContext.connection_id == connection.id, OpenStackProjectContext.project_id == project_id,
            OpenStackProjectContext.target_id == target_id,
        ))
        if context is None:
            context = OpenStackProjectContext(
                connection_id=connection.id,
                project_id=project_id,
                project_name=project["name"],
                endpoint_id=None,
                target_id=target["target_id"],
                region_id=target["region_id"],
                endpoint_url=target["endpoint_url"],
                endpoint_name=target["service_name"] or target["region_id"],
                endpoint_interface=target["interface"],
                service_type=target["service_type"],
                service_name=target["service_name"],
            )
            self.db.add(context)
            self.db.flush()
        else:
            context.project_name = project["name"]
            context.endpoint_id = None
            context.region_id = target["region_id"]
            context.endpoint_url = target["endpoint_url"]
            context.endpoint_name = target["service_name"] or target["region_id"]
            context.endpoint_interface = target["interface"]
            context.service_type = target["service_type"]
            context.service_name = target["service_name"]
        sibling_context_ids = select(OpenStackProjectContext.id).where(
            OpenStackProjectContext.connection_id == connection.id,
            OpenStackProjectContext.project_id == project_id,
        )
        self.db.execute(delete(OpenStackProjectCredential).where(
            OpenStackProjectCredential.session_id == session.id,
            OpenStackProjectCredential.context_id.in_(sibling_context_ids),
        ))
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
            session_force_path_style=bool(endpoint.force_path_style) if endpoint is not None else False,
            session_verify_tls=bool(endpoint.verify_tls) if endpoint is not None else True,
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
        if not self._is_catalog_context(context):
            raise OpenStackError("reauthentication_required", "Reactivate this OpenStack project to discover its S3 region")
        connection = context.connection
        if connection.cloud.managed_endpoints_only and self._managed_endpoint(context.endpoint_url) is None:
            raise OpenStackError("endpoint_not_allowed", "This OpenStack S3 region is not managed by BucketReef", 403)
        session = self._session(user, auth_id, connection)
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
            access = self.project_access(user, auth_id, connection.id, context.project_id)
            keys = access["credentials"]
            key = next((item for item in keys if item["access"] == key_id and item["secret"] == credential.secret_key), None)
            if key is None:
                self.db.delete(credential)
                self.db.commit()
                raise OpenStackError("reauthentication_required", "EC2 credential changed; select a valid credential")
            target = next((item for item in access["targets"] if item["target_id"] == context.target_id), None)
            target_matches = target is not None and all((
                target["region_id"] == context.region_id,
                target["endpoint_url"] == context.endpoint_url,
                target["interface"] == context.endpoint_interface,
                target["service_type"] == context.service_type,
            ))
            if not target_matches:
                self.db.delete(credential)
                self.db.commit()
                raise OpenStackError("reauthentication_required", "OpenStack S3 region changed; select the project again")
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
                caps = features_to_capabilities(
                    normalize_features_config(endpoint.provider, endpoint.features_config, endpoint.region)
                )
                caps.update({
                    "admin": False,
                    "sts": False,
                    "iam": execution.manager_capabilities.can_manage_iam,
                })
                endpoint_id = endpoint.id
                endpoint_name = endpoint.name
                endpoint_is_default = bool(endpoint.is_default)
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
        self._auth(user, auth_id, lock=True)
        connection = self.owned(user, connection_id)
        self._erase_connection(connection, None if forget else auth_id)
        if forget:
            self.db.delete(connection)
        self.db.commit()
