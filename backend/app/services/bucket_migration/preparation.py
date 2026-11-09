# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Durable preparation jobs. Preparing a draft never queues a transfer."""
from __future__ import annotations

from datetime import timedelta
from contextlib import nullcontext
from typing import Callable

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import or_, select, update

from app.core.db_transactions import run_db_unit_with_sqlite_retry
from app.core.sensitive_data import sanitized_error_log_detail
from app.db import BucketMigration, BucketMigrationItem
from app.services.managed_resource_naming import (
    MIGRATION_PROBE_OBJECT_KEY,
    migration_probe_bucket_name,
)
from app.services.s3_client import S3OperationError
from app.services.s3_deletion import BucketNotEmptyError
from app.utils.time import utcnow
from .diagnostics import (
    MigrationCopyGrantError,
    MigrationPrecheckError,
    MigrationRecoveryError,
    MigrationSettingsCopyError,
)
from .execution_signals import WorkerLeaseLostError
from .precheck_reporting import create_precheck_report
from .workflow import require_action


class BucketMigrationPreparationMixin:
    def request_precheck(self, migration_id: int, *, active_checks: bool = False):
        migration = self.get_migration(migration_id)
        self._assert_migration_creator_access(migration)
        require_action(migration, "precheck")
        requested_at = utcnow()

        def mutate(current: BucketMigration) -> None:
            current.preparation_active_checks = active_checks
            current.preparation_completed_items = 0
            current.preparation_requested_at = requested_at
            current.precheck_report = None
            current.precheck_checked_at = None
            current.worker_lease_owner = None
            current.worker_lease_until = None
            current.error_message = None
            current.updated_at = requested_at
            self._add_event(
                current,
                level="info",
                message=(
                    "Active checks queued."
                    if active_checks
                    else "Read-only checks queued."
                ),
            )

        return self._persist_transition_command(
            migration,
            values={"preparation_status": "checking"},
            mutate=mutate,
        )

    def claim_next_preparation_id(self, *, worker_id: str, lease_seconds: int):
        now = utcnow()
        eligible = (
            BucketMigration.status == "draft",
            BucketMigration.preparation_status == "checking",
            or_(
                BucketMigration.worker_lease_until.is_(None),
                BucketMigration.worker_lease_until < now,
            ),
        )
        candidates = self.db.scalars(
            select(BucketMigration.id)
            .where(*eligible)
            .order_by(BucketMigration.preparation_requested_at)
            .limit(50)
        ).all()
        for migration_id in candidates:
            def claim_once() -> int:
                changed = self.db.execute(
                    update(BucketMigration)
                    .where(BucketMigration.id == migration_id, *eligible)
                    .values(
                        {
                            BucketMigration.worker_lease_owner: worker_id,
                            BucketMigration.worker_lease_until: now
                            + timedelta(seconds=max(15, lease_seconds)),
                            BucketMigration.updated_at: now,
                        }
                    )
                    .execution_options(synchronize_session=False)
                ).rowcount
                self._commit()
                return int(changed or 0)

            changed = run_db_unit_with_sqlite_retry(self.db, claim_once)
            if changed:
                return migration_id
        return None

    def _build_preparation_checkpoint(
        self,
        migration: BucketMigration,
        *,
        migration_id: int,
        revision: int,
        worker_id: str | None,
    ) -> Callable[[dict | None], None]:
        def checkpoint(report: dict | None = None) -> None:
            report_snapshot = dict(report) if report is not None else None

            def checkpoint_once() -> None:
                current = self.get_migration(migration_id)
                self._assert_workflow_lease()
                if current.configuration_revision != revision or (
                    worker_id and current.worker_lease_owner != worker_id
                ):
                    raise WorkerLeaseLostError(
                        "Preparation configuration or lease changed"
                    )
                self._assert_migration_creator_access(current)
                if report_snapshot is not None:
                    current.precheck_report = dict(report_snapshot)
                    current.preparation_completed_items = len(
                        report_snapshot.get("items", [])
                    )
                current.updated_at = utcnow()
                self._commit()

            run_db_unit_with_sqlite_retry(self.db, checkpoint_once)

        return checkpoint

    def run_precheck(
        self,
        migration_id: int,
        *,
        active_checks: bool | None = None,
        worker_id: str | None = None,
    ):
        migration = self.get_migration(migration_id)
        if migration.status != "draft" or migration.workflow_version != 2:
            raise ValueError("Only a current draft can be checked")
        self._bind_workflow_lease(migration_id, worker_id)
        revision = migration.configuration_revision
        if active_checks is None:
            active_checks = migration.preparation_active_checks
        self._preparation_active_checks = active_checks
        migration.preparation_status = "checking"
        migration.preparation_active_checks = active_checks
        migration.preparation_completed_items = 0
        checked_at = utcnow()
        checkpoint = self._build_preparation_checkpoint(
            migration,
            migration_id=migration_id,
            revision=revision,
            worker_id=worker_id,
        )

        self._preparation_checkpoint = checkpoint
        try:
            checkpoint()
            self._recover_preparation_effects(migration)
            report = self._precheck_planner.run(
                migration, checked_at=checked_at, on_progress=checkpoint
            )
            checkpoint()
            if any(item.preparation_effects for item in migration.items):
                raise RuntimeError(
                    "Temporary changes could not be restored. Restore access before checking again."
                )
            migration = self._complete_precheck_report(
                migration,
                report,
                revision=revision,
                active_checks=active_checks,
            )
        except WorkerLeaseLostError:
            self.db.rollback()
            raise
        except Exception as exc:  # Recovery information remains durable after failures.
            self.db.rollback()
            migration = self._record_precheck_failure(
                migration_id,
                exc,
                worker_id=worker_id,
                checked_at=checked_at,
                revision=revision,
            )
        finally:
            self._preparation_checkpoint = None
            self._preparation_item = None
        migration = self._release_preparation_lease(
            migration_id,
            worker_id=worker_id,
        )
        return migration

    def _complete_precheck_report(
        self,
        migration,
        report: dict,
        *,
        revision: int,
        active_checks: bool,
    ):
        migration_id = int(migration.id)
        report_snapshot = dict(report)

        def complete_once():
            current = self.get_migration(migration_id)
            report_value = dict(report_snapshot)
            report_value["configuration_revision"] = revision
            report_value["active_checks"] = active_checks
            report_value["status"] = (
                "failed"
                if report_value.get("errors")
                else "passed" if active_checks else "pending"
            )
            current.precheck_report = report_value
            current.preparation_status = (
                "blocked"
                if report_value.get("errors")
                else "ready" if active_checks else "unverified"
            )
            current.precheck_checked_at = utcnow()
            current.error_message = None
            self._add_event(
                current,
                level="info",
                message="Preparation checks completed.",
                metadata={
                    "revision": revision,
                    "errors": report_value.get("errors", 0),
                    "active_checks": active_checks,
                },
            )
            self._commit()
            return current

        return run_db_unit_with_sqlite_retry(self.db, complete_once)

    def _record_precheck_failure(
        self,
        migration_id: int,
        exc: Exception,
        *,
        worker_id: str | None,
        checked_at,
        revision: int,
    ):
        error_message = sanitized_error_log_detail(exc)

        def record_once():
            migration = self.get_migration(migration_id)
            if worker_id and migration.worker_lease_owner != worker_id:
                raise WorkerLeaseLostError("Preparation lease lost") from exc
            migration.preparation_status = "blocked"
            migration.error_message = error_message
            report = dict(
                migration.precheck_report
                or create_precheck_report(checked_at=checked_at)
            )
            report.update(
                status="failed",
                errors=max(1, int(report.get("errors", 0))),
                configuration_revision=revision,
            )
            report["checks"] = [
                {
                    "code": "preparation_interrupted",
                    "severity": "error",
                    "blocking": True,
                    "scope": "migration",
                    "message": error_message,
                    "impact": None,
                    "remediation": "Restore access if required, then run checks again.",
                    "permission": None,
                    "context_id": None,
                    "bucket": None,
                    "details": None,
                }
            ]
            migration.precheck_report = report
            self._commit()
            return migration

        return run_db_unit_with_sqlite_retry(self.db, record_once)

    def _release_preparation_lease(
        self,
        migration_id: int,
        *,
        worker_id: str | None,
    ):
        def release_once():
            migration = self.get_migration(migration_id)
            if worker_id and migration.worker_lease_owner != worker_id:
                raise WorkerLeaseLostError("Preparation lease lost")
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.updated_at = utcnow()
            self._commit()
            return migration

        return run_db_unit_with_sqlite_retry(self.db, release_once)

    def _journal_preparation_effect(self, item, name: str, payload: dict) -> None:
        self._assert_workflow_lease()
        checkpoint = self._preparation_checkpoint
        if checkpoint:
            checkpoint()
        item_id = int(item.id)
        payload_snapshot = dict(payload)

        def journal_once() -> None:
            self._assert_workflow_lease()
            current = self.db.get(BucketMigrationItem, item_id)
            if current is None:
                raise RuntimeError("Migration preparation item disappeared")
            effects = dict(current.preparation_effects or {})
            if name in effects:
                raise RuntimeError(
                    "An earlier temporary change needs restoration before another test"
                )
            effects[name] = dict(payload_snapshot)
            current.preparation_effects = effects
            current.updated_at = utcnow()
            self._commit()

        run_db_unit_with_sqlite_retry(self.db, journal_once)

    def _clear_preparation_effect(self, item, name: str) -> None:
        item_id = int(item.id)

        def clear_once() -> None:
            self._assert_workflow_lease()
            current = self.db.get(BucketMigrationItem, item_id)
            if current is None:
                raise RuntimeError("Migration preparation item disappeared")
            effects = dict(current.preparation_effects or {})
            effects.pop(name, None)
            current.preparation_effects = effects or None
            current.updated_at = utcnow()
            self._commit()

        run_db_unit_with_sqlite_retry(self.db, clear_once)

    def _recover_preparation_effects(self, migration) -> None:
        for item in migration.items:
            effects = dict(item.preparation_effects or {})
            for name, effect in effects.items():
                self._assert_workflow_lease()
                context = self._resolve_context(effect["context_id"])
                bucket = effect["bucket"]
                if name == "probe_bucket":
                    self._cleanup_destination_probe_bucket(
                        context,
                        bucket,
                        policy_tested=bool(effect.get("policy_tested")),
                    )
                else:
                    self._restore_checked_policy(
                        context.execution_context, bucket, effect.get("policy")
                    )
                self._clear_preparation_effect(item, name)

    def _restore_checked_policy(self, account, bucket: str, policy) -> None:
        self._assert_workflow_lease()
        try:
            if isinstance(policy, dict):
                self._configuration.put_policy(bucket, account, policy)
            else:
                self._configuration.delete_policy(bucket, account)
            restored = self._configuration.get_policy(bucket, account)
        except S3OperationError as exc:
            raise MigrationRecoveryError(
                f"Unable to restore bucket policy for '{bucket}': "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc
        if (restored or None) != (policy or None):
            raise MigrationRecoveryError(
                f"Policy restoration could not be verified for bucket '{bucket}'"
            )

    def _cleanup_destination_probe_bucket(
        self,
        target_ctx,
        probe: str,
        *,
        policy_tested: bool,
    ) -> None:
        self._assert_workflow_lease()
        try:
            exists = self._precheck_bucket_exists(target_ctx, probe)
            if exists is None:
                raise MigrationRecoveryError(
                    "Unable to establish whether the temporary probe bucket still exists"
                )
            if exists:
                if policy_tested:
                    self._configuration.delete_policy(
                        probe, target_ctx.execution_context
                    )
                self._buckets.delete_bucket(
                    probe, target_ctx.execution_context, force=True
                )
            if self._precheck_bucket_exists(target_ctx, probe) is not False:
                raise MigrationRecoveryError(
                    "Temporary bucket removal could not be verified"
                )
        except MigrationRecoveryError:
            raise
        except (MigrationPrecheckError, S3OperationError, BucketNotEmptyError) as exc:
            raise MigrationRecoveryError(
                f"Unable to clean temporary destination bucket '{probe}': "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc

    def _probe_destination_object_access(self, client, probe: str) -> dict[str, str]:
        key = MIGRATION_PROBE_OBJECT_KEY
        response = client.put_object(
            Bucket=probe, Key=key, Body=b"migration permission check"
        )
        identity = {"Bucket": probe, "Key": key}
        if response.get("VersionId"):
            identity["VersionId"] = response["VersionId"]
        client.put_object_tagging(
            **identity,
            Tagging={"TagSet": [{"Key": "check", "Value": "permission"}]},
        )
        client.get_object_tagging(**identity)
        body = client.get_object(**identity).get("Body")
        if body is None:
            raise MigrationPrecheckError(
                "Destination content could not be read for verification"
            )
        try:
            body.read(1)
        finally:
            body.close()
        return identity

    def _probe_destination_multipart_access(self, client, probe: str) -> None:
        upload = client.create_multipart_upload(Bucket=probe, Key="multipart-check")
        try:
            part = client.upload_part(
                Bucket=probe,
                Key="multipart-check",
                UploadId=upload["UploadId"],
                PartNumber=1,
                Body=b"check",
            )
            client.complete_multipart_upload(
                Bucket=probe,
                Key="multipart-check",
                UploadId=upload["UploadId"],
                MultipartUpload={
                    "Parts": [{"PartNumber": 1, "ETag": part["ETag"]}]
                },
            )
        except Exception:
            client.abort_multipart_upload(
                Bucket=probe,
                Key="multipart-check",
                UploadId=upload["UploadId"],
            )
            raise

        abort_probe = client.create_multipart_upload(Bucket=probe, Key="abort-check")
        client.abort_multipart_upload(
            Bucket=probe,
            Key="abort-check",
            UploadId=abort_probe["UploadId"],
        )

    def _probe_same_endpoint_copy(
        self,
        migration,
        item,
        source_ctx,
        target_ctx,
        client,
        probe: str,
        *,
        source_profile: Optional[dict[str, Any]] = None,
    ) -> None:
        page = self._context_client(source_ctx).list_objects_v2(
            Bucket=item.source_bucket, MaxKeys=1
        )
        contents = page.get("Contents") or []
        candidate = self._sample_version_probe_candidate(
            source_profile=source_profile
        )
        copy_source = {"Bucket": item.source_bucket}
        if candidate:
            copy_source.update(Key=candidate[0], VersionId=candidate[1])
        elif contents:
            copy_source["Key"] = contents[0]["Key"]
        else:
            raise MigrationPrecheckError(
                "No source object is available to validate storage-side copy. Use Copy via BucketReef."
            )
        grant = (
            self._temporary_source_copy_grant(
                source_ctx,
                target_ctx,
                source_bucket=item.source_bucket,
                sample_key=copy_source["Key"],
                sample_version_id=copy_source.get("VersionId"),
            )
            if migration.auto_grant_source_read_for_copy
            else nullcontext()
        )
        with grant:
            client.copy_object(Bucket=probe, Key="copy-check", CopySource=copy_source)

    def _precheck_destination(
        self,
        migration,
        item,
        source_ctx,
        target_ctx,
        *,
        source_profile: Optional[dict[str, Any]] = None,
        strategy: str,
    ) -> None:
        probe = migration_probe_bucket_name(migration.id)
        policy_tested = bool(
            migration.lock_target_writes or migration.copy_bucket_settings
        )
        self._journal_preparation_effect(
            item,
            "probe_bucket",
            {
                "context_id": target_ctx.context_id,
                "bucket": probe,
                "policy_tested": policy_tested,
            },
        )
        error = None
        try:
            self._run_destination_probe(
                migration,
                item,
                source_ctx,
                target_ctx,
                probe=probe,
                source_profile=source_profile,
                strategy=strategy,
            )
        except Exception as exc:  # Cleanup must run for any probe failure.
            error = exc
        try:
            self._cleanup_destination_probe_bucket(
                target_ctx,
                probe,
                policy_tested=policy_tested,
            )
            self._clear_preparation_effect(item, "probe_bucket")
        except MigrationRecoveryError as cleanup_error:
            raise MigrationRecoveryError(
                f"Temporary destination cleanup requires recovery: {cleanup_error}"
            ) from error
        if error:
            if isinstance(error, MigrationPrecheckError):
                raise error
            if isinstance(
                error,
                (
                    MigrationCopyGrantError,
                    MigrationSettingsCopyError,
                    S3OperationError,
                    ClientError,
                    BotoCoreError,
                ),
            ):
                raise MigrationPrecheckError(
                    sanitized_error_log_detail(error)
                ) from error
            raise error

    def _run_destination_probe(
        self,
        migration,
        item,
        source_ctx,
        target_ctx,
        *,
        probe: str,
        source_profile: Optional[dict[str, Any]],
        strategy: str,
    ) -> None:
        self._buckets.create_bucket(
            probe,
            target_ctx.execution_context,
            versioning=strategy == "version_aware",
            location_constraint=target_ctx.region,
            object_lock_enabled=False,
        )
        if migration.copy_bucket_settings:
            self._copy_bucket_settings(
                source_ctx.execution_context,
                item.source_bucket,
                target_ctx.execution_context,
                probe,
                migration,
                item,
                strategy=strategy,
            )
        if migration.lock_target_writes:
            policy = self._configuration.get_policy(
                probe,
                target_ctx.execution_context,
            )
            self._configuration.put_policy(
                probe,
                target_ctx.execution_context,
                self._build_target_write_lock_policy(probe, policy),
            )

        client = self._context_client(target_ctx)
        identity = self._probe_destination_object_access(client, probe)
        self._probe_destination_multipart_access(client, probe)
        if migration.use_same_endpoint_copy:
            self._probe_same_endpoint_copy(
                migration,
                item,
                source_ctx,
                target_ctx,
                client,
                probe,
                source_profile=source_profile,
            )
        self._remove_destination_probe_objects(
            client,
            probe,
            identity,
            version_aware=strategy == "version_aware",
        )

    @staticmethod
    def _remove_destination_probe_objects(
        client,
        probe: str,
        identity: dict[str, Any],
        *,
        version_aware: bool,
    ) -> None:
        client.delete_object(**identity)
        if not version_aware:
            return
        marker = client.delete_object(Bucket=probe, Key=MIGRATION_PROBE_OBJECT_KEY)
        if not marker.get("VersionId"):
            raise MigrationPrecheckError(
                "Destination did not create the expected versioned delete marker"
            )
        client.delete_object(
            Bucket=probe,
            Key=MIGRATION_PROBE_OBJECT_KEY,
            VersionId=marker["VersionId"],
        )

    def _revalidate_transfer_preconditions(self, migration, *, items=None) -> None:
        self._assert_migration_creator_access(migration)
        self._assert_cross_account_admin_contexts(
            migration.source_context_id, migration.target_context_id
        )
        if migration.workflow_version != 2:
            raise ValueError(
                "Historical migrations cannot be replayed. Prepare a new migration."
            )
        source = self._resolve_context(migration.source_context_id)
        target = self._resolve_context(migration.target_context_id)
        for item in items if items is not None else migration.items:
            if item.status == "completed":
                continue
            if item.preparation_effects:
                raise ValueError("Restore temporary changes before continuing")
            self._revalidate_source_transfer_preconditions(migration, source, item)
            self._revalidate_destination_transfer_preconditions(target, item)

    def _revalidate_source_transfer_preconditions(self, migration, source, item) -> None:
        try:
            self._precheck_can_list_bucket(source, item.source_bucket)
            current = self._inspector.inspect_bucket_state(
                source,
                item.source_bucket,
                probe_policy=self._inspector.build_probe_policy(
                    copy_bucket_settings=migration.copy_bucket_settings
                ),
                scan_versions=False,
            )
            previous = dict(item.source_snapshot or {})
            for feature in ("versioning", "object_lock", "encryption"):
                if previous.get(feature) != current.get(feature):
                    raise ValueError(
                        f"Source {feature.replace('_', ' ')} changed since preparation. Prepare a new migration before continuing."
                    )
            if any(
                value.get("state") == "unavailable"
                for value in current.get("feature_availability", {}).values()
            ):
                raise ValueError(
                    "A required source feature cannot be verified. Restore access before continuing."
                )
            if migration.copy_bucket_settings and current.get("unsupported_settings"):
                raise ValueError(
                    "The source now has unsupported settings. Prepare a new migration with compatible settings."
                )
            if self._item_execution_strategy(item) == "version_aware":
                self._precheck_version_aware_source_access(
                    source, item.source_bucket, previous
                )
        except PermissionError:
            raise
        except (MigrationPrecheckError, S3OperationError, ValueError) as exc:
            raise ValueError(
                f"Source '{item.source_bucket}' needs attention: {sanitized_error_log_detail(exc)}"
            ) from exc

    def _revalidate_destination_transfer_preconditions(self, target, item) -> None:
        exists = self._precheck_bucket_exists(target, item.target_bucket)
        if exists is None or (exists and not item.target_created_by_migration):
            raise ValueError(
                f"Destination '{item.target_bucket}' is unavailable or already exists. Check its name and permissions."
            )
        if item.target_created_by_migration and not exists:
            raise ValueError(
                f"Destination '{item.target_bucket}' created by this migration is missing. It cannot be resumed safely."
            )
