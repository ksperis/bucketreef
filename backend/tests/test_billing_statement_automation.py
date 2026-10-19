# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from app.db import BillingEntity
from app.db import AuditLog, BillingAutomationRun
from app.models.app_settings import AppSettings, BillingAutomationSettings
from app.routers import dependencies
from app.routers.internal import billing_collect
from app.services import billing_statement_automation_service as automation_module
from app.services.billing_statement_automation_service import BillingStatementAutomationService
from app.services.operation_lease_service import (
    OperationLeaseService,
    billing_statement_monthly_operation_name,
)


def _entity(db_session, name: str = "Research") -> BillingEntity:
    row = BillingEntity(name=name, subject_type="account", active=True)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_target_month_respects_manual_schedule_and_retry() -> None:
    manual = BillingAutomationSettings(mode="manual", schedule_day=5)
    assert BillingStatementAutomationService.target_month(
        manual,
        today=date(2026, 10, 18),
    ) == (None, "scheduled", "manual_mode")

    scheduled = BillingAutomationSettings(mode="automatic_draft", schedule_day=20)
    assert BillingStatementAutomationService.target_month(
        scheduled,
        today=date(2026, 10, 18),
    ) == (None, "scheduled", "not_due")
    assert BillingStatementAutomationService.target_month(
        scheduled,
        today=date(2026, 10, 20),
    ) == ("2026-09", "scheduled", None)
    assert BillingStatementAutomationService.target_month(
        scheduled,
        requested_month="2026-08",
        today=date(2026, 10, 18),
    ) == ("2026-08", "retry", None)


def test_automatic_finalize_uses_canonical_finalize_and_retries_are_idempotent(
    db_session,
    monkeypatch,
) -> None:
    entity = _entity(db_session)
    state = {"exists": False, "finalized": False, "finalize_calls": 0}

    class FakeStatements:
        def __init__(self, _db) -> None:
            pass

        def list(self, **_kwargs):
            if not state["exists"]:
                return []
            return [SimpleNamespace(id=41, status="finalized" if state["finalized"] else "draft")]

        def generate(self, **_kwargs):
            state["exists"] = True
            return SimpleNamespace(
                blockers=[],
                statements=[
                    SimpleNamespace(
                        id=41,
                        blockers=[],
                        status="finalized" if state["finalized"] else "draft",
                    )
                ],
            )

        def finalize(self, statement_id: int, *, actor):
            assert statement_id == 41
            assert actor.email == automation_module.AUTOMATION_ACTOR_EMAIL
            state["finalize_calls"] += 1
            state["finalized"] = True
            return SimpleNamespace(id=41)

    monkeypatch.setattr(automation_module, "BillingStatementService", FakeStatements)
    monkeypatch.setattr(
        automation_module.BillingAnalysisService,
        "preview",
        lambda *_args, **_kwargs: SimpleNamespace(unassigned=[]),
    )
    monkeypatch.setattr(BillingStatementAutomationService, "_audit_finalization", lambda *_args: None)
    monkeypatch.setattr(BillingStatementAutomationService, "_audit_run", lambda *_args: None)

    settings = BillingAutomationSettings(mode="automatic_finalize")
    first = BillingStatementAutomationService(db_session).run(
        month="2026-09",
        settings=settings,
        trigger_source="scheduled",
    )
    second = BillingStatementAutomationService(db_session).run(
        month="2026-09",
        settings=settings,
        trigger_source="retry",
    )

    assert first.status == "completed"
    assert first.generated_statement_count == 1
    assert first.finalized_statement_count == 1
    assert first.diagnostics[0].billing_entity_id == entity.id
    assert first.diagnostics[0].status == "finalized"
    assert second.status == "completed"
    assert second.generated_statement_count == 0
    assert second.finalized_statement_count == 0
    assert state["finalize_calls"] == 1


def test_automatic_finalize_blocks_when_unassigned_subjects_are_forbidden(
    db_session,
    monkeypatch,
) -> None:
    _entity(db_session)
    finalize_calls: list[int] = []

    class FakeStatements:
        def __init__(self, _db) -> None:
            pass

        def list(self, **_kwargs):
            return []

        def generate(self, **_kwargs):
            return SimpleNamespace(
                blockers=[],
                statements=[SimpleNamespace(id=52, blockers=[], status="draft")],
            )

        def finalize(self, statement_id: int, *, actor):
            finalize_calls.append(statement_id)
            raise AssertionError("finalize must not run while unassigned subjects block automation")

    monkeypatch.setattr(automation_module, "BillingStatementService", FakeStatements)
    monkeypatch.setattr(
        automation_module.BillingAnalysisService,
        "preview",
        lambda *_args, **_kwargs: SimpleNamespace(unassigned=[SimpleNamespace(subject_id=7)]),
    )
    monkeypatch.setattr(BillingStatementAutomationService, "_audit_run", lambda *_args: None)

    result = BillingStatementAutomationService(db_session).run(
        month="2026-09",
        settings=BillingAutomationSettings(
            mode="automatic_finalize",
            require_all_subjects_assigned=True,
        ),
        trigger_source="scheduled",
    )

    assert result.status == "partial"
    assert result.unassigned_subject_count == 1
    assert result.blocked_statement_count == 1
    assert result.finalized_statement_count == 0
    assert result.diagnostics[0].blockers == ["automation:unassigned_subjects"]
    assert finalize_calls == []


def test_automatic_finalize_fails_closed_when_global_analysis_is_unavailable(
    db_session,
    monkeypatch,
) -> None:
    _entity(db_session)

    class FakeStatements:
        def __init__(self, _db) -> None:
            pass

        def list(self, **_kwargs):
            return []

        def generate(self, **_kwargs):
            return SimpleNamespace(
                blockers=[],
                statements=[SimpleNamespace(id=53, blockers=[], status="draft")],
            )

        def finalize(self, *_args, **_kwargs):
            raise AssertionError("finalize must fail closed when analysis is unavailable")

    monkeypatch.setattr(automation_module, "BillingStatementService", FakeStatements)
    monkeypatch.setattr(
        automation_module.BillingAnalysisService,
        "preview",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("analysis failed")),
    )
    monkeypatch.setattr(BillingStatementAutomationService, "_audit_run", lambda *_args: None)

    result = BillingStatementAutomationService(db_session).run(
        month="2026-09",
        settings=BillingAutomationSettings(mode="automatic_finalize"),
        trigger_source="scheduled",
    )

    assert result.status == "partial"
    assert result.blocked_statement_count == 1
    assert result.diagnostics[0].blockers == ["automation:analysis_unavailable"]


def test_automatic_draft_records_blockers_without_finalizing(
    db_session,
    monkeypatch,
) -> None:
    _entity(db_session)

    class FakeStatements:
        def __init__(self, _db) -> None:
            pass

        def list(self, **_kwargs):
            return []

        def generate(self, **_kwargs):
            return SimpleNamespace(
                blockers=["entity:1:no_priced_currency"],
                statements=[],
            )

        def finalize(self, *_args, **_kwargs):
            raise AssertionError("automatic draft mode must never finalize")

    monkeypatch.setattr(automation_module, "BillingStatementService", FakeStatements)
    monkeypatch.setattr(
        automation_module.BillingAnalysisService,
        "preview",
        lambda *_args, **_kwargs: SimpleNamespace(unassigned=[]),
    )
    monkeypatch.setattr(BillingStatementAutomationService, "_audit_run", lambda *_args: None)

    result = BillingStatementAutomationService(db_session).run(
        month="2026-09",
        settings=BillingAutomationSettings(mode="automatic_draft"),
        trigger_source="scheduled",
    )

    assert result.status == "partial"
    assert result.finalized_statement_count == 0
    assert result.diagnostics[0].status == "blocked"
    assert result.diagnostics[0].blockers == ["entity:1:no_priced_currency"]


def test_automation_run_audit_uses_explicit_automation_identity(db_session) -> None:
    now = automation_module.utcnow()
    run = BillingAutomationRun(
        period_start=date(2026, 9, 1),
        mode="automatic_draft",
        trigger_source="scheduled",
        status="completed",
        started_at=now,
        completed_at=now,
        created_at=now,
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)

    BillingStatementAutomationService(db_session)._audit_run(run)

    audit = db_session.query(AuditLog).filter_by(action="billing_automation.run").one()
    assert audit.user_id is None
    assert audit.user_email == automation_module.AUTOMATION_ACTOR_EMAIL
    assert audit.user_role == automation_module.AUTOMATION_ACTOR_ROLE
    assert audit.entity_id == str(run.id)
    assert audit.status == "success"


def test_admin_automation_settings_and_run_history_routes(client, db_session, monkeypatch) -> None:
    current = AppSettings()
    current.general.billing_enabled = True
    monkeypatch.setattr("app.routers.admin.billing.load_app_settings", lambda: current)

    def save_settings(payload: AppSettings) -> AppSettings:
        current.billing_automation = payload.billing_automation.model_copy(deep=True)
        return current

    monkeypatch.setattr("app.routers.admin.billing.save_app_settings", save_settings)

    response = client.put(
        "/api/admin/billing/automation/settings",
        json={
            "mode": "automatic_finalize",
            "schedule_day": 8,
            "require_all_subjects_assigned": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "mode": "automatic_finalize",
        "schedule_day": 8,
        "require_all_subjects_assigned": False,
    }

    audit = db_session.query(AuditLog).filter_by(action="billing_automation.settings_update").one()
    assert audit.user_email == "admin@example.com"

    now = automation_module.utcnow()
    db_session.add(
        BillingAutomationRun(
            period_start=date(2026, 9, 1),
            mode="automatic_finalize",
            trigger_source="scheduled",
            status="partial",
            active_entity_count=2,
            generated_statement_count=2,
            finalized_statement_count=1,
            blocked_statement_count=1,
            failed_entity_count=0,
            unassigned_subject_count=0,
            diagnostics_json="[]",
            started_at=now,
            completed_at=now,
            created_at=now,
        )
    )
    db_session.commit()

    history = client.get("/api/admin/billing/automation/runs")
    assert history.status_code == 200, history.text
    assert history.json()[0]["month"] == "2026-09"
    assert history.json()[0]["status"] == "partial"


def test_internal_monthly_statement_automation_uses_month_lease(
    client,
    db_session,
    monkeypatch,
) -> None:
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    settings = AppSettings()
    settings.general.billing_enabled = True
    settings.billing_automation.mode = "automatic_draft"
    monkeypatch.setattr(billing_collect, "load_app_settings_for_db", lambda _db: settings)
    OperationLeaseService(db_session).acquire(
        billing_statement_monthly_operation_name("2026-09"),
        ttl_seconds=600,
        owner="other-backend",
    )
    monkeypatch.setattr(
        BillingStatementAutomationService,
        "run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("run must not start")),
    )

    response = client.post(
        "/api/internal/billing/statements/monthly?month=2026-09",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "status": "skipped",
        "reason": "already_running",
        "operation": "billing:statements:2026-09",
    }


def test_completed_scheduled_run_is_detected_but_retry_remains_available(db_session) -> None:
    now = automation_module.utcnow()
    db_session.add(
        BillingAutomationRun(
            period_start=date(2026, 9, 1),
            mode="automatic_finalize",
            trigger_source="scheduled",
            status="completed",
            diagnostics_json="[]",
            started_at=now,
            completed_at=now,
            created_at=now,
        )
    )
    db_session.commit()

    service = BillingStatementAutomationService(db_session)
    assert service.has_completed_scheduled_run(month="2026-09", mode="automatic_finalize") is True
    assert service.has_completed_scheduled_run(month="2026-09", mode="automatic_draft") is False
