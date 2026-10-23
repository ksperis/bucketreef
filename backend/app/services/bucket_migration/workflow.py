# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Public workflow decisions, shared by commands and response mappers."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from app.db import BucketMigration
from app.utils.time import utcnow

PRECHECK_MAX_AGE = timedelta(minutes=15)
ACTIVE_STATUSES = {"queued", "running", "pause_requested", "cancel_requested"}
_ActionRule = tuple[bool, str]


@dataclass(frozen=True)
class _WorkflowFacts:
    busy: bool
    recovery: bool
    modern: bool
    draft: bool
    results: bool
    has_failed_items: bool
    has_access_protection: bool
    remaining_sources_ready_for_cleanup: bool
    has_failed_created_targets: bool

    @classmethod
    def from_migration(cls, migration: BucketMigration) -> "_WorkflowFacts":
        items = list(migration.items)
        remaining = [item for item in items if not item.source_deleted]
        return cls(
            busy=(
                migration.status in ACTIVE_STATUSES
                or migration.preparation_status == "checking"
                or migration.maintenance_status in {"queued", "running"}
            ),
            recovery=any(item.preparation_effects_json for item in items),
            modern=migration.workflow_version == 2,
            draft=migration.status == "draft",
            results=migration.status
            in {
                "completed",
                "completed_with_errors",
                "failed",
                "canceled",
                "rolled_back",
            },
            has_failed_items=any(item.status == "failed" for item in items),
            has_access_protection=any(
                item.read_only_applied or item.target_lock_applied for item in items
            ),
            remaining_sources_ready_for_cleanup=bool(remaining)
            and all(
                item.status == "completed" and item.read_only_applied
                for item in remaining
            ),
            has_failed_created_targets=any(
                item.status == "failed" and item.target_created_by_migration
                for item in items
            ),
        )


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
    return migration.preparation_status


def _draft_action_rules(
    migration: BucketMigration,
    facts: _WorkflowFacts,
    *,
    idle: bool,
) -> dict[str, _ActionRule]:
    editable_draft = facts.modern and facts.draft and idle
    return {
        "edit": (
            editable_draft,
            "Finish checks and restore temporary changes before editing.",
        ),
        "precheck": (
            editable_draft,
            "Checks are available for an idle draft after recovery.",
        ),
        "start": (
            editable_draft and preparation_is_current(migration),
            "Run and pass active checks for the current configuration (valid for 15 minutes).",
        ),
    }


def _transfer_action_rules(
    migration: BucketMigration,
    facts: _WorkflowFacts,
    *,
    idle: bool,
) -> dict[str, _ActionRule]:
    return {
        "pause": (
            facts.modern and migration.status in {"running", "queued"},
            "Copy is not running.",
        ),
        "resume": (
            facts.modern and migration.status == "paused" and idle,
            "Pause the copy before resuming.",
        ),
        "cutover": (
            facts.modern
            and migration.status == "awaiting_cutover"
            and idle
            and not migration.failed_items,
            "Finish or retry all failed buckets before cutover.",
        ),
        "stop": (
            facts.modern
            and migration.status in {*ACTIVE_STATUSES, "paused", "awaiting_cutover"}
            and migration.maintenance_status not in {"queued", "running"},
            "There is no active transfer to stop.",
        ),
    }


def _result_action_rules(
    facts: _WorkflowFacts,
    *,
    idle: bool,
) -> dict[str, _ActionRule]:
    completed_workflow = facts.modern and facts.results and idle
    return {
        "retry": (
            completed_workflow and facts.has_failed_items,
            "There are no failed buckets available to retry.",
        ),
        "restore_access": (
            not facts.busy and (facts.recovery or facts.has_access_protection),
            "No access protection needs restoration.",
        ),
        "cleanup_source": (
            completed_workflow and facts.remaining_sources_ready_for_cleanup,
            "All remaining sources must have a verified copy and remain read-only.",
        ),
        "cleanup_target": (
            completed_workflow and facts.has_failed_created_targets,
            "Only incomplete destinations created by this migration can be cleaned up.",
        ),
        "delete": (
            idle
            and (facts.draft or facts.results)
            and not facts.has_access_protection,
            "Restore remaining access protections before deleting this record.",
        ),
    }


def available_actions(migration) -> dict[str, dict]:
    facts = _WorkflowFacts.from_migration(migration)
    idle = not facts.busy and not facts.recovery
    rules = {
        **_draft_action_rules(migration, facts, idle=idle),
        **_transfer_action_rules(migration, facts, idle=idle),
        **_result_action_rules(facts, idle=idle),
    }
    return {
        name: {"enabled": bool(enabled), "reason": None if enabled else reason}
        for name, (enabled, reason) in rules.items()
    }


def require_action(migration, action: str) -> None:
    decision = available_actions(migration)[action]
    if not decision["enabled"]:
        raise ValueError(decision["reason"])
