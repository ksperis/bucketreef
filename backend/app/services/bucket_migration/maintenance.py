# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Explicit recovery and cleanup commands, independent of transfer outcomes."""
from __future__ import annotations

import hashlib
from app.core.sensitive_data import sanitized_error_log_detail
from app.utils.time import utcnow
from app.services.s3_deletion import purge_bucket_contents
from app.services.bucket_ui_tags_service import (
    BucketUiTagsService,
    PhysicalBucketTarget,
)
from app.services.storage_ops_bucket_listing_service import (
    resolve_storage_ops_context_tenant,
)
from ._shared import (
    _json_dumps,
    _json_loads,
    _WorkerLeaseLostError,
    _MIGRATION_USER_AGENT_MARKER,
)
from .workflow import require_action


class BucketMigrationMaintenanceMixin:
    def request_maintenance(
        self,
        migration_id: int,
        *,
        operation: str,
        confirmed: bool,
        requested_by_user_id: int | None = None,
    ):
        if operation not in {"restore_access", "cleanup_source", "cleanup_target"}:
            raise ValueError("Unknown recovery operation")
        migration = self.get_migration(migration_id)
        operator_id = requested_by_user_id or migration.created_by_user_id
        if not {
            migration.source_context_id,
            migration.target_context_id,
        } <= self._actor_allowed_context_ids(operator_id):
            raise PermissionError("Recovery requires access to both execution contexts")
        require_action(migration, operation)
        if not confirmed:
            raise ValueError("Review the impacts and confirm this operation")
        self._transition_command(
            migration, maintenance_status="queued", maintenance_operation=operation
        )
        migration.maintenance_requested_by_user_id = operator_id
        migration.maintenance_error = None
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        self._add_event(
            migration, level="info", message=f"Recovery operation queued: {operation}."
        )
        self._commit()
        return migration

    def run_maintenance(
        self, migration_id: int, *, worker_id=None, lease_seconds=60
    ) -> None:
        migration = self.get_migration(migration_id)
        if worker_id and migration.worker_lease_owner != worker_id:
            return
        self._bind_workflow_lease(migration_id, worker_id)
        self._assert_migration_creator_access(migration)
        migration.maintenance_status = "running"
        migration.updated_at = utcnow()
        self._commit()

        def check():
            self._assert_workflow_lease()
            self.db.refresh(migration)
            self._assert_migration_creator_access(migration)
            if (
                self._control_state(
                    migration.id, worker_id=worker_id, lease_seconds=lease_seconds
                )
                == "lost_lease"
            ):
                raise _WorkerLeaseLostError("Recovery lease lost")
            return "run"

        errors = []
        try:
            check()
            source = self._resolve_context(migration.source_context_id)
            target = self._resolve_context(migration.target_context_id)
            if migration.maintenance_operation == "restore_access":
                self._recover_preparation_effects(migration)
                errors.extend(
                    self._release_source_read_only_policies(
                        migration, source, verify_restored=True
                    )
                )
                errors.extend(
                    self._release_target_write_locks(
                        migration, target, verify_restored=True
                    )
                )
                for item in migration.items:
                    if not item.source_deleted:
                        item.cleanup_verification_json = None
                    elif not item.target_lock_applied:
                        # Deletion succeeded; only restoration had failed. A
                        # successful recovery resolves that separate outcome.
                        item.cleanup_status = "completed"
                        item.cleanup_error = None
                if migration.status == "draft":
                    migration.preparation_status = "stale"
                    migration.checked_revision = None
            else:
                for item in migration.items:
                    selected = (
                        (item.status == "completed" and not item.source_deleted)
                        if migration.maintenance_operation == "cleanup_source"
                        else (
                            item.status == "failed" and item.target_created_by_migration
                        )
                    )
                    if not selected:
                        continue
                    try:
                        check()
                        if migration.maintenance_operation == "cleanup_source":
                            self._cleanup_verified_source(
                                migration, item, source, target, check
                            )
                        else:
                            self._precheck_can_list_bucket(source, item.source_bucket)
                            if self._item_execution_strategy(item) == "version_aware":
                                self._precheck_version_aware_source_access(
                                    source,
                                    item.source_bucket,
                                    _json_loads(item.source_snapshot_json),
                                )
                            if not item.target_lock_applied:
                                self._apply_target_write_lock_policy(
                                    target, item.target_bucket, item
                                )
                            item.cleanup_status = "deleting"
                            item.cleanup_error = None
                            self._commit()
                            self._delete_maintenance_bucket(
                                target, item.target_bucket, check
                            )
                            if (
                                self._precheck_bucket_exists(target, item.target_bucket)
                                is not False
                            ):
                                raise RuntimeError(
                                    "Destination removal could not be verified"
                                )
                            self._remove_deleted_bucket_ui_tags(
                                target, item.target_bucket
                            )
                            item.target_created_by_migration = False
                            item.target_lock_applied = False
                            item.target_policy_backup_json = None
                            item.replication_state_json = None
                            item.pre_sync_done = False
                            item.step = "create_bucket"
                        item.cleanup_status = "completed"
                        item.cleanup_error = None
                    except _WorkerLeaseLostError:
                        raise
                    except Exception as exc:
                        self.db.rollback()
                        item.cleanup_status = "failed"
                        item.cleanup_error = sanitized_error_log_detail(exc)
                        errors.append(f"{item.source_bucket}: {item.cleanup_error}")
                    self._assert_workflow_lease()
                    item.updated_at = utcnow()
                    self._commit()
        except _WorkerLeaseLostError:
            self.db.rollback()
            return
        except Exception as exc:
            self.db.rollback()
            errors.append(sanitized_error_log_detail(exc))
        # Recovery helpers retain their errors for the operator; they must not
        # let an expired worker publish over a replacement worker's operation.
        self._assert_workflow_lease()
        migration.maintenance_status = "failed" if errors else "completed"
        migration.maintenance_error = " | ".join(errors[:5]) if errors else None
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        self._add_event(
            migration,
            level="warning" if errors else "info",
            message=(
                "Recovery operation needs attention."
                if errors
                else "Recovery operation completed."
            ),
            metadata={"operation": migration.maintenance_operation},
        )
        self._commit()

    def _cleanup_fingerprint(
        self, context, bucket: str, *, strategy: str, check
    ) -> str:
        """Hash exact keys, ordered history, markers, tags and streamed SHA-256 content."""
        digest = hashlib.sha256()
        client = self._context_client(context)
        if strategy == "version_aware":
            entries = (
                entry
                for _key, timeline in self._iter_bucket_version_timelines(
                    context, bucket, client=client
                )
                for entry in timeline
            )
        else:
            entries = self._iter_bucket_objects(context, bucket, client=client)
        for entry in entries:
            check()
            marker = bool(getattr(entry, "is_delete_marker", False))
            value = {"key": entry.key, "delete_marker": marker}
            if not marker:
                version_id = getattr(entry, "version_id", None)
                identity = {"Bucket": bucket, "Key": entry.key}
                if version_id:
                    identity["VersionId"] = version_id
                tags = client.get_object_tagging(**identity).get("TagSet")
                if not isinstance(tags, list) or any(
                    not isinstance(tag, dict)
                    or not isinstance(tag.get("Key"), str)
                    or not isinstance(tag.get("Value"), str)
                    for tag in tags
                ):
                    raise RuntimeError("Object tags could not be verified")
                value["tags"] = sorted((tag["Key"], tag["Value"]) for tag in tags)
                value["sha256"] = self._stream_object_sha256(
                    client,
                    bucket,
                    entry.key,
                    version_id=version_id,
                    control_check=check,
                )
            encoded = _json_dumps(value).encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
        check()
        return digest.hexdigest()

    def _delete_maintenance_bucket(self, context, bucket: str, check) -> None:
        # The migration client carries the policy's worker marker; generic bucket
        # deletion clients are deliberately denied while cleanup is in progress.
        client = self._context_client(context)
        check()
        result = purge_bucket_contents(
            client,
            bucket,
            include_versions=True,
            parallelism=1,
            cancel_check=check,
            tolerate_missing_bucket=True,
        )
        if result.failed_count:
            raise RuntimeError(
                "Bucket cleanup did not remove every object/version. Retry cleanup after correcting permissions."
            )
        check()
        if not result.missing_bucket:
            client.delete_bucket(Bucket=bucket)
        if self._precheck_bucket_exists(context, bucket) is not False:
            raise RuntimeError("Bucket removal could not be verified")

    def _remove_deleted_bucket_ui_tags(self, context, bucket: str) -> None:
        endpoint_id = int(context.account.storage_endpoint_id or 0)
        if endpoint_id > 0:
            BucketUiTagsService(self.db).remove_all_namespaces_for_bucket(
                PhysicalBucketTarget.create(
                    endpoint_id,
                    resolve_storage_ops_context_tenant(context.account),
                    bucket,
                )
            )

    def _cleanup_verified_source(self, migration, item, source, target, check) -> None:
        if not item.target_created_by_migration:
            raise RuntimeError(
                "Destination provenance is missing; source deletion is blocked"
            )
        # Deletion always verifies the complete history, even if the original
        # transfer only needed current objects. Newly enabled versioning cannot
        # hide extra source versions from the cleanup check.
        strategy = "version_aware"
        receipt = _json_loads(item.cleanup_verification_json)
        # Reapply both protections on every attempt, preserving their original backups.
        if not item.target_lock_applied:
            self._apply_target_write_lock_policy(target, item.target_bucket, item)
        else:
            self._configuration.put_policy(
                item.target_bucket,
                target.account,
                self._build_target_write_lock_policy(
                    item.target_bucket, _json_loads(item.target_policy_backup_json)
                ),
            )
        target_hash = self._cleanup_fingerprint(
            target, item.target_bucket, strategy=strategy, check=check
        )
        if receipt:
            if receipt.get("target_sha256") != target_hash:
                raise RuntimeError(
                    "Verified destination changed since deletion began. Source cleanup is blocked."
                )
        else:
            item.cleanup_status = "verifying"
            self._commit()
            self._apply_read_only_policy(source.account, item.source_bucket, item)
            source_hash = self._cleanup_fingerprint(
                source, item.source_bucket, strategy=strategy, check=check
            )
            if source_hash != target_hash:
                raise RuntimeError(
                    "Fresh SHA-256 verification found different contents, tags or version history. The source is retained."
                )
            item.cleanup_verification_json = _json_dumps(
                {"target_sha256": target_hash, "verified_at": utcnow().isoformat()}
            )
            item.cleanup_status = "deleting"
            self._commit()
        check()
        source_exists = self._precheck_bucket_exists(source, item.source_bucket)
        if source_exists is None:
            raise RuntimeError("Source existence could not be verified")
        if source_exists:
            policy = self._build_read_only_policy(
                item.source_bucket, _json_loads(item.source_policy_backup_json)
            )
            deny = policy["Statement"][-1]
            deletes = [
                action for action in deny["Action"] if action.startswith("s3:Delete")
            ]
            deny["Action"] = [
                action for action in deny["Action"] if action not in deletes
            ]
            policy["Statement"].append(
                {
                    **deny,
                    "Sid": "BucketReefCleanupDeleteProtection",
                    "Action": deletes,
                    "Condition": {
                        "StringNotLike": {
                            "aws:UserAgent": f"*{_MIGRATION_USER_AGENT_MARKER}*"
                        }
                    },
                }
            )
            if receipt:
                current_policy = self._configuration.get_policy(
                    item.source_bucket, source.account
                )
                if current_policy != policy:
                    raise RuntimeError(
                        "Source protection changed after deletion began. Restore access and review the remaining source before proceeding."
                    )
            self._configuration.put_policy(item.source_bucket, source.account, policy)
            check()
            self._delete_maintenance_bucket(source, item.source_bucket, check)
        if self._precheck_bucket_exists(source, item.source_bucket) is not False:
            raise RuntimeError("Source removal could not be verified")
        self._remove_deleted_bucket_ui_tags(source, item.source_bucket)
        item.source_deleted = True
        item.read_only_applied = False
        item.source_policy_backup_json = None
        self._commit()
        self._restore_checked_policy(
            target.account,
            item.target_bucket,
            _json_loads(item.target_policy_backup_json),
        )
        item.target_lock_applied = False
        item.target_policy_backup_json = None
