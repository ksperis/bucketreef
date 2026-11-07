# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select

from app.core.domain_errors import S3AccountNotFoundError
from app.db import S3Account
from app.services.app_settings_service import load_app_settings_for_db
from app.services.s3_client import get_s3_client
from app.services.s3_connection_query_service import S3ConnectionQueryService
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.services.s3_user_repository import S3UserRepository
from app.utils.s3_endpoint import normalize_s3_endpoint, resolve_s3_client_options
from .execution_runtime import MIGRATION_USER_AGENT_MARKER, MigrationRuntimeLimits, ResolvedContext

class BucketMigrationExecutionContextMixin:
    def _context_client(self, ctx: ResolvedContext):
        from app.services.openstack_execution_guard import guard_openstack_client
        access_key, secret_key = ctx.execution_context.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError(f"Context '{ctx.context_id}' has no credentials")
        token = ctx.execution_context.session_token()
        return guard_openstack_client(ctx.execution_context, get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=ctx.endpoint,
            session_token=token,
            region=ctx.region,
            force_path_style=ctx.force_path_style,
            verify_tls=ctx.verify_tls,
            user_agent_extra=MIGRATION_USER_AGENT_MARKER,
            request_profile="long_running",
        ))

    def _load_runtime_limits(self) -> MigrationRuntimeLimits:
        manager = load_app_settings_for_db(self.db).manager
        return MigrationRuntimeLimits(
            parallelism_default=manager.bucket_migration_parallelism_default,
            parallelism_max=manager.bucket_migration_parallelism_max,
            max_active_per_endpoint=manager.bucket_migration_max_active_per_endpoint,
        )

    def _resolve_context(self, context_id: str) -> ResolvedContext:
        execution_context = self._context_to_execution_target(context_id)
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(execution_context)
        endpoint = normalize_s3_endpoint(endpoint)
        return ResolvedContext(
            context_id=context_id,
            execution_context=execution_context,
            endpoint=endpoint,
            region=region,
            force_path_style=force_path_style,
            verify_tls=verify_tls,
        )

    def _context_to_execution_target(self, context_id: str) -> S3ExecutionTarget:
        value = (context_id or "").strip()
        if value.startswith("os-"):
            from app.db import AuthSession, User
            from app.services.openstack_service import OpenStackService
            auth_id = self._execution_auth_session_id
            auth = self.db.get(AuthSession, auth_id) if auth_id else None
            user = self.db.get(User, auth.user_id) if auth else None
            if user is None:
                raise PermissionError("OpenStack migration requires its initiating UI session")
            return OpenStackService(self.db).resolve(user, auth_id, value)
        if not value:
            raise ValueError("Invalid context id")

        if value.startswith("conn-"):
            suffix = value.split("conn-", 1)[1]
            if not suffix.isdigit():
                raise ValueError("Invalid connection context id")
            conn = S3ConnectionQueryService(self.db).get_record(int(suffix))
            return S3ExecutionContext.from_connection(conn)

        if value.startswith("s3u-"):
            suffix = value.split("s3u-", 1)[1]
            if not suffix.isdigit():
                raise ValueError("Invalid S3 user context id")
            s3_user = S3UserRepository(self.db).get(int(suffix))
            return S3ExecutionContext.from_s3_user(s3_user)

        if not value.isdigit():
            raise ValueError("Invalid account context id")
        account = self.db.scalars(
            select(S3Account).where(S3Account.id == int(value))
        ).first()
        if not account:
            raise S3AccountNotFoundError("S3 account not found")
        return account
