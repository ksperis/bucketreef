# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from typing import Any, Optional

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.orm.attributes import set_committed_value

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import BucketMigrationItem
from app.services.rgw_principal_scope import resolve_target_admin_uid
from app.services.s3_client import S3OperationError
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.normalize import normalize_optional_string

from .diagnostics import (
    MigrationCopyGrantError,
    MigrationPolicyApplyError,
    MigrationPrecheckError,
)
from .execution_runtime import MIGRATION_USER_AGENT_MARKER, ResolvedContext

_READ_ONLY_POLICY_SID = "BucketReefMigrationReadOnlyDeny"
_TARGET_WRITE_LOCK_POLICY_SID = "BucketReefMigrationTargetWriteLockDeny"
_SOURCE_COPY_GRANT_POLICY_SID = "BucketReefMigrationSourceCopyGrantAllow"


class BucketMigrationPolicyGrantsMixin:
    def _source_copy_grant_principal_candidates(self, target_ctx: ResolvedContext) -> list[str]:
        context_id = normalize_optional_string(target_ctx.context_id) or ""
        if context_id.startswith("conn-"):
            return []

        execution_context = target_ctx.execution_context
        account_id = normalize_optional_string(execution_context.rgw_account_id)
        explicit_uid = normalize_optional_string(execution_context.rgw_user_uid)
        resolved_uid = normalize_optional_string(resolve_target_admin_uid(execution_context))

        candidates: list[str] = []
        seen: set[str] = set()

        def push(value: Optional[str]) -> None:
            normalized = normalize_optional_string(value)
            if not normalized or normalized in seen:
                return
            seen.add(normalized)
            candidates.append(normalized)

        for uid in (explicit_uid, resolved_uid):
            if not uid:
                continue
            push(uid)
            push(f"arn:aws:iam:::user/{uid}")
            if account_id:
                push(f"arn:aws:iam::{account_id}:user/{uid}")

        if account_id:
            push(account_id)
            push(f"arn:aws:iam::{account_id}:root")

        return candidates

    def _without_managed_policy_statement(
        self,
        policy: Any,
        *,
        sid: str,
    ) -> Optional[dict[str, Any]]:
        if not isinstance(policy, dict):
            return None

        policy_doc: dict[str, Any] = deepcopy(policy)
        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        filtered_statements = [
            statement
            for statement in statements
            if not (isinstance(statement, dict) and statement.get("Sid") == sid)
        ]
        if not filtered_statements:
            return None

        policy_doc["Statement"] = filtered_statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _without_managed_source_copy_grant_statement(self, policy: Any) -> Optional[dict[str, Any]]:
        return self._without_managed_policy_statement(policy, sid=_SOURCE_COPY_GRANT_POLICY_SID)

    def _build_source_copy_grant_policy(
        self,
        source_bucket: str,
        existing_policy: Optional[dict[str, Any]],
        *,
        principal: str,
    ) -> dict[str, Any]:
        base_policy = self._without_managed_source_copy_grant_statement(existing_policy)
        if isinstance(base_policy, dict):
            policy_doc: dict[str, Any] = deepcopy(base_policy)
        else:
            policy_doc = {"Version": "2012-10-17", "Statement": []}

        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        statements.append(
            {
                "Sid": _SOURCE_COPY_GRANT_POLICY_SID,
                "Effect": "Allow",
                "Principal": {"AWS": principal},
                "Action": [
                    "s3:GetObject",
                    "s3:GetObjectVersion",
                ],
                "Resource": [f"arn:aws:s3:::{source_bucket}/*"],
            }
        )
        policy_doc["Statement"] = statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _read_source_copy_grant_backup(
        self,
        source_bucket: str,
        source_execution_context: S3ExecutionTarget,
    ):
        try:
            return self._configuration.get_policy(
                source_bucket,
                source_execution_context,
            )
        except S3OperationError as exc:
            if self._is_access_denied_error(exc):
                raise MigrationCopyGrantError(
                    "Unable to read source bucket policy for temporary source-read grant. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise MigrationCopyGrantError(
                "Unable to read source bucket policy for temporary source-read grant: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc

    def _select_source_copy_grant_principal(
        self,
        target_client,
        candidates: list[str],
        *,
        source_bucket: str,
        source_execution_context: S3ExecutionTarget,
        backup_policy,
        sample_key: Optional[str],
        sample_version_id: Optional[str],
    ) -> tuple[Optional[str], Optional[Exception]]:
        last_access_error: Optional[Exception] = None
        for candidate in candidates:
            policy_doc = self._build_source_copy_grant_policy(
                source_bucket,
                backup_policy if isinstance(backup_policy, dict) else None,
                principal=candidate,
            )
            try:
                self._assert_workflow_lease()
                self._configuration.put_policy(
                    source_bucket,
                    source_execution_context,
                    policy_doc,
                )
            except S3OperationError as exc:
                if self._is_access_denied_error(exc):
                    raise MigrationCopyGrantError(
                        "Unable to apply temporary source-read grant: access denied on source bucket policy update. "
                        f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                    ) from exc
                raise MigrationCopyGrantError(
                    "Unable to apply temporary source-read grant: "
                    f"{sanitized_error_log_detail(exc)}"
                ) from exc
            if not sample_key:
                return candidate, None
            try:
                head_kwargs: dict[str, Any] = {
                    "Bucket": source_bucket,
                    "Key": sample_key,
                }
                if sample_version_id:
                    head_kwargs["VersionId"] = sample_version_id
                target_client.head_object(**head_kwargs)
                return candidate, None
            except (ClientError, BotoCoreError) as exc:
                if self._is_access_denied_error(exc):
                    last_access_error = exc
                    continue
                raise MigrationCopyGrantError(
                    "Unable to validate temporary source-read grant on sample object "
                    f"'{sample_key}': {sanitized_error_log_detail(exc)}"
                ) from exc
        return None, last_access_error

    @contextmanager
    def _temporary_source_copy_grant(self, source_ctx, target_ctx, *, source_bucket, sample_key=None, sample_version_id=None):
        item = self._preparation_item or self._execution_item
        if item is None:
            raise RuntimeError("Temporary grants require a persisted recovery record")
        backup = self._read_source_copy_grant_backup(
            source_bucket,
            source_ctx.execution_context,
        )
        self._journal_preparation_effect(
            item,
            "source_copy_grant",
            {
                "context_id": source_ctx.context_id,
                "bucket": source_bucket,
                "policy": backup,
            },
        )
        try:
            candidates = self._source_copy_grant_principal_candidates(target_ctx)
            if not candidates:
                raise MigrationCopyGrantError(
                    "Target context identity is not supported for temporary source-read grant. "
                    "Use an account/s3_user target context or grant source read permissions manually."
                )

            target_client = self._context_client(target_ctx)
            selected_principal, last_access_error = self._select_source_copy_grant_principal(
                target_client,
                candidates,
                source_bucket=source_bucket,
                source_execution_context=source_ctx.execution_context,
                backup_policy=backup,
                sample_key=sample_key,
                sample_version_id=sample_version_id,
            )
            if selected_principal is None:
                if last_access_error is not None:
                    raise MigrationCopyGrantError(
                        f"Temporary source-read grant could not be validated for bucket '{source_bucket}'."
                    ) from last_access_error
                raise MigrationCopyGrantError(
                    "Unable to determine a compatible target principal for temporary source-read grant."
                )

            yield selected_principal
        finally:
            self._restore_checked_policy(source_ctx.execution_context, source_bucket, backup)
            self._clear_preparation_effect(item, "source_copy_grant")

    def _build_read_only_policy(
        self,
        source_bucket: str,
        existing_policy: Optional[dict[str, Any]],
        *,
        deny_delete: bool = True,
    ) -> dict[str, Any]:
        base_policy = self._without_managed_read_only_statement(existing_policy)
        if isinstance(base_policy, dict):
            policy_doc: dict[str, Any] = deepcopy(base_policy)
        else:
            policy_doc = {"Version": "2012-10-17", "Statement": []}

        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        filtered_statements = [
            statement
            for statement in statements
            if not (isinstance(statement, dict) and statement.get("Sid") == _READ_ONLY_POLICY_SID)
        ]
        actions = [
            # Object write operations that can introduce source/target drift.
            "s3:PutObject",
            "s3:PutObjectAcl",
            "s3:PutObjectTagging",
            "s3:PutObjectVersionAcl",
            "s3:PutObjectVersionTagging",
            "s3:PutObjectLegalHold",
            "s3:PutObjectRetention",
            "s3:AbortMultipartUpload",
            "s3:RestoreObject",
        ]
        resources: list[str] = [f"arn:aws:s3:::{source_bucket}/*"]

        if deny_delete:
            actions.extend(
                [
                    "s3:DeleteObject",
                    "s3:DeleteObjectVersion",
                    "s3:DeleteObjectTagging",
                    "s3:DeleteObjectVersionTagging",
                    "s3:DeleteBucket",
                ]
            )
            resources.append(f"arn:aws:s3:::{source_bucket}")

        filtered_statements.append(
            {
                "Sid": _READ_ONLY_POLICY_SID,
                "Effect": "Deny",
                "Principal": "*",
                "Action": actions,
                "Resource": resources,
            }
        )
        policy_doc["Statement"] = filtered_statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _build_target_write_lock_policy(
        self,
        target_bucket: str,
        existing_policy: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        base_policy = self._without_managed_target_write_lock_statement(existing_policy)
        if isinstance(base_policy, dict):
            policy_doc: dict[str, Any] = deepcopy(base_policy)
        else:
            policy_doc = {"Version": "2012-10-17", "Statement": []}

        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        filtered_statements = [
            statement
            for statement in statements
            if not (isinstance(statement, dict) and statement.get("Sid") == _TARGET_WRITE_LOCK_POLICY_SID)
        ]
        filtered_statements.append(
            {
                "Sid": _TARGET_WRITE_LOCK_POLICY_SID,
                "Effect": "Deny",
                "Principal": "*",
                "Action": [
                    "s3:PutObject",
                    "s3:PutObjectAcl",
                    "s3:PutObjectTagging",
                    "s3:PutObjectVersionAcl",
                    "s3:PutObjectVersionTagging",
                    "s3:PutObjectLegalHold",
                    "s3:PutObjectRetention",
                    "s3:AbortMultipartUpload",
                    "s3:RestoreObject",
                    "s3:DeleteObject",
                    "s3:DeleteObjectVersion",
                    "s3:DeleteObjectTagging",
                    "s3:DeleteObjectVersionTagging",
                    "s3:DeleteBucket",
                ],
                "Resource": [
                    f"arn:aws:s3:::{target_bucket}/*",
                    f"arn:aws:s3:::{target_bucket}",
                ],
                "Condition": {
                    "StringNotLike": {
                        "aws:UserAgent": f"*{MIGRATION_USER_AGENT_MARKER}*",
                    }
                },
            }
        )
        policy_doc["Statement"] = filtered_statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _without_managed_read_only_statement(self, policy: Any) -> Optional[dict[str, Any]]:
        return self._without_managed_policy_statement(policy, sid=_READ_ONLY_POLICY_SID)

    def _without_managed_target_write_lock_statement(self, policy: Any) -> Optional[dict[str, Any]]:
        return self._without_managed_policy_statement(policy, sid=_TARGET_WRITE_LOCK_POLICY_SID)

    def _remove_managed_policy_statement(
        self,
        bucket_name: str,
        execution_context: S3ExecutionTarget,
        *,
        sid: str,
    ) -> None:
        existing_policy = self._configuration.get_policy(bucket_name, execution_context)
        cleaned = self._without_managed_policy_statement(existing_policy, sid=sid)
        if isinstance(cleaned, dict):
            self._configuration.put_policy(bucket_name, execution_context, cleaned)
            return
        self._configuration.delete_policy(bucket_name, execution_context)

    def _remove_managed_target_write_lock_statement(
        self,
        target_bucket: str,
        target_execution_context: S3ExecutionTarget,
    ) -> None:
        self._remove_managed_policy_statement(
            target_bucket,
            target_execution_context,
            sid=_TARGET_WRITE_LOCK_POLICY_SID,
        )

    def _set_managed_block_policy(
        self,
        source_bucket: str,
        source_execution_context: S3ExecutionTarget,
        *,
        deny_delete: bool,
    ) -> None:
        self._assert_workflow_lease()
        try:
            existing_policy = self._configuration.get_policy(
                source_bucket,
                source_execution_context,
            )
            policy_doc = self._build_read_only_policy(
                source_bucket,
                existing_policy if isinstance(existing_policy, dict) else None,
                deny_delete=deny_delete,
            )
            self._configuration.put_policy(
                source_bucket,
                source_execution_context,
                policy_doc,
            )
        except S3OperationError as exc:
            if self._is_access_denied_error(exc):
                mode = "read-only" if deny_delete else "write-block"
                raise MigrationPolicyApplyError(
                    f"Unable to set source bucket to {mode}: access denied on bucket policy update. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise MigrationPolicyApplyError(
                "Unable to update source bucket protection policy: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc

    def _precheck_policy_roundtrip(
        self,
        source_execution_context: S3ExecutionTarget,
        source_bucket: str,
    ) -> None:
        try:
            existing_policy = self._configuration.get_policy(
                source_bucket,
                source_execution_context,
            )
        except S3OperationError as exc:
            if self._is_access_denied_error(exc):
                raise MigrationPrecheckError(
                    "Unable to read source bucket policy during precheck. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise MigrationPrecheckError(
                "Unable to read source bucket policy during precheck: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc

        policy_doc = self._build_read_only_policy(
            source_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )

        item = self._preparation_item
        if item is None:
            raise RuntimeError("Active policy checks require a persisted preparation item")
        migration = item.migration
        self._journal_preparation_effect(item, "source_policy", {
            "context_id": migration.source_context_id, "bucket": source_bucket, "policy": existing_policy,
        })
        try:
            try:
                self._configuration.put_policy(
                    source_bucket,
                    source_execution_context,
                    policy_doc,
                )
            except S3OperationError as exc:
                raise MigrationPrecheckError(
                    "Unable to apply source protection during precheck: "
                    f"{sanitized_error_log_detail(exc)}"
                ) from exc
        finally:
            self._restore_checked_policy(
                source_execution_context,
                source_bucket,
                existing_policy,
            )
            self._clear_preparation_effect(item, "source_policy")

    def _apply_read_only_policy(
        self,
        source_execution_context: S3ExecutionTarget,
        source_bucket: str,
        item: BucketMigrationItem,
    ) -> None:
        self._assert_workflow_lease()
        if item.read_only_applied:
            self._set_managed_block_policy(
                source_bucket,
                source_execution_context,
                deny_delete=True,
            )
            return
        try:
            existing_policy = self._configuration.get_policy(
                source_bucket,
                source_execution_context,
            )
        except S3OperationError as exc:
            raise MigrationPolicyApplyError(
                "Unable to read source bucket policy before applying read-only protection: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc
        source_policy_backup = existing_policy if isinstance(existing_policy, dict) else None
        item_id = getattr(item, "id", None)
        migration_id = getattr(item, "migration_id", None)
        if item_id is None or migration_id is None:
            item.source_policy_backup = source_policy_backup
            item.read_only_applied = True
            self._commit()
        else:
            def persist_intent(_migration, current_item: BucketMigrationItem) -> None:
                current_item.source_policy_backup = source_policy_backup
                current_item.read_only_applied = True

            _migration, current_item = self._persist_item_checkpoint(
                int(migration_id),
                int(item_id),
                persist_intent,
            )
            set_committed_value(
                item,
                "source_policy_backup",
                current_item.source_policy_backup,
            )
            set_committed_value(
                item,
                "read_only_applied",
                current_item.read_only_applied,
            )
        policy_doc = self._build_read_only_policy(
            source_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )
        try:
            self._configuration.put_policy(
                source_bucket,
                source_execution_context,
                policy_doc,
            )
        except S3OperationError as exc:
            if self._is_access_denied_error(exc):
                raise MigrationPolicyApplyError(
                    "Unable to set source bucket to read-only: access denied on PutBucketPolicy. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise MigrationPolicyApplyError(
                "Unable to set source bucket to read-only: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc

    def _apply_target_write_lock_policy(self, target_ctx: ResolvedContext, target_bucket: str, item: BucketMigrationItem) -> None:
        self._assert_workflow_lease()
        if item.target_lock_applied:
            return
        try:
            existing_policy = self._configuration.get_policy(
                target_bucket,
                target_ctx.execution_context,
            )
        except S3OperationError as exc:
            raise MigrationPolicyApplyError(
                "Unable to read destination bucket policy before applying write-lock: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc
        target_policy_backup = existing_policy if isinstance(existing_policy, dict) else None
        item_id = getattr(item, "id", None)
        migration_id = getattr(item, "migration_id", None)
        if item_id is None or migration_id is None:
            item.target_policy_backup = target_policy_backup
            item.target_lock_applied = True
            self._commit()
        else:
            def persist_intent(_migration, current_item: BucketMigrationItem) -> None:
                current_item.target_policy_backup = target_policy_backup
                current_item.target_lock_applied = True

            _migration, current_item = self._persist_item_checkpoint(
                int(migration_id),
                int(item_id),
                persist_intent,
            )
            set_committed_value(
                item,
                "target_policy_backup",
                current_item.target_policy_backup,
            )
            set_committed_value(
                item,
                "target_lock_applied",
                current_item.target_lock_applied,
            )
        lock_policy_doc = self._build_target_write_lock_policy(
            target_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )
        try:
            self._configuration.put_policy(target_bucket, target_ctx.execution_context, lock_policy_doc)
        except S3OperationError as exc:
            if self._is_access_denied_error(exc):
                raise MigrationPolicyApplyError(
                    "Unable to set destination bucket write-lock: access denied on PutBucketPolicy. "
                    f"Required permissions on '{target_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise MigrationPolicyApplyError(
                "Unable to set destination bucket write-lock: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc

    def _restore_target_write_lock_policy(
        self,
        target_execution_context: S3ExecutionTarget,
        target_bucket: str,
        item: BucketMigrationItem,
    ) -> None:
        self._assert_workflow_lease()
        backup = item.target_policy_backup
        if isinstance(backup, dict):
            self._configuration.put_policy(
                target_bucket,
                target_execution_context,
                backup,
            )
            return
        self._configuration.delete_policy(target_bucket, target_execution_context)
