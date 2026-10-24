# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging

from app.core.sensitive_data import sanitized_error_log_detail
from app.services.s3_execution_context import S3ExecutionTarget
from app.services.s3_execution_client import s3_execution_request_kwargs
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services import bucket_feature_enrichment
from app.services import (
    s3_client,
    s3_deletion,
)
from app.services.rgw_principal_scope import resolve_target_admin_uid, resolve_target_tenant
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client
from app.models.bucket import Bucket
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.quota_stats import extract_quota_limits
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)


class BucketsService:
    def __init__(self, configuration: BucketConfigurationService | None = None) -> None:
        self.configuration = configuration or BucketConfigurationService()

    def _rgw_runtime_for_context(self, execution_context: S3ExecutionTarget):
        endpoint = execution_context.storage_endpoint
        if endpoint is None:
            raise RuntimeError("Runtime Read Ops credentials are not configured for this endpoint")
        try:
            return get_endpoint_runtime_rgw_client(endpoint)
        except ValueError as exc:
            raise RuntimeError(sanitized_error_log_detail(exc)) from exc
        except RGWAdminError as exc:
            raise RuntimeError(
                f"Unable to initialize admin client: {sanitized_error_log_detail(exc)}"
            ) from exc

    def _admin_bucket_list(
        self,
        execution_context: S3ExecutionTarget,
        with_stats: bool = True,
    ) -> list[dict]:
        uid = resolve_target_admin_uid(execution_context)
        if not uid:
            return []
        rgw_admin = self._rgw_runtime_for_context(execution_context)
        try:
            tenant = resolve_target_tenant(execution_context)
            payload = rgw_admin.get_all_buckets(
                uid=uid,
                with_stats=with_stats,
                **({"tenant": tenant} if tenant else {}),
            )
        except (RGWAdminError, ValueError) as exc:
            raise RuntimeError(
                f"Unable to list buckets via admin API: {sanitized_error_log_detail(exc)}"
            ) from exc
        return extract_bucket_list(payload)

    def _client_kwargs(self, execution_context: S3ExecutionTarget) -> dict:
        return s3_execution_request_kwargs(
            execution_context,
            error_message="S3ExecutionTarget is missing admin credentials",
        )

    @staticmethod
    def _context_label(execution_context: S3ExecutionTarget) -> str | int | None:
        return execution_context.rgw_account_id or execution_context.id

    def _admin_stats_by_bucket(
        self,
        execution_context: S3ExecutionTarget,
        *,
        with_stats: bool,
    ) -> dict[str, dict]:
        context_label = self._context_label(execution_context)
        if not with_stats:
            logger.debug(
                "S3 execution context %s skipped RGW admin stats enrichment",
                context_label,
            )
            return {}

        try:
            admin_list = self._admin_bucket_list(execution_context, with_stats=True)
        except RuntimeError as exc:
            logger.warning(
                "Unable to fetch admin bucket stats for %s: %s",
                context_label,
                exc,
            )
            return {}

        logger.debug(
            "S3 execution context %s fetched %s bucket stats via RGW admin",
            context_label,
            len(admin_list),
        )
        return {
            bucket_name: entry
            for entry in admin_list
            if isinstance(entry, dict)
            and (bucket_name := entry.get("bucket") or entry.get("name"))
        }

    @staticmethod
    def _usage_and_quota(
        stats: object,
    ) -> tuple[int | None, int | None, int | None, int | None]:
        usage = stats.get("usage") if isinstance(stats, dict) else None
        usage_bytes, object_count = extract_usage_stats(usage)
        quota_size, quota_objects = extract_quota_limits(
            stats if isinstance(stats, dict) else None,
            keys=("bucket_quota",),
        )
        return usage_bytes, object_count, quota_size, quota_objects

    @classmethod
    def _bucket_from_listing(
        cls,
        entry: object,
        admin_by_name: dict[str, dict],
    ) -> Bucket | None:
        if not isinstance(entry, dict):
            return None
        bucket_name = entry.get("name")
        if not bucket_name:
            return None

        usage_bytes, object_count, quota_size, quota_objects = cls._usage_and_quota(
            admin_by_name.get(bucket_name)
        )
        return Bucket(
            name=bucket_name,
            creation_date=entry.get("creation_date"),
            used_bytes=usage_bytes,
            object_count=object_count,
            quota_max_size_bytes=quota_size,
            quota_max_objects=quota_objects,
        )

    def list_buckets(
        self,
        execution_context: S3ExecutionTarget,
        include: set[str] | None = None,
        with_stats: bool = True,
    ) -> list[Bucket]:
        buckets = s3_client.list_buckets(**self._client_kwargs(execution_context))
        admin_by_name = self._admin_stats_by_bucket(
            execution_context,
            with_stats=with_stats,
        )
        logger.debug(
            "S3 execution context %s listed %s buckets",
            self._context_label(execution_context),
            len(buckets),
        )
        enriched = [
            bucket
            for entry in buckets
            if (bucket := self._bucket_from_listing(entry, admin_by_name)) is not None
        ]
        if not include:
            return enriched

        return bucket_feature_enrichment.enrich_bucket_features(
            self.configuration,
            enriched,
            execution_context,
            include,
        )

    def get_bucket_stats(
        self,
        bucket_name: str,
        execution_context: S3ExecutionTarget,
        with_stats: bool = True,
    ) -> Bucket:
        normalized_bucket = (bucket_name or "").strip()
        if not normalized_bucket:
            raise RuntimeError("Bucket name is required")

        buckets = s3_client.list_buckets(**self._client_kwargs(execution_context))
        creation_date = None
        bucket_in_scope = False
        for entry in buckets:
            if not isinstance(entry, dict):
                continue
            if entry.get("name") != normalized_bucket:
                continue
            bucket_in_scope = True
            creation_date = entry.get("creation_date")
            break

        stats = None

        if with_stats and bucket_in_scope:
            account_uid = resolve_target_admin_uid(execution_context)
            if account_uid:
                try:
                    rgw_admin = self._rgw_runtime_for_context(execution_context)
                    tenant = resolve_target_tenant(execution_context)
                    stats = rgw_admin.get_bucket_info(
                        normalized_bucket, uid=account_uid, allow_not_found=True,
                        **({"tenant": tenant} if tenant else {}),
                    )
                except (RuntimeError, RGWAdminError, ValueError) as exc:
                    logger.warning(
                        "Unable to fetch bucket stats for %s on %s: %s",
                        normalized_bucket,
                        self._context_label(execution_context),
                        exc,
                    )

        usage_bytes, object_count, quota_size, quota_objects = self._usage_and_quota(stats)
        return Bucket(
            name=normalized_bucket,
            creation_date=creation_date,
            used_bytes=usage_bytes,
            object_count=object_count,
            quota_max_size_bytes=quota_size,
            quota_max_objects=quota_objects,
        )

    def create_bucket(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        versioning: bool = False,
        location_constraint: str | None = None,
        object_lock_enabled: bool = False,
    ) -> None:
        s3_client.create_bucket(
            name,
            location_constraint=location_constraint,
            object_lock_enabled=object_lock_enabled,
            **self._client_kwargs(execution_context),
        )
        effective_versioning = bool(versioning or object_lock_enabled)
        if effective_versioning:
            s3_client.set_bucket_versioning(
                name,
                enabled=True,
                **self._client_kwargs(execution_context),
            )
        logger.debug(
            "S3 execution context %s created bucket %s (versioning=%s object_lock=%s location=%s)",
            self._context_label(execution_context),
            name,
            effective_versioning,
            object_lock_enabled,
            location_constraint,
        )

    def delete_bucket(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        force: bool = False,
    ) -> None:
        s3_deletion.delete_bucket(
            name, force=force, **self._client_kwargs(execution_context)
        )
        logger.debug(
            "S3 execution context %s deleted bucket %s force=%s",
            self._context_label(execution_context),
            name,
            force,
        )


def get_buckets_service() -> BucketsService:
    return BucketsService()
