# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Callable, Iterable

from app.models.bucket_filter import BucketFilterQuery, BucketFilterRule
from app.models.execution_context import ExecutionContext
from app.models.storage_ops import StorageOpsBucketSummary, StorageOpsContextKind
from app.services.connection_identity_service import ConnectionIdentityService
from app.services.listing_progress import ListingProgressEmitter, interpolate_progress_percent
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_ops_bucket_filtering import match_storage_ops_field_rule
from app.utils.cancellation import invoke_cancel_check
from app.utils.rgw_identifiers import rgw_tenant_or_default
from app.utils.normalize import normalize_optional_string


CONTEXT_IDENTITY_FIELDS = {"context_id", "context_name", "context_kind", "endpoint_name"}


@dataclass(frozen=True)
class StorageOpsContextRef:
    context_id: str
    context_name: str
    context_kind: StorageOpsContextKind
    endpoint_id: int | None
    endpoint_name: str | None


@dataclass(frozen=True)
class StorageOpsResolvedContext:
    ref: StorageOpsContextRef
    context: S3ExecutionContext


@dataclass(frozen=True)
class StorageOpsContextOwner:
    owner: str | None
    tenant: str | None = None


def build_storage_ops_bucket_identity(
    endpoint_id: int | None,
    tenant: str | None,
    bucket_name: str,
) -> str | None:
    if endpoint_id is None or endpoint_id <= 0:
        return None
    name = normalize_optional_string(bucket_name)
    if not name:
        return None
    return json.dumps(
        [endpoint_id, normalize_optional_string(tenant) or "", name],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def build_storage_ops_context_refs(
    contexts: Iterable[ExecutionContext],
) -> list[StorageOpsContextRef]:
    refs: list[StorageOpsContextRef] = []
    seen: set[str] = set()
    for context in contexts:
        if context.kind not in {"account", "connection", "s3_user"}:
            continue
        if context.id in seen:
            continue
        seen.add(context.id)
        context_kind: StorageOpsContextKind
        if context.kind == "s3_user":
            context_kind = "s3_user"
        else:
            context_kind = context.kind
        refs.append(
            StorageOpsContextRef(
                context_id=context.id,
                context_name=context.display_name,
                context_kind=context_kind,
                endpoint_id=context.endpoint_id,
                endpoint_name=context.endpoint_name,
            )
        )
    return refs


def _context_probe_bucket(ref: StorageOpsContextRef) -> StorageOpsBucketSummary:
    return StorageOpsBucketSummary(
        name="",
        bucket_name="",
        tenant=None,
        owner=None,
        owner_name=None,
        context_id=ref.context_id,
        context_name=ref.context_name,
        context_kind=ref.context_kind,
        endpoint_id=ref.endpoint_id,
        endpoint_name=ref.endpoint_name,
        bucket_identity=None,
    )


def _context_prefilter_rules(
    parsed_filter: BucketFilterQuery | None,
) -> tuple[list[BucketFilterRule], str] | None:
    if not parsed_filter or not parsed_filter.rules:
        return None
    context_rules = [
        rule
        for rule in parsed_filter.rules
        if rule.field in CONTEXT_IDENTITY_FIELDS
    ]
    if not context_rules:
        return None
    if parsed_filter.match == "any" and any(
        (rule.field and rule.field not in CONTEXT_IDENTITY_FIELDS) or rule.feature
        for rule in parsed_filter.rules
    ):
        return None
    return context_rules, parsed_filter.match


def _context_ref_matches_rules(
    ref: StorageOpsContextRef,
    rules: list[BucketFilterRule],
    *,
    match_mode: str,
) -> bool:
    probe = _context_probe_bucket(ref)
    matches = (match_storage_ops_field_rule(probe, rule) for rule in rules)
    return all(matches) if match_mode == "all" else any(matches)


def filter_storage_ops_context_refs_by_advanced_filter(
    refs: list[StorageOpsContextRef],
    parsed_filter: BucketFilterQuery | None,
) -> list[StorageOpsContextRef]:
    if not refs:
        return refs
    prefilter = _context_prefilter_rules(parsed_filter)
    if prefilter is None:
        return refs
    context_rules, match_mode = prefilter
    return [
        ref
        for ref in refs
        if _context_ref_matches_rules(
            ref,
            context_rules,
            match_mode=match_mode,
        )
    ]


def resolve_storage_ops_contexts(
    *,
    refs: list[StorageOpsContextRef],
    resolve_context: Callable[[StorageOpsContextRef], S3ExecutionContext | None],
    progress: ListingProgressEmitter | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> list[StorageOpsResolvedContext]:
    resolved: list[StorageOpsResolvedContext] = []
    total = len(refs)
    for index, ref in enumerate(refs, start=1):
        invoke_cancel_check(cancel_check)
        context = resolve_context(ref)
        if context is not None:
            resolved.append(StorageOpsResolvedContext(ref=ref, context=context))
        if progress is not None:
            progress.emit(
                percent=interpolate_progress_percent(15, 25, processed=index, total=total),
                stage="resolve_contexts",
                processed=index,
                total=total,
                message="Resolving Storage Ops contexts",
            )
        invoke_cancel_check(cancel_check)
    return resolved


def resolve_storage_ops_context_owner(context: S3ExecutionContext) -> StorageOpsContextOwner:
    account_id = normalize_optional_string(context.rgw_account_id)
    if account_id:
        return StorageOpsContextOwner(
            owner=account_id,
            tenant=rgw_tenant_or_default(context.rgw_tenant),
        )
    user_uid = normalize_optional_string(context.rgw_user_uid)
    if user_uid:
        return StorageOpsContextOwner(
            owner=user_uid,
            tenant=rgw_tenant_or_default(context.rgw_tenant),
        )
    source_connection = context.source_connection
    if source_connection is None:
        return StorageOpsContextOwner(owner=None)
    resolution = ConnectionIdentityService().resolve_rgw_identity(source_connection)
    if resolution.rgw_user_uid:
        return StorageOpsContextOwner(
            owner=resolution.rgw_user_uid,
            tenant=resolution.rgw_tenant,
        )
    return StorageOpsContextOwner(owner=resolution.rgw_account_id)


def resolve_storage_ops_context_tenant(context: S3ExecutionContext) -> str:
    """Return the normalized tenant used in the physical bucket identity."""
    return normalize_optional_string(resolve_storage_ops_context_owner(context).tenant) or ""
