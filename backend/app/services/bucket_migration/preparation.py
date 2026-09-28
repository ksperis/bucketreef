# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Durable preparation jobs. Preparing a draft never queues a transfer."""
from __future__ import annotations

from datetime import timedelta
import uuid
from contextlib import nullcontext
from sqlalchemy import or_

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import BucketMigration
from app.utils.time import utcnow
from ._shared import _json_dumps, _json_loads, _WorkerLeaseLostError
from .workflow import require_action


class BucketMigrationPreparationMixin:
    def request_precheck(self, migration_id: int, *, active_checks: bool = False):
        migration = self.get_migration(migration_id)
        self._assert_migration_creator_access(migration)
        require_action(migration, "precheck")
        self._transition_command(migration, preparation_status="checking")
        migration.preparation_active_checks = active_checks
        migration.preparation_completed_items = 0
        migration.preparation_requested_at = utcnow()
        migration.checked_revision = None
        migration.precheck_status = "pending"
        migration.precheck_report_json = None
        migration.precheck_checked_at = None
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.error_message = None
        migration.updated_at = utcnow()
        self._add_event(
            migration,
            level="info",
            message=(
                "Active checks queued." if active_checks else "Read-only checks queued."
            ),
        )
        self._commit()
        return migration

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
        candidates = (
            self.db.query(BucketMigration.id)
            .filter(*eligible)
            .order_by(BucketMigration.preparation_requested_at)
            .limit(50)
            .all()
        )
        for (migration_id,) in candidates:
            changed = (
                self.db.query(BucketMigration)
                .filter(BucketMigration.id == migration_id, *eligible)
                .update(
                    {
                        BucketMigration.worker_lease_owner: worker_id,
                        BucketMigration.worker_lease_until: now
                        + timedelta(seconds=max(15, lease_seconds)),
                        BucketMigration.updated_at: now,
                    },
                    synchronize_session=False,
                )
            )
            self._commit()
            if changed:
                return migration_id
        return None

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
            active_checks = bool(migration.preparation_active_checks)
        self._preparation_active_checks = active_checks
        migration.preparation_status = "checking"
        migration.preparation_active_checks = active_checks
        migration.checked_revision = None
        migration.precheck_status = "pending"
        migration.preparation_completed_items = 0
        checked_at = utcnow()

        def checkpoint(report=None):
            self._assert_workflow_lease()
            row = (
                self.db.query(
                    BucketMigration.configuration_revision,
                    BucketMigration.worker_lease_owner,
                )
                .filter(BucketMigration.id == migration_id)
                .one()
            )
            if row.configuration_revision != revision or (
                worker_id and row.worker_lease_owner != worker_id
            ):
                raise _WorkerLeaseLostError(
                    "Preparation configuration or lease changed"
                )
            self._assert_migration_creator_access(migration)
            if report is not None:
                migration.precheck_report_json = _json_dumps(report)
                migration.preparation_completed_items = len(report.get("items", []))
            migration.updated_at = utcnow()
            self._commit()

        self._preparation_checkpoint = checkpoint
        try:
            checkpoint()
            self._recover_preparation_effects(migration)
            report = self._precheck_planner.run(
                migration, checked_at=checked_at, on_progress=checkpoint
            )
            checkpoint()
            if any(item.preparation_effects_json for item in migration.items):
                raise RuntimeError(
                    "Temporary changes could not be restored. Restore access before checking again."
                )
            report["configuration_revision"] = revision
            report["active_checks"] = active_checks
            report["status"] = (
                "failed"
                if report.get("errors")
                else "passed" if active_checks else "pending"
            )
            migration.precheck_report_json = _json_dumps(report)
            migration.precheck_status = report["status"]
            migration.preparation_status = (
                "blocked"
                if report.get("errors")
                else "ready" if active_checks else "unverified"
            )
            migration.checked_revision = (
                revision if migration.preparation_status == "ready" else None
            )
            migration.precheck_checked_at = utcnow()
            migration.error_message = None
            self._add_event(
                migration,
                level="info",
                message="Preparation checks completed.",
                metadata={
                    "revision": revision,
                    "errors": report.get("errors", 0),
                    "active_checks": active_checks,
                },
            )
        except _WorkerLeaseLostError:
            self.db.rollback()
            raise
        except Exception as exc:  # Recovery information remains durable after failures.
            self.db.rollback()
            migration = self.get_migration(migration_id)
            if worker_id and migration.worker_lease_owner != worker_id:
                raise _WorkerLeaseLostError("Preparation lease lost") from exc
            migration.preparation_status = "blocked"
            migration.precheck_status = "failed"
            migration.checked_revision = None
            migration.error_message = sanitized_error_log_detail(exc)
            report = _json_loads(migration.precheck_report_json) or {"items": []}
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
                    "message": migration.error_message,
                    "remediation": "Restore access if required, then run checks again.",
                }
            ]
            migration.precheck_report_json = _json_dumps(report)
        finally:
            self._preparation_checkpoint = None
            self._preparation_item = None
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        self._commit()
        return migration

    def _journal_preparation_effect(self, item, name: str, payload: dict) -> None:
        self._assert_workflow_lease()
        checkpoint = getattr(self, "_preparation_checkpoint", None)
        if checkpoint:
            checkpoint()
        effects = _json_loads(item.preparation_effects_json) or {}
        if name in effects:
            raise RuntimeError(
                "An earlier temporary change needs restoration before another test"
            )
        effects[name] = payload
        item.preparation_effects_json = _json_dumps(effects)
        item.updated_at = utcnow()
        self._commit()

    def _clear_preparation_effect(self, item, name: str) -> None:
        self._assert_workflow_lease()
        effects = _json_loads(item.preparation_effects_json) or {}
        effects.pop(name, None)
        item.preparation_effects_json = _json_dumps(effects) if effects else None
        item.updated_at = utcnow()
        self._commit()

    def _recover_preparation_effects(self, migration) -> None:
        for item in migration.items:
            effects = _json_loads(item.preparation_effects_json) or {}
            for name, effect in effects.items():
                self._assert_workflow_lease()
                context = self._resolve_context(effect["context_id"])
                bucket = effect["bucket"]
                if name == "probe_bucket":
                    exists = self._precheck_bucket_exists(context, bucket)
                    if exists is None:
                        raise RuntimeError(
                            "Unable to establish whether the temporary probe bucket still exists"
                        )
                    if exists:
                        if effect.get("policy_tested"):
                            self._configuration.delete_policy(bucket, context.account)
                        self._buckets.delete_bucket(bucket, context.account, force=True)
                    if self._precheck_bucket_exists(context, bucket) is not False:
                        raise RuntimeError(
                            "Temporary bucket removal could not be verified"
                        )
                else:
                    self._restore_checked_policy(
                        context.account, bucket, effect.get("policy")
                    )
                self._clear_preparation_effect(item, name)

    def _restore_checked_policy(self, account, bucket: str, policy) -> None:
        self._assert_workflow_lease()
        if isinstance(policy, dict):
            self._configuration.put_policy(bucket, account, policy)
        else:
            self._configuration.delete_policy(bucket, account)
        restored = self._configuration.get_policy(bucket, account)
        if (restored or None) != (policy or None):
            raise RuntimeError(
                f"Policy restoration could not be verified for bucket '{bucket}'"
            )

    def _precheck_destination(
        self, migration, item, source_ctx, target_ctx, *, strategy: str
    ) -> None:
        probe = f"bucketreef-mig-precheck-{migration.id}-{uuid.uuid4().hex[:12]}"
        self._journal_preparation_effect(
            item,
            "probe_bucket",
            {
                "context_id": target_ctx.context_id,
                "bucket": probe,
                "policy_tested": bool(
                    migration.lock_target_writes or migration.copy_bucket_settings
                ),
            },
        )
        error = None
        try:
            self._buckets.create_bucket(
                probe,
                target_ctx.account,
                versioning=strategy == "version_aware",
                location_constraint=target_ctx.region,
                object_lock_enabled=False,
            )
            if migration.copy_bucket_settings:
                self._copy_bucket_settings(
                    source_ctx.account,
                    item.source_bucket,
                    target_ctx.account,
                    probe,
                    migration,
                    item,
                    strategy=strategy,
                )
            if migration.lock_target_writes:
                policy = self._configuration.get_policy(probe, target_ctx.account)
                self._configuration.put_policy(
                    probe,
                    target_ctx.account,
                    self._build_target_write_lock_policy(probe, policy),
                )
            client = self._context_client(target_ctx)
            key = "__bucketreef-check"
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
                raise RuntimeError(
                    "Destination content could not be read for verification"
                )
            try:
                body.read(1)
            finally:
                body.close()
            # Streaming large objects needs multipart permissions as well as PutObject.
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
                    Bucket=probe, Key="multipart-check", UploadId=upload["UploadId"]
                )
                raise
            abort_probe = client.create_multipart_upload(
                Bucket=probe, Key="abort-check"
            )
            client.abort_multipart_upload(
                Bucket=probe, Key="abort-check", UploadId=abort_probe["UploadId"]
            )
            if migration.use_same_endpoint_copy:
                page = self._context_client(source_ctx).list_objects_v2(
                    Bucket=item.source_bucket, MaxKeys=1
                )
                contents = page.get("Contents") or []
                candidate = self._sample_version_probe_candidate(
                    source_profile=_json_loads(item.source_snapshot_json)
                )
                copy_source = {"Bucket": item.source_bucket}
                if candidate:
                    copy_source.update(Key=candidate[0], VersionId=candidate[1])
                elif contents:
                    copy_source["Key"] = contents[0]["Key"]
                else:
                    raise RuntimeError(
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
                    client.copy_object(
                        Bucket=probe, Key="copy-check", CopySource=copy_source
                    )
            client.delete_object(**identity)
            if strategy == "version_aware":
                marker = client.delete_object(Bucket=probe, Key=key)
                if not marker.get("VersionId"):
                    raise RuntimeError(
                        "Destination did not create the expected versioned delete marker"
                    )
                client.delete_object(
                    Bucket=probe, Key=key, VersionId=marker["VersionId"]
                )
        except Exception as exc:
            error = exc
        try:
            self._assert_workflow_lease()
            exists = self._precheck_bucket_exists(target_ctx, probe)
            if exists is None:
                raise RuntimeError("Temporary bucket existence is unknown")
            if exists:
                if migration.lock_target_writes or migration.copy_bucket_settings:
                    self._configuration.delete_policy(probe, target_ctx.account)
                self._buckets.delete_bucket(probe, target_ctx.account, force=True)
            if self._precheck_bucket_exists(target_ctx, probe) is not False:
                raise RuntimeError("Temporary bucket removal could not be verified")
            self._clear_preparation_effect(item, "probe_bucket")
        except Exception as cleanup_error:
            raise RuntimeError(
                f"Temporary destination cleanup requires recovery: {cleanup_error}"
            ) from error
        if error:
            raise error

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
            if item.preparation_effects_json:
                raise ValueError("Restore temporary changes before continuing")
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
                previous = _json_loads(item.source_snapshot_json) or {}
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
                if migration.copy_bucket_settings and current.get(
                    "unsupported_settings"
                ):
                    raise ValueError(
                        "The source now has unsupported settings. Prepare a new migration with compatible settings."
                    )
                if self._item_execution_strategy(item) == "version_aware":
                    self._precheck_version_aware_source_access(
                        source, item.source_bucket, previous
                    )
            except PermissionError:
                raise
            except Exception as exc:
                raise ValueError(
                    f"Source '{item.source_bucket}' needs attention: {sanitized_error_log_detail(exc)}"
                ) from exc
            exists = self._precheck_bucket_exists(target, item.target_bucket)
            if exists is None or (exists and not item.target_created_by_migration):
                raise ValueError(
                    f"Destination '{item.target_bucket}' is unavailable or already exists. Check its name and permissions."
                )
            if item.target_created_by_migration and not exists:
                raise ValueError(
                    f"Destination '{item.target_bucket}' created by this migration is missing. It cannot be resumed safely."
                )
