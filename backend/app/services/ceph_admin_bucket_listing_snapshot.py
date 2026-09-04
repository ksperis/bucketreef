# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Callable

from app.models.bucket_filter import BucketFilterRule
from app.models.bucket_listing import BucketListingSummary
from app.services import rgw_bucket_metadata
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.bucket_feature_param_matching import match_bucket_feature_param_rules
from app.services.bucket_feature_param_snapshot_loader import (
    bucket_identity_key,
    load_bucket_feature_param_snapshots,
)
from app.services.bucket_listing_enrichment import enrich_buckets
from app.services.bucket_listing_owner_metadata import (
    apply_owner_enrichment,
    backfill_bucket_owner_metadata,
    determine_owner_name_lookup_scope,
    resolve_owner_names_for_buckets,
)
from app.services.bucket_listing_rule_matching import (
    extract_name_candidates,
    match_bucket_feature_rule,
    match_bucket_field_rule,
)
from app.services.bucket_owner_enrichment import BucketOwnerUsage, compute_bucket_owner_usage
from app.services.ceph_admin_bucket_listing_cache import (
    CephAdminBucketListingSnapshot,
    get_cached_rgw_bucket_entries,
)
from app.services.ceph_admin_bucket_listing_context import CephAdminBucketListingContext
from app.services.ceph_admin_bucket_listing_request import (
    CephAdminAdvancedFilterPlan,
    CephAdminBucketListingRequest,
)
from app.services.listing_progress import ListingProgressEmitter, invoke_cancel_check
from app.services.rgw_admin import RGWAdminError
from app.services.s3_execution_context import S3ExecutionContext, build_ceph_admin_s3_context
from app.utils.http_errors import is_upstream_timeout

logger = logging.getLogger(__name__)

_BUCKET_STATS_UNAVAILABLE_WARNING = (
    "Bucket stats are unavailable via Ceph Admin credentials on this endpoint. "
    "Showing owner metadata without usage or quota values."
)


class RequiredBucketStatsUnavailableError(RuntimeError):
    """Raised when a listing contract requires unavailable RGW bucket statistics."""


@dataclass(frozen=True)
class _LoadedBucketEntries:
    entries: list[dict]
    effective_with_stats: bool
    stats_available: bool
    stats_warning: str | None


class CephAdminBucketSnapshotBuilder:
    """Build the shared RGW snapshot independently of actor-specific UI tags."""

    def __init__(
        self,
        *,
        ctx: CephAdminBucketListingContext,
        request: CephAdminBucketListingRequest,
        progress: ListingProgressEmitter,
        cancel_check: Callable[[], None] | None,
    ) -> None:
        self.ctx = ctx
        self.request = request
        self.progress = progress
        self.cancel_check = cancel_check

    def build(self) -> CephAdminBucketListingSnapshot:
        invoke_cancel_check(self.cancel_check)
        loaded = self._load_entries()
        results = self._build_summaries(loaded)
        results = self._backfill_owner_metadata(results)
        owner_usage_by_key = (
            compute_bucket_owner_usage(results)
            if loaded.effective_with_stats and results
            else None
        )
        results = self._apply_advanced_filter(results, owner_usage_by_key)
        invoke_cancel_check(self.cancel_check)
        results = self._sort_results(results)
        return CephAdminBucketListingSnapshot(
            items=results,
            stats_available=loaded.stats_available,
            stats_warning=loaded.stats_warning,
            owner_usage_by_key=owner_usage_by_key,
        )

    def _load_entries(self) -> _LoadedBucketEntries:
        name_candidates = (
            None
            if self.request.owner_usage_required
            else extract_name_candidates(self.request.advanced_filter)
        )
        try:
            entries = self._fetch_entries(self.request.with_stats, name_candidates)
        except RGWAdminError as exc:
            if not self.request.with_stats:
                raise
            if is_upstream_timeout(exc):
                raise
            if self.request.stats_required:
                raise RequiredBucketStatsUnavailableError(
                    "Bucket stats are unavailable via Ceph Admin credentials for this request"
                ) from exc
            logger.warning(
                "Ceph admin bucket listing stats fallback on endpoint=%s error=%s",
                getattr(getattr(self.ctx, "endpoint", None), "id", "unknown"),
                exc,
            )
            self.progress.emit(
                percent=12,
                stage="fetch_rgw_fallback",
                message="Bucket stats unavailable, retrying without stats",
                force=True,
            )
            entries = self._fetch_entries(False, name_candidates)
            return _LoadedBucketEntries(
                entries=entries,
                effective_with_stats=False,
                stats_available=False,
                stats_warning=_BUCKET_STATS_UNAVAILABLE_WARNING,
            )
        return _LoadedBucketEntries(
            entries=entries,
            effective_with_stats=self.request.with_stats,
            stats_available=True,
            stats_warning=None,
        )

    def _fetch_entries(
        self,
        request_with_stats: bool,
        name_candidates: list[str] | None,
    ) -> list[dict]:
        self.progress.emit(percent=10, stage="fetch_rgw", message="Loading buckets from RGW", force=True)
        if name_candidates is None:
            return get_cached_rgw_bucket_entries(self.ctx, with_stats=request_with_stats)
        if not name_candidates:
            return []
        allowed_names = set(name_candidates)
        return [
            entry
            for entry in get_cached_rgw_bucket_entries(self.ctx, with_stats=request_with_stats)
            if rgw_bucket_metadata.extract_bucket_name(entry) in allowed_names
        ]

    def _build_summaries(self, loaded: _LoadedBucketEntries) -> list[BucketListingSummary]:
        entries = loaded.entries
        self.progress.emit(
            percent=15,
            stage="fetch_rgw",
            processed=len(entries),
            total=len(entries),
            message="RGW bucket payload loaded",
            force=True,
        )
        results: list[BucketListingSummary] = []
        total_entries = len(entries)
        for index, entry in enumerate(entries, start=1):
            invoke_cancel_check(self.cancel_check)
            summary = rgw_bucket_metadata.build_bucket_summary(entry)
            if summary:
                if not loaded.effective_with_stats:
                    summary.used_bytes = None
                    summary.object_count = None
                    summary.quota_max_size_bytes = None
                    summary.quota_max_objects = None
                results.append(summary)
            percent = 15 + int((index / total_entries) * 45) if total_entries > 0 else 60
            self.progress.emit(
                percent=percent,
                stage="scan_entries",
                processed=index,
                total=total_entries,
                message="Scanning RGW bucket entries",
            )
        self.progress.emit(
            percent=60,
            stage="scan_entries",
            processed=total_entries,
            total=total_entries,
            message="Bucket scanning completed",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        return results

    def _backfill_owner_metadata(
        self,
        results: list[BucketListingSummary],
    ) -> list[BucketListingSummary]:
        if not self.request.needs_owner_metadata or not results:
            return results
        self.progress.emit(
            percent=63,
            stage="owner_backfill",
            processed=0,
            total=len(results),
            message="Loading bucket owner metadata",
            force=True,
        )
        return backfill_bucket_owner_metadata(
            self.ctx,
            results,
            include_tenant=self.request.needs_tenant_metadata,
            progress=self.progress,
            cancel_check=self.cancel_check,
            progress_stage="owner_backfill",
            progress_message="Loading bucket owner metadata",
            progress_start=63,
            progress_end=65,
        )

    def _apply_advanced_filter(
        self,
        results: list[BucketListingSummary],
        owner_usage_by_key: dict[str, BucketOwnerUsage] | None,
    ) -> list[BucketListingSummary]:
        if not self.request.advanced_filter or not self.request.advanced_filter.rules:
            self.progress.emit(
                percent=90,
                stage="expensive_filters",
                message="No expensive filters",
                force=True,
            )
            return results

        self.progress.emit(
            percent=65,
            stage="expensive_filters",
            message="Applying advanced filters",
            force=True,
        )
        plan = CephAdminAdvancedFilterPlan.from_query(self.request.advanced_filter)
        results = self._apply_cheap_field_rules(results, plan)
        if plan.has_expensive_rules:
            results = self._apply_expensive_rules(results, plan, owner_usage_by_key)
            self._clear_transient_enrichment(results)
        self.progress.emit(
            percent=90,
            stage="expensive_filters",
            message="Advanced filters applied",
            force=True,
        )
        return results

    @staticmethod
    def _apply_cheap_field_rules(
        results: list[BucketListingSummary],
        plan: CephAdminAdvancedFilterPlan,
    ) -> list[BucketListingSummary]:
        if not plan.cheap_field_rules:
            return results
        if plan.query.match == "all":
            return [
                bucket
                for bucket in results
                if all(match_bucket_field_rule(bucket, rule) for rule in plan.cheap_field_rules)
            ]
        if not plan.has_expensive_rules:
            return [
                bucket
                for bucket in results
                if any(match_bucket_field_rule(bucket, rule) for rule in plan.cheap_field_rules)
            ]
        return results

    def _apply_expensive_rules(
        self,
        results: list[BucketListingSummary],
        plan: CephAdminAdvancedFilterPlan,
        owner_usage_by_key: dict[str, BucketOwnerUsage] | None,
    ) -> list[BucketListingSummary]:
        field_matched: list[BucketListingSummary] = []
        candidates = results
        if not plan.feature_param_rules and plan.query.match == "any" and plan.cheap_field_rules:
            field_matched, candidates = self._partition_cheap_matches(results, plan.cheap_field_rules)

        service = BucketConfigurationService()
        account = build_ceph_admin_s3_context(self.ctx)
        candidates = self._enrich_expensive_candidates(
            candidates,
            plan,
            owner_usage_by_key,
            service,
            account,
        )
        if plan.feature_param_rules:
            return self._filter_feature_param_candidates(candidates, plan, service, account)

        matched = self._filter_nonparam_candidates(candidates, plan)
        return field_matched + matched

    @staticmethod
    def _partition_cheap_matches(
        results: list[BucketListingSummary],
        rules: list[BucketFilterRule],
    ) -> tuple[list[BucketListingSummary], list[BucketListingSummary]]:
        matched: list[BucketListingSummary] = []
        unresolved: list[BucketListingSummary] = []
        for bucket in results:
            target = matched if any(match_bucket_field_rule(bucket, rule) for rule in rules) else unresolved
            target.append(bucket)
        return matched, unresolved

    def _enrich_expensive_candidates(
        self,
        candidates: list[BucketListingSummary],
        plan: CephAdminAdvancedFilterPlan,
        owner_usage_by_key: dict[str, BucketOwnerUsage] | None,
        service: BucketConfigurationService,
        account: S3ExecutionContext,
    ) -> list[BucketListingSummary]:
        if plan.requires_owner_name_lookup and candidates:
            self._enrich_owner_names(candidates)
        if (
            plan.requires_owner_suspended_lookup
            or plan.requires_owner_quota_lookup
            or plan.requires_owner_usage_lookup
        ) and candidates:
            candidates = apply_owner_enrichment(
                self.ctx,
                candidates,
                include_suspended=plan.requires_owner_suspended_lookup,
                include_quota=plan.requires_owner_quota_lookup,
                include_usage=plan.requires_owner_usage_lookup,
                usage_by_key=owner_usage_by_key,
            )
        if not candidates or not (plan.filter_features or plan.requires_tag_lookup):
            return candidates

        progress_end = 82 if plan.feature_param_rules else 88
        self.progress.emit(
            percent=75,
            stage="bucket_enrichment",
            processed=0,
            total=len(candidates),
            message="Loading bucket details",
            force=True,
        )
        return enrich_buckets(
            candidates,
            {feature for feature in plan.filter_features if feature != "tags"},
            include_tags=plan.requires_tag_lookup or ("tags" in plan.filter_features),
            service=service,
            account=account,
            progress=self.progress,
            cancel_check=self.cancel_check,
            progress_stage="bucket_enrichment",
            progress_message="Loading bucket details",
            progress_start=75,
            progress_end=progress_end,
        )

    def _enrich_owner_names(self, candidates: list[BucketListingSummary]) -> None:
        owner_scope = determine_owner_name_lookup_scope(self.request.advanced_filter)
        owner_name_by_key = resolve_owner_names_for_buckets(
            self.ctx,
            candidates,
            owner_scope=owner_scope,
        )
        for bucket in candidates:
            if not bucket.owner:
                bucket.owner_name = None
                continue
            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
            bucket.owner_name = owner_name_by_key.get(owner_key)

    def _filter_feature_param_candidates(
        self,
        candidates: list[BucketListingSummary],
        plan: CephAdminAdvancedFilterPlan,
        service: BucketConfigurationService,
        account: S3ExecutionContext,
    ) -> list[BucketListingSummary]:
        if candidates:
            self.progress.emit(
                percent=82,
                stage="feature_param_enrichment",
                processed=0,
                total=len(candidates),
                message="Loading bucket feature parameters",
                force=True,
            )
        snapshots, available_keys = load_bucket_feature_param_snapshots(
            candidates,
            plan.feature_param_rules,
            service=service,
            account=account,
            progress=self.progress,
            cancel_check=self.cancel_check,
            progress_stage="feature_param_enrichment",
            progress_message="Loading bucket feature parameters",
            progress_start=82,
            progress_end=88,
        )
        return [
            bucket
            for bucket in candidates
            if self._matches_feature_param_candidate(bucket, plan, snapshots, available_keys)
        ]

    @staticmethod
    def _matches_feature_param_candidate(
        bucket: BucketListingSummary,
        plan: CephAdminAdvancedFilterPlan,
        snapshots: dict[str, dict[str, object]],
        available_keys: set[str],
    ) -> bool:
        bucket_key = bucket_identity_key(bucket)
        if bucket_key not in available_keys:
            return False
        snapshot = snapshots.get(bucket_key, {})
        if plan.query.match == "all":
            field_match = (
                all(match_bucket_field_rule(bucket, rule) for rule in plan.field_rules)
                if plan.field_rules
                else True
            )
            state_match = (
                all(match_bucket_feature_rule(bucket, rule) for rule in plan.feature_state_rules)
                if plan.feature_state_rules
                else True
            )
            return field_match and state_match and match_bucket_feature_param_rules(
                plan.feature_param_rules,
                plan.query.match,
                snapshot,
            )
        field_match = (
            any(match_bucket_field_rule(bucket, rule) for rule in plan.field_rules)
            if plan.field_rules
            else False
        )
        state_match = (
            any(match_bucket_feature_rule(bucket, rule) for rule in plan.feature_state_rules)
            if plan.feature_state_rules
            else False
        )
        return field_match or state_match or match_bucket_feature_param_rules(
            plan.feature_param_rules,
            plan.query.match,
            snapshot,
        )

    @staticmethod
    def _filter_nonparam_candidates(
        candidates: list[BucketListingSummary],
        plan: CephAdminAdvancedFilterPlan,
    ) -> list[BucketListingSummary]:
        if plan.query.match == "all":
            return [
                bucket
                for bucket in candidates
                if (
                    all(match_bucket_field_rule(bucket, rule) for rule in plan.expensive_field_rules)
                    if plan.expensive_field_rules
                    else True
                )
                and (
                    all(match_bucket_feature_rule(bucket, rule) for rule in plan.feature_state_rules)
                    if plan.feature_state_rules
                    else True
                )
            ]
        return [
            bucket
            for bucket in candidates
            if (
                any(match_bucket_field_rule(bucket, rule) for rule in plan.expensive_field_rules)
                if plan.expensive_field_rules
                else False
            )
            or (
                any(match_bucket_feature_rule(bucket, rule) for rule in plan.feature_state_rules)
                if plan.feature_state_rules
                else False
            )
        ]

    @staticmethod
    def _clear_transient_enrichment(results: list[BucketListingSummary]) -> None:
        for bucket in results:
            bucket.features = None
            bucket.tags = None
            bucket.column_details = None

    def _sort_value(self, bucket: BucketListingSummary) -> str | int:
        if self.request.sort_by == "tenant":
            value: str | int = bucket.tenant or ""
        elif self.request.sort_by == "owner":
            value = bucket.owner or ""
        elif self.request.sort_by == "used_bytes":
            value = bucket.used_bytes if bucket.used_bytes is not None else 0
        elif self.request.sort_by == "object_count":
            value = bucket.object_count if bucket.object_count is not None else 0
        else:
            value = bucket.name
        return value.lower() if isinstance(value, str) else value

    def _sort_results(
        self,
        results: list[BucketListingSummary],
    ) -> list[BucketListingSummary]:
        return sorted(results, key=self._sort_value, reverse=self.request.sort_dir == "desc")
