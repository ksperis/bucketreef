# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import BucketMigration, BucketMigrationItem
from app.models.bucket import BucketPublicAccessBlockUpdate
from app.services.s3_execution_context import S3ExecutionTarget

if TYPE_CHECKING:
    from .execution_item_runner import BucketMigrationItemRunnerMixin


@dataclass(frozen=True)
class _SettingCopyOperation:
    name: str
    failure_message: str
    action: Callable[[], None]


class _BucketSettingsCopyRunner:
    def __init__(
        self,
        *,
        service: BucketMigrationItemRunnerMixin,
        source_execution_context: S3ExecutionTarget,
        source_bucket: str,
        target_execution_context: S3ExecutionTarget,
        target_bucket: str,
        migration: BucketMigration,
        item: BucketMigrationItem,
        strategy: str | None = None,
    ) -> None:
        self.service = service
        self.source_execution_context = source_execution_context
        self.source_bucket = source_bucket
        self.target_execution_context = target_execution_context
        self.target_bucket = target_bucket
        self.migration = migration
        self.item = item
        self.strategy = strategy or service._item_execution_strategy(item)

    def run(self) -> None:
        failures: list[str] = []
        for operation in self._operations():
            self.service._assert_workflow_lease()
            try:
                operation.action()
            except Exception as exc:  # noqa: BLE001
                error_detail = sanitized_error_log_detail(exc)
                failures.append(f"{operation.name}: {error_detail}")
                self.service._add_event(
                    self.migration,
                    item=self.item,
                    level="error",
                    message=operation.failure_message,
                    metadata={"error": error_detail, "setting": operation.name},
                )

        if failures:
            raise RuntimeError(
                "Bucket settings copy failed for supported settings: "
                + "; ".join(failures[:8])
            )
        self.service._add_event(
            self.migration,
            item=self.item,
            level="info",
            message="Bucket settings copied.",
        )

    def _operations(self) -> tuple[_SettingCopyOperation, ...]:
        return (
            _SettingCopyOperation(
                "versioning",
                "Versioning copy failed.",
                self._copy_versioning,
            ),
            _SettingCopyOperation(
                "object_lock",
                "Object lock copy failed.",
                self._copy_object_lock,
            ),
            _SettingCopyOperation(
                "encryption",
                "Default bucket encryption copy failed.",
                self._copy_encryption,
            ),
            _SettingCopyOperation(
                "public_access_block",
                "Public access block copy failed.",
                self._copy_public_access_block,
            ),
            _SettingCopyOperation(
                "lifecycle",
                "Lifecycle copy failed.",
                self._copy_lifecycle,
            ),
            _SettingCopyOperation("cors", "CORS copy failed.", self._copy_cors),
            _SettingCopyOperation(
                "bucket_policy",
                "Policy copy failed.",
                self._copy_policy,
            ),
            _SettingCopyOperation("tags", "Tags copy failed.", self._copy_tags),
            _SettingCopyOperation(
                "access_logging",
                "Access logging copy failed.",
                self._copy_access_logging,
            ),
        )

    def _copy_versioning(self) -> None:
        if self.strategy == "version_aware":
            enabled = True
        else:
            properties = self.service._configuration.get_bucket_properties(
                self.source_bucket,
                self.source_execution_context,
            )
            enabled = str(properties.versioning_status or "").strip().lower() == "enabled"
        self.service._configuration.set_versioning(
            self.target_bucket,
            self.target_execution_context,
            enabled=enabled,
        )

    def _copy_object_lock(self) -> None:
        object_lock = self.service._configuration.get_bucket_object_lock(
            self.source_bucket,
            self.source_execution_context,
        )
        if object_lock and (
            object_lock.enabled is not None
            or object_lock.mode is not None
            or object_lock.days is not None
            or object_lock.years is not None
        ):
            self.service._configuration.set_object_lock(
                self.target_bucket,
                self.target_execution_context,
                object_lock,
            )

    def _copy_encryption(self) -> None:
        encryption = self.service._configuration.get_bucket_encryption(
            self.source_bucket,
            self.source_execution_context,
        )
        rules = list(encryption.rules or [])
        if rules:
            self.service._configuration.set_bucket_encryption(
                self.target_bucket,
                self.target_execution_context,
                rules,
            )
        else:
            self.service._configuration.delete_bucket_encryption(
                self.target_bucket,
                self.target_execution_context,
            )

    def _copy_public_access_block(self) -> None:
        public_access_block = self.service._configuration.get_public_access_block(
            self.source_bucket,
            self.source_execution_context,
        )
        self.service._configuration.set_public_access_block(
            self.target_bucket,
            self.target_execution_context,
            BucketPublicAccessBlockUpdate(
                block_public_acls=bool(public_access_block.block_public_acls),
                ignore_public_acls=bool(public_access_block.ignore_public_acls),
                block_public_policy=bool(public_access_block.block_public_policy),
                restrict_public_buckets=bool(public_access_block.restrict_public_buckets),
            ),
        )

    def _copy_lifecycle(self) -> None:
        lifecycle = self.service._configuration.get_lifecycle(
            self.source_bucket,
            self.source_execution_context,
        )
        rules = lifecycle.rules or []
        if rules:
            self.service._configuration.set_lifecycle(
                self.target_bucket,
                self.target_execution_context,
                rules,
            )
        else:
            self.service._configuration.delete_lifecycle(
                self.target_bucket,
                self.target_execution_context,
            )

    def _copy_cors(self) -> None:
        cors = self.service._configuration.get_bucket_cors(
            self.source_bucket,
            self.source_execution_context,
        )
        if cors:
            self.service._configuration.set_cors(
                self.target_bucket,
                self.target_execution_context,
                cors,
            )
        else:
            self.service._configuration.delete_cors(
                self.target_bucket,
                self.target_execution_context,
            )

    def _copy_policy(self) -> None:
        policy = self.service._configuration.get_policy(
            self.source_bucket,
            self.source_execution_context,
        )
        if policy:
            self.service._configuration.put_policy(
                self.target_bucket,
                self.target_execution_context,
                policy,
            )
        else:
            self.service._configuration.delete_policy(
                self.target_bucket,
                self.target_execution_context,
            )

    def _copy_tags(self) -> None:
        tags = self.service._configuration.get_bucket_tags(
            self.source_bucket,
            self.source_execution_context,
        )
        if tags:
            self.service._configuration.set_bucket_tags(
                self.target_bucket,
                self.target_execution_context,
                [{"key": tag.key, "value": tag.value} for tag in tags],
            )
        else:
            self.service._configuration.delete_bucket_tags(
                self.target_bucket,
                self.target_execution_context,
            )

    def _copy_access_logging(self) -> None:
        logging = self.service._configuration.get_bucket_logging(
            self.source_bucket,
            self.source_execution_context,
        )
        self.service._configuration.set_bucket_logging(
            self.target_bucket,
            self.target_execution_context,
            logging,
        )
