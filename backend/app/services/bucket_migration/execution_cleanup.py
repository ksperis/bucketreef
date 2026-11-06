# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from botocore.exceptions import BotoCoreError, ClientError

from app.services.app_settings_service import load_app_settings_for_db
from app.services.s3_deletion import purge_bucket_contents
from .execution_runtime import ResolvedContext

class BucketMigrationCleanupMixin:
    def _purge_target_bucket_for_replay(
        self,
        target_ctx: ResolvedContext,
        target_bucket: str,
    ) -> tuple[int, int]:
        client = self._context_client(target_ctx)
        try:
            manager_settings = load_app_settings_for_db(self.db).manager
            result = purge_bucket_contents(
                client,
                target_bucket,
                parallelism=manager_settings.bucket_migration_parallelism_max,
                include_versions=True,
                tolerate_missing_bucket=True,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to purge target bucket '{target_bucket}' before replay: {exc}"
            ) from exc
        if result.failed_count > 0:
            sample = ", ".join(failure.message for failure in result.failures_sample[:3])
            extra = f" (+{result.failed_count - len(result.failures_sample[:3])} more)" if result.failed_count > 3 else ""
            raise RuntimeError(
                f"Unable to purge target bucket '{target_bucket}' before replay: {sample}{extra}"
            )
        return result.deleted_objects, result.deleted_versions
