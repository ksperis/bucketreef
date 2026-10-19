# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import BillingAutomationRun, BillingEntity, User
from app.models.app_settings import BillingAutomationSettings
from app.models.billing import (
    BillingAutomationRunDiagnostic,
    BillingAutomationRunItem,
)
from app.services.audit_service import AuditService
from app.services.billing_analysis_service import BillingAnalysisService
from app.services.billing_service import _parse_month
from app.services.billing_statement_service import BillingStatementService
from app.utils.time import utcnow


AUTOMATION_ACTOR_EMAIL = "billing-automation@bucketreef.internal"
AUTOMATION_ACTOR_ROLE = "automation"


class BillingStatementAutomationService:
    """Run the configured monthly statement workflow over canonical statements."""

    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def target_month(
        settings: BillingAutomationSettings,
        *,
        requested_month: str | None = None,
        today: date | None = None,
    ) -> tuple[str | None, str, str | None]:
        current_day = today or utcnow().date()
        if settings.mode == "manual":
            return None, "scheduled", "manual_mode"
        if requested_month is not None:
            period = _parse_month(requested_month)
            current_month = date(current_day.year, current_day.month, 1)
            if period.start >= current_month:
                raise ValueError("Billing automation can only run for a completed month")
            return period.month, "retry", None
        if current_day.day < settings.schedule_day:
            return None, "scheduled", "not_due"
        previous_month_day = date(current_day.year, current_day.month, 1) - timedelta(days=1)
        return previous_month_day.strftime("%Y-%m"), "scheduled", None

    def list_runs(self, *, limit: int = 20) -> list[BillingAutomationRunItem]:
        rows = self.db.scalars(
            select(BillingAutomationRun)
            .order_by(BillingAutomationRun.started_at.desc(), BillingAutomationRun.id.desc())
            .limit(min(max(int(limit), 1), 100))
        ).all()
        return [self._item(row) for row in rows]

    def has_completed_scheduled_run(self, *, month: str, mode: str) -> bool:
        period = _parse_month(month)
        return self.db.scalar(
            select(BillingAutomationRun.id).where(
                BillingAutomationRun.period_start == period.start,
                BillingAutomationRun.mode == mode,
                BillingAutomationRun.trigger_source == "scheduled",
                BillingAutomationRun.status == "completed",
            )
        ) is not None

    def run(
        self,
        *,
        month: str,
        settings: BillingAutomationSettings,
        trigger_source: str,
    ) -> BillingAutomationRunItem:
        if settings.mode == "manual":
            raise ValueError("Billing statement automation is configured for manual operation")
        if trigger_source not in {"scheduled", "retry"}:
            raise ValueError("Unsupported Billing automation trigger")
        period = _parse_month(month)
        now = utcnow()
        row = BillingAutomationRun(
            period_start=period.start,
            mode=settings.mode,
            trigger_source=trigger_source,
            status="running",
            started_at=now,
            created_at=now,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)

        diagnostics: list[BillingAutomationRunDiagnostic] = []
        entities = list(
            self.db.scalars(
                select(BillingEntity)
                .where(BillingEntity.active.is_(True))
                .order_by(BillingEntity.id.asc())
            ).all()
        )
        row.active_entity_count = len(entities)

        analysis_available = True
        try:
            preview = BillingAnalysisService(self.db).preview(period.month)
            row.unassigned_subject_count = len(preview.unassigned)
        except Exception:  # noqa: BLE001 - per-entity generation below remains authoritative
            analysis_available = False
            row.unassigned_subject_count = 0

        globally_blocked = (
            settings.mode == "automatic_finalize"
            and (
                not analysis_available
                or (settings.require_all_subjects_assigned and row.unassigned_subject_count > 0)
            )
        )
        global_blocker = (
            "automation:analysis_unavailable"
            if not analysis_available
            else "automation:unassigned_subjects"
        )
        statements = BillingStatementService(self.db)
        actor = User(
            email=AUTOMATION_ACTOR_EMAIL,
            role="ui_none",
            is_active=False,
        )
        has_blockers = globally_blocked

        for entity in entities:
            existing_ids = {
                item.id
                for item in statements.list(
                    month=period.month,
                    billing_entity_id=entity.id,
                )
            }
            try:
                result = statements.generate(
                    month=period.month,
                    billing_entity_id=entity.id,
                    regenerate=False,
                )
            except Exception as exc:  # noqa: BLE001 - record safe error category and continue
                row.failed_entity_count += 1
                diagnostics.append(
                    BillingAutomationRunDiagnostic(
                        billing_entity_id=entity.id,
                        status="failed",
                        error_code=type(exc).__name__,
                    )
                )
                continue

            statement_ids = [item.id for item in result.statements]
            row.generated_statement_count += sum(
                1 for statement_id in statement_ids if statement_id not in existing_ids
            )
            blockers = list(result.blockers)
            if settings.mode == "automatic_draft":
                row.blocked_statement_count += sum(
                    1 for statement in result.statements if statement.blockers
                )

            if settings.mode == "automatic_finalize":
                if globally_blocked:
                    blockers.append(global_blocker)
                for statement in result.statements:
                    statement_blockers = list(statement.blockers)
                    if globally_blocked:
                        statement_blockers.append(global_blocker)
                    if statement.status == "finalized":
                        continue
                    if statement_blockers:
                        row.blocked_statement_count += 1
                        blockers.extend(statement_blockers)
                        continue
                    try:
                        finalized = statements.finalize(statement.id, actor=actor)
                    except Exception as exc:  # noqa: BLE001 - canonical finalize decides safety
                        row.blocked_statement_count += 1
                        blockers.append(f"finalization:{type(exc).__name__}")
                        continue
                    row.finalized_statement_count += 1
                    self._audit_finalization(finalized)

            blockers = sorted(set(blockers))
            has_blockers = has_blockers or bool(blockers)
            diagnostics.append(
                BillingAutomationRunDiagnostic(
                    billing_entity_id=entity.id,
                    status=(
                        "blocked"
                        if blockers
                        else "finalized"
                        if settings.mode == "automatic_finalize" and result.statements
                        else "generated"
                    ),
                    statement_ids=statement_ids,
                    blockers=blockers,
                )
            )

        if row.failed_entity_count and row.failed_entity_count == row.active_entity_count:
            row.status = "failed"
        elif row.failed_entity_count or row.blocked_statement_count or has_blockers:
            row.status = "partial"
        else:
            row.status = "completed"
        row.diagnostics_json = json.dumps(
            [item.model_dump(mode="json") for item in diagnostics],
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        row.completed_at = utcnow()
        self.db.commit()
        self.db.refresh(row)
        self._audit_run(row)
        return self._item(row)

    def _audit_finalization(self, statement) -> None:
        AuditService(self.db).record_action(
            user=None,
            user_email=AUTOMATION_ACTOR_EMAIL,
            user_role=AUTOMATION_ACTOR_ROLE,
            scope="admin",
            action="billing_statement.finalize",
            entity_type="billing_statement",
            entity_id=str(statement.id),
            metadata={
                "automation": True,
                "public_id": statement.public_id,
                "billing_entity_id": statement.billing_entity_id,
                "period_start": statement.period_start.isoformat(),
                "currency": statement.currency,
                "total": str(statement.total),
                "revision": statement.revision,
            },
        )

    def _audit_run(self, row: BillingAutomationRun) -> None:
        status = "success" if row.status == "completed" else "failure" if row.status == "failed" else "partial"
        AuditService(self.db).record_action(
            user=None,
            user_email=AUTOMATION_ACTOR_EMAIL,
            user_role=AUTOMATION_ACTOR_ROLE,
            scope="admin",
            action="billing_automation.run",
            entity_type="billing_automation_run",
            entity_id=str(row.id),
            status=status,
            metadata={
                "month": row.period_start.strftime("%Y-%m"),
                "mode": row.mode,
                "trigger_source": row.trigger_source,
                "status": row.status,
                "active_entity_count": row.active_entity_count,
                "generated_statement_count": row.generated_statement_count,
                "finalized_statement_count": row.finalized_statement_count,
                "blocked_statement_count": row.blocked_statement_count,
                "failed_entity_count": row.failed_entity_count,
                "unassigned_subject_count": row.unassigned_subject_count,
            },
        )

    @staticmethod
    def _item(row: BillingAutomationRun) -> BillingAutomationRunItem:
        raw = json.loads(row.diagnostics_json or "[]")
        diagnostics = [BillingAutomationRunDiagnostic.model_validate(item) for item in raw]
        return BillingAutomationRunItem(
            id=row.id,
            month=row.period_start.strftime("%Y-%m"),
            mode=row.mode,
            trigger_source=row.trigger_source,
            status=row.status,
            active_entity_count=row.active_entity_count,
            generated_statement_count=row.generated_statement_count,
            finalized_statement_count=row.finalized_statement_count,
            blocked_statement_count=row.blocked_statement_count,
            failed_entity_count=row.failed_entity_count,
            unassigned_subject_count=row.unassigned_subject_count,
            diagnostics=diagnostics,
            started_at=row.started_at,
            completed_at=row.completed_at,
        )
