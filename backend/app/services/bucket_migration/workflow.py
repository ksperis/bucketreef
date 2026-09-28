# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Public workflow decisions, shared by commands and response mappers."""
from __future__ import annotations

from datetime import timedelta

from app.utils.time import utcnow

PRECHECK_MAX_AGE = timedelta(minutes=15)
ACTIVE_STATUSES = {"queued", "running", "pause_requested", "cancel_requested"}


def preparation_is_current(migration) -> bool:
    return bool(
        migration.preparation_status == "ready"
        and migration.checked_revision == migration.configuration_revision
        and migration.precheck_checked_at
        and migration.precheck_checked_at >= utcnow() - PRECHECK_MAX_AGE
    )


def preparation_state(migration) -> str:
    if migration.preparation_status == "ready" and not preparation_is_current(
        migration
    ):
        return "stale"
    return migration.preparation_status or "unverified"


def available_actions(migration) -> dict[str, dict]:
    items = migration.items
    busy = (
        migration.status in ACTIVE_STATUSES
        or migration.preparation_status == "checking"
        or migration.maintenance_status in {"queued", "running"}
    )
    recovery = any(item.preparation_effects_json for item in items)
    modern = migration.workflow_version == 2
    draft = migration.status == "draft"
    results = migration.status in {
        "completed",
        "completed_with_errors",
        "failed",
        "canceled",
        "rolled_back",
    }
    remaining = [item for item in items if not item.source_deleted]
    rules = {
        "edit": (
            modern and draft and not busy and not recovery,
            "Finish checks and restore temporary changes before editing.",
        ),
        "precheck": (
            modern and draft and not busy and not recovery,
            "Checks are available for an idle draft after recovery.",
        ),
        "start": (
            modern
            and draft
            and not busy
            and not recovery
            and preparation_is_current(migration),
            "Run and pass active checks for the current configuration (valid for 15 minutes).",
        ),
        "pause": (
            modern and migration.status in {"running", "queued"},
            "Copy is not running.",
        ),
        "resume": (
            modern and migration.status == "paused" and not busy and not recovery,
            "Pause the copy before resuming.",
        ),
        "cutover": (
            modern
            and migration.status == "awaiting_cutover"
            and not busy
            and not recovery
            and not migration.failed_items,
            "Finish or retry all failed buckets before cutover.",
        ),
        "stop": (
            modern
            and migration.status in {*ACTIVE_STATUSES, "paused", "awaiting_cutover"}
            and migration.maintenance_status not in {"queued", "running"},
            "There is no active transfer to stop.",
        ),
        "retry": (
            modern
            and results
            and not busy
            and not recovery
            and any(item.status == "failed" for item in items),
            "There are no failed buckets available to retry.",
        ),
        "restore_access": (
            not busy
            and bool(
                recovery
                or any(
                    item.read_only_applied or item.target_lock_applied for item in items
                )
            ),
            "No access protection needs restoration.",
        ),
        "cleanup_source": (
            modern
            and results
            and not busy
            and not recovery
            and bool(remaining)
            and all(
                item.status == "completed" and item.read_only_applied
                for item in remaining
            ),
            "All remaining sources must have a verified copy and remain read-only.",
        ),
        "cleanup_target": (
            modern
            and results
            and not busy
            and not recovery
            and any(
                item.status == "failed" and item.target_created_by_migration
                for item in items
            ),
            "Only incomplete destinations created by this migration can be cleaned up.",
        ),
        "delete": (
            not busy
            and (draft or results)
            and not recovery
            and not any(
                item.read_only_applied or item.target_lock_applied for item in items
            ),
            "Restore remaining access protections before deleting this record.",
        ),
    }
    return {
        name: {"enabled": bool(enabled), "reason": None if enabled else reason}
        for name, (enabled, reason) in rules.items()
    }


def require_action(migration, action: str) -> None:
    decision = available_actions(migration)[action]
    if not decision["enabled"]:
        raise ValueError(decision["reason"])
