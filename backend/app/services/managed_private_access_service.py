# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import Callable
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import ManagedPrivateAccess, S3Account, S3Connection, User
from app.models.managed_private_access import (
    ManagedIAMPrivateAccessRequest,
    ManagedPrivateAccessResult,
    ManagedRGWUserPrivateAccessRequest,
)
from app.services.resource_name_validation import validate_inline_policy_requests
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.effective_access_service import EffectiveAccessService
from app.services.managed_private_access_audit_service import (
    ManagedPrivateAccessAuditService,
)
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessCleanupPending,
    ManagedPrivateAccessConflict,
    ManagedPrivateAccessError,
    ManagedPrivateAccessForbidden,
    ManagedPrivateAccessNotFound,
)
from app.services.managed_private_access_policy_service import (
    ManagedPrivateAccessPolicyService,
)
from app.services.managed_private_access_query_service import (
    ManagedPrivateAccessQueryService,
)
from app.services.managed_private_access_sources import (
    ManagedPrivateAccessDestination,
    ManagedPrivateAccessSource,
    ManagedPrivateAccessSourceResolver,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.rgw_iam import (
    RGWIAMService,
    get_iam_service,
    get_iam_service_for_execution_target,
)
from app.services.s3_connection_capabilities_service import (
    refresh_connection_detected_capabilities,
)
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_context import S3ExecutionTarget
from app.services.s3_users_service import S3UsersService
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.connection_rgw_identity import normalize_connection_rgw_identity
from app.utils.rgw_payloads import extract_rgw_user_identity
from app.utils.storage_endpoint_features import (
    aws_iam_client_options_for_region,
    resolve_iam_endpoint,
    resolve_iam_signing_region,
)
from app.utils.time import utcnow


ManagedPrivateAccessRequest = ManagedIAMPrivateAccessRequest | ManagedRGWUserPrivateAccessRequest


class ManagedPrivateAccessService:
    """Orchestrate remote credentials and a private connection as a durable saga."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.access = EffectiveAccessService(db)
        self.sources = ManagedPrivateAccessSourceResolver(db, self.access)
        self.policy = ManagedPrivateAccessPolicyService(
            db,
            access=self.access,
            sources=self.sources,
        )
        self.connections = S3ConnectionsService(db)
        self.audit = ManagedPrivateAccessAuditService(db)
        self.queries = ManagedPrivateAccessQueryService(db)
        self.state = ManagedPrivateAccessStateService(db)

    def provision_iam(
        self,
        *,
        user: User,
        context: S3ExecutionTarget,
        payload: ManagedIAMPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult:
        self.policy.ensure_managed_private_connection_provisioning_allowed(user)
        validate_inline_policy_requests(payload.inline_policies, "user", context)
        source = self.sources.resolve_iam_source(user, context)
        destination = self.sources.derive_destination(source)
        iam = self._iam_service_for_context(context)
        self.policy.validate_iam_provisioning_request(iam, payload)
        existing_result = self._existing_result_for_source(user, source, payload)
        if existing_result is not None:
            return existing_result

        provisioning = self._start_provisioning(user, source)
        try:
            access_key_id, secret_access_key = self._provision_iam_credentials(
                provisioning,
                iam,
                payload,
                username=source.iam_username or "",
            )
            return self._activate_connection(
                user=user,
                provisioning=provisioning,
                destination=destination,
                payload=payload,
                access_key_id=access_key_id,
                secret_access_key=secret_access_key,
            )
        except ManagedPrivateAccessConflict:
            self.audit.record(
                user,
                provisioning,
                "managed_private_access.provision.failure",
                status="failure",
                message="Deterministic IAM principal conflict",
            )
            raise
        except Exception as exc:
            self._handle_provisioning_failure(
                user=user,
                provisioning_id=provisioning.id,
                exc=exc,
                compensate=lambda failure: self._compensate_iam(
                    provisioning.id,
                    iam,
                    failure=failure,
                    user=user,
                ),
            )
            raise ManagedPrivateAccessError("Unable to create managed private access") from exc

    def provision_rgw_user(
        self,
        *,
        user: User,
        context: S3ExecutionTarget,
        payload: ManagedRGWUserPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult:
        self.policy.ensure_managed_private_connection_provisioning_allowed(user)
        source = self.sources.resolve_rgw_user_source(user, context)
        destination = self.sources.derive_destination(source)
        existing_result = self._existing_result_for_source(user, source, payload)
        if existing_result is not None:
            return existing_result

        provisioning = self._start_provisioning(user, source)
        users = S3UsersService(self.db)
        try:
            key = users.create_access_key_entry(source.identifier)
            provisioning.access_key_id = key.access_key_id
            provisioning.created_access_key = True
            self.state.checkpoint(provisioning)
            return self._activate_connection(
                user=user,
                provisioning=provisioning,
                destination=destination,
                payload=payload,
                access_key_id=key.access_key_id,
                secret_access_key=key.secret_access_key,
            )
        except Exception as exc:
            self._handle_provisioning_failure(
                user=user,
                provisioning_id=provisioning.id,
                exc=exc,
                compensate=lambda failure: self._compensate_rgw_user(
                    provisioning.id,
                    failure=failure,
                    user=user,
                ),
            )
            raise ManagedPrivateAccessError("Unable to create managed private access") from exc

    def _provision_iam_credentials(
        self,
        provisioning: ManagedPrivateAccess,
        iam: RGWIAMService,
        payload: ManagedIAMPrivateAccessRequest,
        *,
        username: str,
    ) -> tuple[str, str]:
        if iam.get_user(username) is not None:
            self.state.mark_failed(provisioning, "deterministic_remote_principal_exists")
            raise ManagedPrivateAccessConflict(
                "The deterministic IAM user already exists and is not linked to a known provisioning"
            )

        iam.create_user(username, create_key=False)
        provisioning.created_remote_principal = True
        self.state.checkpoint(provisioning)

        for group_name in payload.groups:
            iam.add_user_to_group(group_name, username)
            self.state.append_list_value(provisioning, "iam_groups", group_name)
            self.state.checkpoint(provisioning)
        for policy_arn in payload.managed_policies:
            iam.attach_user_policy(username, policy_arn)
            self.state.append_list_value(provisioning, "iam_managed_policies", policy_arn)
            self.state.checkpoint(provisioning)
        for inline in payload.inline_policies:
            iam.put_user_inline_policy(username, inline.name, inline.document)
            self.state.append_list_value(provisioning, "iam_inline_policy_names", inline.name)
            self.state.checkpoint(provisioning)

        key = iam.create_access_key(username)
        if not key.access_key_id or not key.secret_access_key:
            raise ManagedPrivateAccessError("RGW IAM did not return complete access credentials")
        provisioning.access_key_id = key.access_key_id
        provisioning.created_access_key = True
        self.state.checkpoint(provisioning)
        return key.access_key_id, key.secret_access_key

    def _handle_provisioning_failure(
        self,
        *,
        user: User,
        provisioning_id: int,
        exc: Exception,
        compensate: Callable[[str], None],
    ) -> None:
        safe_error = sanitized_error_log_detail(exc)
        self.db.rollback()
        failed = self.db.get(ManagedPrivateAccess, provisioning_id)
        if failed is not None:
            self.audit.record(
                user,
                failed,
                "managed_private_access.provision.failure",
                status="failure",
                message=safe_error,
            )
        compensate(safe_error)
        pending = self.db.get(ManagedPrivateAccess, provisioning_id)
        if pending is not None and pending.state == "cleanup_pending":
            raise ManagedPrivateAccessCleanupPending(
                pending.id,
                "Provisioning failed and remote cleanup requires remediation",
            ) from exc

    def delete_owned_connection(self, *, user: User, connection_id: int) -> bool:
        provisioning = self.db.scalar(
            select(ManagedPrivateAccess)
            .where(
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id == connection_id,
            )
            .limit(1)
        )
        if provisioning is None:
            return False
        connection = provisioning.connection
        if connection is None:
            raise ManagedPrivateAccessConflict("Managed private access connection is already absent")
        context_id = f"conn-{connection.id}"
        purge = ResourceDeletionPurgeService(self.db)
        try:
            purge.validate_execution_context_cleanup(context_id)
        except ValueError as exc:
            raise ManagedPrivateAccessConflict(str(exc)) from exc
        connection.is_active = False
        self._cleanup_remote_or_pending(
            provisioning,
            user=user,
            pending_message="Remote cleanup failed; the managed access remains recorded for remediation",
        )

        self.db.delete(provisioning)
        domain_kind, _owner_user_id = self.connections.tags.resolve_connection_domain(
            connection
        )
        purge.purge_execution_context_data(context_id)
        self.db.delete(connection)
        self.db.flush()
        self.connections.tags.cleanup_orphan_definitions(
            domain_kinds=[domain_kind]
        )
        self.db.commit()
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.delete.success",
            connection_id=connection_id,
        )
        return True

    def retry_cleanup(self, *, user: User, connection_id: int) -> None:
        provisioning = self.db.scalar(
            select(ManagedPrivateAccess)
            .where(
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id == connection_id,
                ManagedPrivateAccess.state == "cleanup_pending",
            )
            .limit(1)
        )
        if provisioning is None:
            raise ManagedPrivateAccessNotFound("Managed private access cleanup not found")
        self.delete_owned_connection(user=user, connection_id=connection_id)

    def retry_provisioning_cleanup(self, *, user: User, provisioning_id: int) -> None:
        """Retry compensation when provisioning failed before a connection existed."""
        provisioning = self.db.scalar(
            select(ManagedPrivateAccess)
            .where(
                ManagedPrivateAccess.id == provisioning_id,
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id.is_(None),
                ManagedPrivateAccess.state == "cleanup_pending",
            )
            .limit(1)
        )
        if provisioning is None:
            raise ManagedPrivateAccessNotFound("Managed private access provisioning cleanup not found")
        self._cleanup_remote_or_pending(
            provisioning,
            user=user,
            pending_message="Remote cleanup still requires remediation",
        )

        self.db.delete(provisioning)
        self.db.commit()
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.compensation.retry.success",
        )

    def _cleanup_remote_or_pending(
        self,
        provisioning: ManagedPrivateAccess,
        *,
        user: User,
        pending_message: str,
    ) -> None:
        provisioning.state = "deleting"
        provisioning.updated_at = utcnow()
        self.db.commit()
        try:
            self._cleanup_remote(provisioning, user=user)
        except Exception as exc:
            self._set_cleanup_pending(provisioning, sanitized_error_log_detail(exc), user=user)
            raise ManagedPrivateAccessCleanupPending(
                provisioning.id,
                pending_message,
            ) from exc

    def _existing_result_for_source(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
        payload: ManagedPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult | None:
        existing = self.queries.active_for_source(
            user.id,
            source.kind,
            source.identifier,
        )
        if existing is None:
            return None
        return self._resolve_idempotent_existing(existing, payload)

    def _resolve_idempotent_existing(
        self,
        provisioning: ManagedPrivateAccess,
        payload: ManagedPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult:
        connection = provisioning.connection
        if provisioning.state == "active" and connection is not None:
            same_request = (
                connection.name == payload.connection_name
                and bool(connection.access_browser) == bool(payload.access_browser)
                and bool(connection.access_manager) == bool(payload.access_manager)
            )
            if isinstance(payload, ManagedIAMPrivateAccessRequest):
                same_request = same_request and self.state.string_list(provisioning.iam_groups) == payload.groups
                same_request = same_request and self.state.string_list(provisioning.iam_managed_policies) == payload.managed_policies
                same_request = same_request and self.state.string_list(provisioning.iam_inline_policy_names) == [
                    policy.name for policy in payload.inline_policies
                ]
            if same_request:
                return ManagedPrivateAccessResult(
                    provisioning_id=provisioning.id,
                    status="active",
                    connection=self.connections.serialize(connection),
                )
        raise ManagedPrivateAccessConflict(
            "A managed private access already exists or requires cleanup for this execution context"
        )

    def _start_provisioning(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccess:
        provisioning = self._claim(user, source)
        self.audit.record(user, provisioning, "managed_private_access.provision.start")
        return provisioning

    def _claim(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccess:
        row = ManagedPrivateAccess(
            owner_user_id=user.id,
            source_context_type=source.kind,
            source_context_id=source.identifier,
            remote_principal_type=source.remote_principal_type,
            remote_principal_identifier=source.remote_principal_identifier,
            iam_username=source.iam_username,
            state="provisioning",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ManagedPrivateAccessConflict(
                "A managed private access operation already exists for this execution context"
            ) from exc
        self.db.refresh(row)
        return row

    def _create_connection(
        self,
        *,
        user: User,
        provisioning: ManagedPrivateAccess,
        destination: ManagedPrivateAccessDestination,
        connection_name: str,
        access_key_id: str,
        secret_access_key: str,
        access_browser: bool,
        access_manager: bool,
    ) -> ManagedPrivateAccessResult:
        rgw_user_uid, rgw_tenant, rgw_account_id = self._managed_connection_rgw_identity(provisioning)
        connection = S3Connection(
            created_by_user_id=user.id,
            name=connection_name,
            is_shared=False,
            is_active=True,
            access_manager=access_manager,
            access_browser=access_browser,
            server_managed=True,
            rgw_user_uid=rgw_user_uid,
            rgw_tenant=rgw_tenant,
            rgw_account_id=rgw_account_id,
            **destination.persistence_values(),
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(connection)
        self.db.flush()
        refresh_connection_detected_capabilities(connection)
        provisioning.s3_connection_id = connection.id
        provisioning.state = "active"
        provisioning.cleanup_error = None
        provisioning.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(connection)
        return ManagedPrivateAccessResult(
            provisioning_id=provisioning.id,
            status="active",
            connection=self.connections.serialize(connection),
        )

    def _activate_connection(
        self,
        *,
        user: User,
        provisioning: ManagedPrivateAccess,
        destination: ManagedPrivateAccessDestination,
        payload: ManagedPrivateAccessRequest,
        access_key_id: str,
        secret_access_key: str,
    ) -> ManagedPrivateAccessResult:
        result = self._create_connection(
            user=user,
            provisioning=provisioning,
            destination=destination,
            connection_name=payload.connection_name,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            access_browser=payload.access_browser,
            access_manager=payload.access_manager,
        )
        self.audit.record(user, provisioning, "managed_private_access.provision.success")
        return result

    def _managed_connection_rgw_identity(
        self,
        provisioning: ManagedPrivateAccess,
    ) -> tuple[str | None, str | None, str | None]:
        user_uid = None
        tenant = None
        account_id = None
        if provisioning.remote_principal_type == "iam_user":
            if provisioning.source_context_type == "account":
                source_account = self.db.get(S3Account, provisioning.source_context_id)
                account_id = source_account.rgw_account_id if source_account is not None else None
            elif provisioning.source_context_type == "connection":
                source_connection = self.db.get(S3Connection, provisioning.source_context_id)
                account_id = source_connection.rgw_account_id if source_connection is not None else None
        elif provisioning.remote_principal_type == "rgw_user":
            user_uid, tenant = extract_rgw_user_identity(
                {"uid": provisioning.remote_principal_identifier}
            )
        else:
            raise ManagedPrivateAccessError(
                f"Unsupported remote principal type: {provisioning.remote_principal_type}"
            )
        return normalize_connection_rgw_identity(user_uid, tenant, account_id)

    def _cleanup_remote(self, provisioning: ManagedPrivateAccess, *, user: User) -> None:
        if provisioning.remote_principal_type == "iam_user":
            iam = self._iam_service_for_source(provisioning, user)
            self._cleanup_iam_resources(provisioning, iam)
        else:
            users = S3UsersService(self.db)
            if provisioning.created_access_key and provisioning.access_key_id:
                users.delete_key(provisioning.source_context_id, provisioning.access_key_id)
                provisioning.created_access_key = False
                self.state.checkpoint(provisioning)

    def _iam_service_for_source(self, provisioning: ManagedPrivateAccess, user: User) -> RGWIAMService:
        if provisioning.source_context_type == "account":
            link = self.access.resolve_user(user).account_link_for(provisioning.source_context_id)
            if link is None or not self.access.manager_account_allowed(link):
                raise ManagedPrivateAccessForbidden("Account access was revoked")
            account = self.db.get(S3Account, provisioning.source_context_id)
            if account is None:
                raise ManagedPrivateAccessError("Source account not found")
            return self._iam_service_for_context(account)
        if provisioning.source_context_type != "connection":
            raise ManagedPrivateAccessError("Invalid IAM source context")
        connection = self.db.get(S3Connection, provisioning.source_context_id)
        if connection is None or not self.access.connection_is_allowed(user, connection, workspace="manager"):
            raise ManagedPrivateAccessForbidden("Source connection access was revoked")
        details = resolve_connection_details(connection)
        endpoint = connection.storage_endpoint
        if endpoint is not None:
            iam_endpoint = resolve_iam_endpoint(endpoint)
            iam_region = resolve_iam_signing_region(endpoint)
        elif (details.provider or "").strip().lower() == "aws":
            iam_endpoint, iam_region = aws_iam_client_options_for_region(details.region)
        else:
            iam_endpoint, iam_region = details.endpoint_url, details.region
        return get_iam_service(
            connection.access_key_id,
            connection.secret_access_key,
            endpoint=iam_endpoint,
            region=iam_region,
            verify_tls=details.verify_tls,
        )

    def _cleanup_iam_resources(self, provisioning: ManagedPrivateAccess, iam: RGWIAMService) -> None:
        username = provisioning.iam_username or provisioning.remote_principal_identifier
        errors: list[str] = []

        def attempt(operation, on_success) -> None:
            try:
                operation()
                on_success()
                self.state.checkpoint(provisioning)
            except Exception as exc:
                errors.append(sanitized_error_log_detail(exc))

        if provisioning.created_access_key and provisioning.access_key_id:
            attempt(
                lambda: iam.delete_access_key(username, provisioning.access_key_id or ""),
                lambda: setattr(provisioning, "created_access_key", False),
            )
        for name in reversed(self.state.string_list(provisioning.iam_inline_policy_names)):
            attempt(
                lambda name=name: iam.delete_user_inline_policy(username, name),
                lambda name=name: self.state.remove_list_value(provisioning, "iam_inline_policy_names", name),
            )
        for arn in reversed(self.state.string_list(provisioning.iam_managed_policies)):
            attempt(
                lambda arn=arn: iam.detach_user_policy(username, arn),
                lambda arn=arn: self.state.remove_list_value(provisioning, "iam_managed_policies", arn),
            )
        for group in reversed(self.state.string_list(provisioning.iam_groups)):
            attempt(
                lambda group=group: iam.remove_user_from_group(group, username),
                lambda group=group: self.state.remove_list_value(provisioning, "iam_groups", group),
            )
        if provisioning.created_remote_principal:
            attempt(
                lambda: iam.delete_user(username),
                lambda: setattr(provisioning, "created_remote_principal", False),
            )
        if errors:
            raise ManagedPrivateAccessError("; ".join(str(error) for error in errors))

    @staticmethod
    def _iam_service_for_context(context: S3ExecutionTarget) -> RGWIAMService:
        service = get_iam_service_for_execution_target(context)
        if service is None:
            raise ManagedPrivateAccessError("The source context has no IAM administration credentials")
        return service

    def _compensate_iam(
        self,
        provisioning_id: int,
        iam: RGWIAMService,
        *,
        failure: str,
        user: User,
    ) -> None:
        self._compensate(
            provisioning_id,
            cleanup=lambda provisioning: self._cleanup_iam_resources(
                provisioning,
                iam,
            ),
            failure=failure,
            user=user,
        )

    def _compensate_rgw_user(self, provisioning_id: int, *, failure: str, user: User) -> None:
        def cleanup(provisioning: ManagedPrivateAccess) -> None:
            if provisioning.created_access_key and provisioning.access_key_id:
                S3UsersService(self.db).delete_key(
                    provisioning.source_context_id,
                    provisioning.access_key_id,
                )

        self._compensate(
            provisioning_id,
            cleanup=cleanup,
            failure=failure,
            user=user,
        )

    def _compensate(
        self,
        provisioning_id: int,
        *,
        cleanup: Callable[[ManagedPrivateAccess], None],
        failure: str,
        user: User,
    ) -> None:
        provisioning = self.db.get(ManagedPrivateAccess, provisioning_id)
        if provisioning is None:
            return
        try:
            cleanup(provisioning)
        except Exception as cleanup_exc:
            cleanup_error = sanitized_error_log_detail(cleanup_exc)
            self.audit.record(
                user,
                provisioning,
                "managed_private_access.compensation.failure",
                status="failure",
                message=cleanup_error,
            )
            self._set_cleanup_pending(provisioning, cleanup_error, user=user)
            return
        provisioning.state = "failed"
        provisioning.cleanup_error = failure
        provisioning.updated_at = utcnow()
        self.db.commit()
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.compensation.success",
            status="failure",
            message=failure,
        )

    def _set_cleanup_pending(self, provisioning, error: str, *, user: User) -> None:
        provisioning.state = "cleanup_pending"
        provisioning.cleanup_error = error
        provisioning.updated_at = utcnow()
        self.db.commit()
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.cleanup_pending",
            status="failure",
            message=error,
        )
