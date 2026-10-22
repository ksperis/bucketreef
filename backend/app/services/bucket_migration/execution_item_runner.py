# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import BucketMigration, BucketMigrationItem
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.aws_errors import aws_error_code
from app.utils.time import utcnow

from ._shared import (
    _ResolvedContext,
    _WorkerLeaseLostError,
    _json_dumps,
    _json_loads,
)
from .execution_item_loop import _MigrationItemExecutionLoop
from .execution_settings_copy import _BucketSettingsCopyRunner
from .diagnostics import MigrationPermissionCheckError


class BucketMigrationItemRunnerMixin:
    def _item_execution_strategy(self, item: BucketMigrationItem) -> str:
        strategy = item.execution_strategy
        if not isinstance(strategy, str) or not strategy:
            raise RuntimeError(
                "Migration item is missing a valid execution strategy. Re-run precheck before starting the migration."
            )
        return strategy

    def _load_item_replication_state(self, item: BucketMigrationItem) -> dict[str, Any]:
        parsed = _json_loads(item.replication_state_json)
        return parsed if isinstance(parsed, dict) else {}

    def _store_item_replication_state(self, item: BucketMigrationItem, state: dict[str, Any]) -> None:
        item.replication_state_json = self._json_dumps_safe(state)

    def _assert_item_execution_strategy_supported(self, item: BucketMigrationItem) -> None:
        strategy = self._item_execution_strategy(item)
        if strategy not in {"current_only", "version_aware", "skip_existing"}:
            raise RuntimeError(
                f"Execution strategy '{strategy}' is not implemented by the migration worker."
            )

    def _stop_interrupted_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        control_check: Callable[[], str],
    ) -> None:
        state = control_check()
        if state == "lost_lease":
            raise _WorkerLeaseLostError(f"Worker lease lost for migration {migration.id}")
        if state == "cancel":
            item.status = "canceled"
            item.finished_at = utcnow()
        else:
            item.status = "paused"
        item.updated_at = utcnow()
        self._commit()

    def _store_item_diff(self, item: BucketMigrationItem, diff: Any) -> None:
        item.source_count = diff.source_count
        item.target_count = diff.target_count
        item.matched_count = diff.matched_count
        item.different_count = diff.different_count
        item.only_source_count = diff.only_source_count
        item.only_target_count = diff.only_target_count
        item.diff_sample_json = _json_dumps(diff.sample)

    def _run_verify_step(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        strategy: str,
        control_check: Callable[[], str],
    ) -> bool:
        diff = self._compare_buckets_streamed(
            source_ctx,
            target_ctx,
            source_bucket=item.source_bucket,
            target_bucket=item.target_bucket,
            strategy=strategy,
            control_check=control_check,
        )
        if diff is None:
            self._stop_interrupted_item(migration, item, control_check)
            return False

        self._store_item_diff(item, diff)
        if bool(diff.different_count or diff.only_source_count or diff.only_target_count):
            self._fail_item_for_final_diff(migration, item, diff)
            return False

        if migration.strong_integrity_check and not self._verify_strong_integrity(migration, item, source_ctx, target_ctx, strategy=strategy, control_check=control_check):
            return False
        self._complete_item_after_verification(migration, item, target_ctx)
        return False

    def _fail_item_for_final_diff(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        diff: Any,
    ) -> None:
        item.status = "failed"
        item.error_message = "Final diff is not clean"
        item.finished_at = utcnow()
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="error",
            message="Final diff detected differences.",
            metadata={
                "different_count": diff.different_count,
                "only_source_count": diff.only_source_count,
                "only_target_count": diff.only_target_count,
            },
        )
        self._commit()

    def _verify_strong_integrity(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        strategy: str,
        control_check: Callable[[], str],
    ) -> bool:
        (
            size_only_count,
            verified_count,
            failed_keys,
            method_counts,
        ) = self._strong_verify_size_only_candidates_streamed(
            source_ctx,
            target_ctx,
            source_bucket=item.source_bucket,
            target_bucket=item.target_bucket,
            strategy=strategy,
            parallelism_max=max(1, min(int(migration.parallelism_max), 4)),
            control_check=control_check,
        )
        if size_only_count < 0:
            self._stop_interrupted_item(migration, item, control_check)
            return False
        if failed_keys:
            self._fail_item_for_strong_verification(
                migration,
                item,
                size_only_count=size_only_count,
                verified_count=verified_count,
                failed_keys=failed_keys,
                method_counts=method_counts,
            )
            return False

        self._add_event(
            migration,
            item=item,
            level="info",
            message="Strong verification completed for size-only candidates.",
            metadata={
                "size_only_count": size_only_count,
                "verified_count": verified_count,
                "method_counts": method_counts,
            },
        )
        return True

    def _fail_item_for_strong_verification(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        *,
        size_only_count: int,
        verified_count: int,
        failed_keys: list[str],
        method_counts: dict[str, int],
    ) -> None:
        item.status = "failed"
        item.error_message = (
            "Final strong verification failed for "
            f"{len(failed_keys)} object(s) out of {size_only_count} size-only candidate(s); "
            "the source is retained."
        )
        item.finished_at = utcnow()
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="error",
            message="Strong copy verification failed. Source retained.",
            metadata={
                "size_only_count": size_only_count,
                "verified_count": verified_count,
                "failed_count": len(failed_keys),
                "failed_sample": failed_keys[:20],
                "method_counts": method_counts,
            },
        )
        self._commit()

    def _complete_item_after_verification(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        target_ctx: _ResolvedContext,
    ) -> None:
        self._finalize_target_versioning_state(
            target_ctx.execution_context,
            item.target_bucket,
            migration,
            item,
        )
        item.status = "completed"
        item.step = "completed"
        item.finished_at = utcnow()
        item.updated_at = utcnow()
        self._add_event(migration, item=item, level="info", message="Item completed with clean diff.")
        self._commit()

    def _run_create_bucket_step(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        strategy: str,
    ) -> bool:
        object_lock_enabled = False
        if migration.copy_bucket_settings:
            object_lock = self._configuration.get_bucket_object_lock(
                item.source_bucket,
                source_ctx.execution_context,
            )
            object_lock_enabled = bool(object_lock and object_lock.enabled)
        exists = self._precheck_bucket_exists(target_ctx, item.target_bucket)
        if exists is None:
            raise RuntimeError("Destination existence cannot be verified. Check destination access.")
        if exists and not item.target_created_by_migration:
            raise RuntimeError("Destination already exists and was not created by this migration. Choose a new name.")
        if not exists:
            self._buckets.create_bucket(
                item.target_bucket,
                target_ctx.execution_context,
                versioning=(strategy == "version_aware"),
                location_constraint=target_ctx.region, object_lock_enabled=object_lock_enabled,
            )
            item.target_created_by_migration = True
            self._commit()

        self._add_event(
            migration,
            item=item,
            level="info",
            message="Target bucket created.",
            metadata={"target_bucket": item.target_bucket, "object_lock_enabled": object_lock_enabled},
        )
        item.step = (
            "copy_bucket_settings"
            if migration.copy_bucket_settings
            else self._next_step_after_target_setup(migration, item)
        )
        self._commit()
        return True

    def _run_apply_target_lock_step(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        target_ctx: _ResolvedContext,
    ) -> None:
        try:
            self._apply_target_write_lock_policy(target_ctx, item.target_bucket, item)
            item.target_lock_applied = True
        except Exception as exc:  # noqa: BLE001
            lock_error = sanitized_error_log_detail(exc)
            try:
                if item.target_policy_backup_json:
                    self._restore_target_write_lock_policy(
                        target_ctx.execution_context,
                        item.target_bucket,
                        item,
                    )
                else:
                    self._remove_managed_target_write_lock_statement(
                        item.target_bucket,
                        target_ctx.execution_context,
                    )
                self._verify_restored_bucket_policy(
                    target_ctx.execution_context,
                    item.target_bucket,
                    _json_loads(item.target_policy_backup_json),
                )
            except Exception as restore_exc:
                lock_error = (
                    f"{lock_error}; restore attempt failed: "
                    f"{sanitized_error_log_detail(restore_exc)}"
                )
            else:
                item.target_lock_applied = False
                item.target_policy_backup_json = None
                self._commit()
            raise RuntimeError(f"Target write-lock policy could not be applied: {lock_error}") from exc

        item.step = "pre_sync" if migration.mode == "pre_sync" and not item.pre_sync_done else "apply_read_only"
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Target write-lock policy applied.",
        )
        self._commit()

    def _run_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        control_check: Callable[[], str],
    ) -> None:
        self._execution_item = item
        if item.target_created_by_migration and migration.lock_target_writes and not item.target_lock_applied:
            self._apply_target_write_lock_policy(target_ctx, item.target_bucket, item)
            self._commit()
        _MigrationItemExecutionLoop(
            service=self,
            migration=migration,
            item=item,
            source_ctx=source_ctx,
            target_ctx=target_ctx,
            control_check=control_check,
        ).run()

    def _copy_bucket_settings(
        self,
        source_execution_context: S3ExecutionTarget,
        source_bucket: str,
        target_execution_context: S3ExecutionTarget,
        target_bucket: str,
        migration: BucketMigration,
        item: BucketMigrationItem,
        *,
        strategy: str | None = None,
    ) -> None:
        _BucketSettingsCopyRunner(
            service=self,
            source_execution_context=source_execution_context,
            source_bucket=source_bucket,
            target_execution_context=target_execution_context,
            target_bucket=target_bucket,
            migration=migration,
            item=item,
            strategy=strategy,
        ).run()

    def _precheck_can_list_bucket(self, source_ctx: _ResolvedContext, source_bucket: str) -> bool:
        client = self._context_client(source_ctx)
        try:
            page = client.list_objects_v2(Bucket=source_bucket, MaxKeys=1)
        except (ClientError, BotoCoreError) as exc:
            raise MigrationPermissionCheckError("Cannot list source bucket objects.", "s3:ListBucket", exc) from exc

        contents = page.get("Contents", []) or []
        sample_key = contents[0].get("Key") if contents and isinstance(contents[0], dict) else None
        if not isinstance(sample_key, str) or not sample_key:
            return False
        try:
            client.head_object(Bucket=source_bucket, Key=sample_key)
            response = client.get_object(Bucket=source_bucket, Key=sample_key)
            body = response.get("Body")
            if body is None:
                raise RuntimeError("Source content response has no readable body")
            try:
                body.read(1)
            finally:
                body.close()
            try:
                client.get_object_tagging(Bucket=source_bucket, Key=sample_key)
            except (ClientError, BotoCoreError) as exc:
                raise MigrationPermissionCheckError("Cannot read source object tags (s3:GetObjectTagging).", "s3:GetObjectTagging", exc) from exc
        except (ClientError, BotoCoreError) as exc:
            raise MigrationPermissionCheckError("Cannot read source object contents.", "s3:GetObject", exc) from exc
        return True

    def _sample_version_probe_candidate(
        self,
        *,
        source_profile: Optional[dict[str, Any]] = None,
    ) -> Optional[tuple[str, str]]:
        if not isinstance(source_profile, dict):
            return None
        version_scan = source_profile.get("version_scan")
        if not isinstance(version_scan, dict):
            return None
        sample_version = version_scan.get("sample_version")
        if not isinstance(sample_version, dict):
            return None
        key = sample_version.get("key")
        version_id = sample_version.get("version_id")
        if not isinstance(key, str) or not key or not isinstance(version_id, str) or not version_id:
            return None
        return key, version_id

    def _precheck_version_aware_source_access(
        self,
        source_ctx: _ResolvedContext,
        source_bucket: str,
        source_profile: Optional[dict[str, Any]],
    ) -> None:
        candidate = self._sample_version_probe_candidate(
            source_profile=source_profile,
        )
        if candidate is None:
            return
        sample_key, sample_version_id = candidate
        client = self._context_client(source_ctx)
        try:
            client.head_object(Bucket=source_bucket, Key=sample_key, VersionId=sample_version_id)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to read sample version '{sample_version_id}' for '{sample_key}' in source bucket "
                f"'{source_bucket}': {exc}"
            ) from exc

        body = None
        try:
            response = client.get_object(Bucket=source_bucket, Key=sample_key, VersionId=sample_version_id)
            body = response.get("Body")
            if body is None:
                raise RuntimeError("Source version content could not be read")
            body.read(1)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to stream sample version '{sample_version_id}' for '{sample_key}' in source bucket "
                f"'{source_bucket}': {exc}"
            ) from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass

        try:
            client.get_object_tagging(Bucket=source_bucket, Key=sample_key, VersionId=sample_version_id)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to read tags for sample version '{sample_version_id}' of '{sample_key}' in source bucket "
                f"'{source_bucket}': {exc}"
            ) from exc

    def _count_bucket_objects(self, ctx: _ResolvedContext, bucket_name: str) -> int:
        client = self._context_client(ctx)
        continuation_token: Optional[str] = None
        total = 0
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                page = client.list_objects_v2(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to count objects in bucket '{bucket_name}': {exc}") from exc
            contents = page.get("Contents", []) if isinstance(page, dict) else []
            if isinstance(contents, list):
                total += len(contents)
            continuation_token = page.get("NextContinuationToken") if isinstance(page, dict) else None
            if not continuation_token:
                break
        return total

    def _same_endpoint_copy_probe_candidate(
        self,
        source_ctx: _ResolvedContext,
        source_bucket: str,
        *,
        strategy: str,
        source_profile: Optional[dict[str, Any]],
    ) -> tuple[Optional[str], Optional[str], Optional[str]]:
        if strategy == "version_aware":
            candidate = self._sample_version_probe_candidate(source_profile=source_profile)
            if candidate is not None:
                return candidate[0], candidate[1], None

        source_client = self._context_client(source_ctx)
        try:
            page = source_client.list_objects_v2(Bucket=source_bucket, MaxKeys=1)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to list source bucket '{source_bucket}' to validate x-amz-copy-source access: {exc}"
            ) from exc

        contents = page.get("Contents", []) if isinstance(page, dict) else []
        sample_key = contents[0].get("Key") if contents and isinstance(contents[0], dict) else None
        if isinstance(sample_key, str) and sample_key:
            return sample_key, None, None

        version_scan = source_profile.get("version_scan") if isinstance(source_profile, dict) else None
        delete_markers_only = (
            strategy == "version_aware"
            and isinstance(version_scan, dict)
            and int(version_scan.get("current_version_count") or 0) == 0
            and int(version_scan.get("noncurrent_version_count") or 0) == 0
            and int(version_scan.get("delete_marker_count") or 0) > 0
        )
        return None, None, "validated" if delete_markers_only else "source_empty"

    def _validate_same_endpoint_copy_target_access(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        *,
        sample_key: str,
        sample_version_id: Optional[str],
        auto_grant: bool,
    ) -> str:
        target_client = self._context_client(target_ctx)
        head_kwargs: dict[str, Any] = {"Bucket": source_bucket, "Key": sample_key}
        if sample_version_id:
            head_kwargs["VersionId"] = sample_version_id

        try:
            target_client.head_object(**head_kwargs)
            return "validated"
        except (ClientError, BotoCoreError) as exc:
            if not self._is_access_denied_error(exc):
                raise RuntimeError(
                    f"Unable to validate target access to sample source object '{sample_key}' in bucket "
                    f"'{source_bucket}' for x-amz-copy-source: {exc}"
                ) from exc
            if not auto_grant:
                permission_hint = "s3:GetObjectVersion" if sample_version_id else "s3:GetObject"
                raise RuntimeError(
                    "Target context cannot read source objects required for x-amz-copy-source. "
                    f"Grant {permission_hint} on source bucket '{source_bucket}'."
                ) from exc

            try:
                with self._temporary_source_copy_grant(
                    source_ctx,
                    target_ctx,
                    source_bucket=source_bucket,
                    sample_key=sample_key,
                    sample_version_id=sample_version_id,
                ):
                    target_client.head_object(**head_kwargs)
            except Exception as grant_exc:  # noqa: BLE001
                raise RuntimeError(
                    "Unable to validate temporary same-endpoint source-read grant for x-amz-copy-source: "
                    f"{grant_exc}"
                ) from grant_exc
            return "validated_with_temporary_grant"

    def _precheck_same_endpoint_copy_source_access(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        *,
        auto_grant: bool,
        strategy: str = "current_only",
        source_profile: Optional[dict[str, Any]] = None,
    ) -> str:
        sample_key, sample_version_id, empty_result = self._same_endpoint_copy_probe_candidate(
            source_ctx,
            source_bucket,
            strategy=strategy,
            source_profile=source_profile,
        )
        if empty_result is not None:
            return empty_result
        assert sample_key is not None  # guarded by empty_result
        return self._validate_same_endpoint_copy_target_access(
            source_ctx,
            target_ctx,
            source_bucket,
            sample_key=sample_key,
            sample_version_id=sample_version_id,
            auto_grant=auto_grant,
        )

    def _precheck_bucket_exists(self, target_ctx: _ResolvedContext, target_bucket: str) -> Optional[bool]:
        client = self._context_client(target_ctx)
        try:
            client.head_bucket(Bucket=target_bucket)
            return True
        except ClientError as exc:
            code = aws_error_code(exc, lowercase=True)
            status_code = (
                int(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)
                if hasattr(exc, "response")
                else 0
            )
            if code in {"nosuchbucket", "notfound"} or status_code == 404:
                return False
            if code in {"forbidden", "accessdenied"} or status_code == 403:
                # Some S3 implementations deny HeadBucket even for owned buckets.
                try:
                    listing = client.list_buckets()
                    buckets = listing.get("Buckets", []) or []
                    names = {entry.get("Name") for entry in buckets if isinstance(entry, dict)}
                    if target_bucket in names:
                        return True
                except (ClientError, BotoCoreError):
                    return None
                return None
            raise RuntimeError(f"Unable to check bucket '{target_bucket}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to check bucket '{target_bucket}': {exc}") from exc

    def _next_step_after_target_setup(self, migration: BucketMigration, item: BucketMigrationItem) -> str:
        if migration.lock_target_writes and not item.target_lock_applied:
            return "apply_target_lock"
        if migration.mode == "pre_sync" and not item.pre_sync_done:
            return "pre_sync"
        return "apply_read_only"

    def _is_bucket_already_exists_error(self, exc: Exception) -> bool:
        text = str(exc).strip().lower()
        return any(
            marker in text
            for marker in (
                "bucketalreadyexists",
                "bucketalreadyownedbyyou",
                "bucket already exists",
                "already owned by you",
            )
        )

    def _is_access_denied_error(self, exc: Exception) -> bool:
        text = str(exc).strip().lower()
        return "accessdenied" in text or "access denied" in text or "403" in text
