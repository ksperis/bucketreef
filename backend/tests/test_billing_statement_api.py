from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
import json

from fastapi import HTTPException

from app.db import (
    AuditLog,
    BillingStatement,
    WebhookDelivery,
    BillingEntityRateAssignment,
    BillingRateCard,
    BillingRatePlan,
    BillingStorageDaily,
    BillingUsageDaily,
    S3Account,
    StorageEndpoint,
)
from app.main import app
from app.models.billing import BillingEntityPayload
from app.models.webhook import WebhookEndpointPayload
from app.routers import dependencies
from app.services.billing_entity_service import BillingEntityService
from app.services.webhook_catalog import BILLING_STATEMENT_FINALIZED_EVENT_TYPE
from app.services.webhook_service import WebhookEventPublisher, WebhookService
from app.utils.time import utcnow


GIB = 1024**3


def _seed_complete_statement_scope(db_session):
    endpoint = StorageEndpoint(
        name="statement-api-endpoint",
        endpoint_url="https://statement-api.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.flush()
    account = S3Account(
        name="Statement API account",
        rgw_account_id="RGW-STATEMENT-API",
        rgw_user_uid="RGW-STATEMENT-API-root",
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    plan = BillingRatePlan(name="statement-api-plan", storage_endpoint_id=None)
    card = BillingRateCard(
        rate_plan=plan,
        currency="EUR",
        storage_charge_basis="actual_usage",
        storage_gb_month_price=Decimal("1"),
        effective_from=date(2026, 1, 1),
    )
    db_session.add_all([account, card])
    db_session.commit()

    entity = BillingEntityService(db_session).create(
        BillingEntityPayload(
            name="Statement API Entity",
            code="API",
            external_id="erp-api-entity",
            subject_type="account",
            explicit_include_ids=[account.id],
        )
    )
    db_session.add(
        BillingEntityRateAssignment(
            billing_entity_id=entity.id,
            rate_plan_id=plan.id,
            effective_from=date(2026, 1, 1),
        )
    )
    for offset in range(31):
        day = date(2026, 1, 1) + timedelta(days=offset)
        db_session.add_all(
            [
                BillingStorageDaily(
                    day=day,
                    storage_endpoint_id=endpoint.id,
                    s3_account_id=account.id,
                    total_bytes=GIB,
                    total_objects=1,
                    quota_size_bytes=2 * GIB,
                    quota_state="valid",
                    source="rgw_admin_bucket_stats",
                    collected_at=utcnow(),
                ),
                BillingUsageDaily(
                    day=day,
                    storage_endpoint_id=endpoint.id,
                    s3_account_id=account.id,
                    bytes_in=0,
                    bytes_out=0,
                    ops_total=0,
                    source="rgw_admin_usage",
                    collected_at=utcnow(),
                ),
            ]
        )
    db_session.commit()
    return entity


def test_statement_api_generates_lists_reads_finalizes_and_audits(client, db_session):
    entity = _seed_complete_statement_scope(db_session)

    generated_response = client.post(
        "/api/admin/billing/statements/generate",
        json={"month": "2026-01", "billing_entity_id": entity.id, "regenerate": False},
    )
    assert generated_response.status_code == 200, generated_response.text
    generated = generated_response.json()
    assert generated["blockers"] == []
    assert len(generated["statements"]) == 1
    statement = generated["statements"][0]
    assert statement["status"] == "draft"
    assert statement["billing_entity_external_id"] == "erp-api-entity"
    assert statement["currency"] == "EUR"
    assert len(statement["public_id"]) == 36

    repeated = client.post(
        "/api/admin/billing/statements/generate",
        json={"month": "2026-01", "billing_entity_id": entity.id, "regenerate": False},
    )
    assert repeated.status_code == 200
    assert repeated.json()["statements"][0]["id"] == statement["id"]
    assert repeated.json()["statements"][0]["revision"] == 1

    listed = client.get(
        "/api/admin/billing/statements",
        params={"month": "2026-01", "billing_entity_id": entity.id, "status": "draft"},
    )
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()] == [statement["id"]]

    detail = client.get(f"/api/admin/billing/statements/{statement['id']}")
    assert detail.status_code == 200
    assert detail.json()["lines"][0]["snapshot"]["subject_name"] == "Statement API account"

    draft_pdf = client.get(f"/api/admin/billing/statements/{statement['id']}/export.pdf")
    assert draft_pdf.status_code == 409

    finalized_response = client.post(f"/api/admin/billing/statements/{statement['id']}/finalize")
    assert finalized_response.status_code == 200, finalized_response.text
    finalized = finalized_response.json()
    assert finalized["status"] == "finalized"
    assert finalized["finalized_by_user_email"] == "admin@example.com"

    period_response = client.get(
        "/api/admin/billing/finalized-period",
        params={
            "scope_type": "entity",
            "scope_id": entity.id,
            "start_month": "2026-01",
            "end_month": "2026-01",
        },
    )
    assert period_response.status_code == 200, period_response.text
    period = period_response.json()
    assert period["complete"] is True
    assert period["finalized_months"] == ["2026-01"]
    assert period["currency_totals"][0]["statement_ids"] == [statement["id"]]
    assert period["currency_totals"][0]["total"] == finalized["total"]

    csv_export = client.get(f"/api/admin/billing/statements/{statement['id']}/export.csv")
    assert csv_export.status_code == 200
    assert csv_export.headers["content-type"].startswith("text/csv")
    assert "statement_public_id" in csv_export.text
    assert statement["public_id"] in csv_export.text
    assert "Statement API account" in csv_export.text

    json_export = client.get(f"/api/admin/billing/statements/{statement['id']}/export.json")
    assert json_export.status_code == 200
    exported = json_export.json()
    assert exported["public_id"] == statement["public_id"]
    assert exported["lines"][0]["snapshot"]["subject_name"] == "Statement API account"

    pdf_export = client.get(f"/api/admin/billing/statements/{statement['id']}/export.pdf")
    assert pdf_export.status_code == 200
    assert pdf_export.headers["content-type"].startswith("application/pdf")
    assert pdf_export.headers["content-disposition"].startswith(
        f'attachment; filename="billing-statement-{statement["public_id"]}.pdf"'
    )
    assert pdf_export.content.startswith(b"%PDF-")

    regenerate = client.post(
        "/api/admin/billing/statements/generate",
        json={"month": "2026-01", "billing_entity_id": entity.id, "regenerate": True},
    )
    assert regenerate.status_code == 409

    audits = (
        db_session.query(AuditLog)
        .filter(
            AuditLog.action.in_(
                (
                    "billing_statement.generate",
                    "billing_statement.finalize",
                )
            )
        )
        .order_by(AuditLog.id)
        .all()
    )
    assert [row.action for row in audits] == [
        "billing_statement.generate",
        "billing_statement.generate",
        "billing_statement.finalize",
    ]
    final_metadata = json.loads(audits[-1].metadata_json or "{}")
    assert final_metadata["public_id"] == statement["public_id"]
    assert final_metadata["billing_entity_id"] == entity.id
    assert final_metadata["currency"] == "EUR"
    assert all("secret" not in (row.metadata_json or "").lower() for row in audits)


def test_statement_api_can_generate_and_finalize_an_estimated_draft(client, db_session):
    entity = _seed_complete_statement_scope(db_session)
    account = db_session.query(S3Account).filter_by(rgw_account_id="RGW-STATEMENT-API").one()
    missing_days = [date(2026, 1, 10), date(2026, 1, 20)]
    db_session.query(BillingStorageDaily).filter(
        BillingStorageDaily.s3_account_id == account.id,
        BillingStorageDaily.day.in_(missing_days),
    ).delete(synchronize_session=False)
    db_session.query(BillingUsageDaily).filter(
        BillingUsageDaily.s3_account_id == account.id,
        BillingUsageDaily.day.in_(missing_days),
    ).delete(synchronize_session=False)
    db_session.commit()

    response = client.post(
        "/api/admin/billing/statements/generate",
        json={
            "month": "2026-01",
            "billing_entity_id": entity.id,
            "regenerate": False,
            "estimation_mode": "coverage_extrapolation",
            "estimation_reason": "collector outage",
        },
    )
    assert response.status_code == 200, response.text
    statement = response.json()["statements"][0]
    assert statement["blockers"] == []
    assert statement["estimation_mode"] == "coverage_extrapolation"
    assert statement["estimation_reason"] == "collector outage"
    assert statement["estimation_requested_by_email"] == "admin@example.com"
    assert statement["coverage"]["storage_coverage_ratio"] == "0.935484"
    assert statement["coverage"]["usage_coverage_ratio"] == "0.935484"
    assert statement["lines"][0]["snapshot"]["estimation"]["storage_method"] == "observed_daily_average"

    finalized = client.post(f"/api/admin/billing/statements/{statement['id']}/finalize")
    assert finalized.status_code == 200, finalized.text
    assert finalized.json()["status"] == "finalized"
    assert finalized.json()["estimation_mode"] == "coverage_extrapolation"

    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "billing_statement.finalize")
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert audit is not None
    metadata = json.loads(audit.metadata_json or "{}")
    assert metadata["estimation_mode"] == "coverage_extrapolation"
    assert metadata["estimation_reason"] == "collector outage"


def test_statement_api_requires_superadmin(client):
    previous = app.dependency_overrides.get(dependencies.get_current_super_admin)

    def deny_superadmin():
        raise HTTPException(status_code=403, detail="Superadmin required")

    app.dependency_overrides[dependencies.get_current_super_admin] = deny_superadmin
    try:
        response = client.get("/api/admin/billing/statements")
    finally:
        if previous is None:
            app.dependency_overrides.pop(dependencies.get_current_super_admin, None)
        else:
            app.dependency_overrides[dependencies.get_current_super_admin] = previous

    assert response.status_code == 403


def test_statement_finalization_queues_reference_webhook_once(
    client,
    db_session,
    monkeypatch,
):
    entity = _seed_complete_statement_scope(db_session)
    monkeypatch.setattr(
        "app.services.webhook_service.validate_webhook_target_url",
        lambda *_args, **_kwargs: None,
    )
    exact = WebhookService(db_session).create_endpoint(
        WebhookEndpointPayload(
            name="billing-finalized",
            url="https://hooks.example.test/billing",
            enabled=True,
            event_types=[BILLING_STATEMENT_FINALIZED_EVENT_TYPE],
        )
    )
    wildcard = WebhookService(db_session).create_endpoint(
        WebhookEndpointPayload(
            name="all-events",
            url="https://hooks.example.test/all",
            enabled=True,
            event_types=["*"],
        )
    )
    ignored = WebhookService(db_session).create_endpoint(
        WebhookEndpointPayload(
            name="unrelated",
            url="https://hooks.example.test/unrelated",
            enabled=True,
            event_types=["system.endpoint_health.changed"],
        )
    )

    generated = client.post(
        "/api/admin/billing/statements/generate",
        json={"month": "2026-01", "billing_entity_id": entity.id, "regenerate": False},
    ).json()["statements"][0]
    first = client.post(f"/api/admin/billing/statements/{generated['id']}/finalize")
    assert first.status_code == 200, first.text

    deliveries = (
        db_session.query(WebhookDelivery)
        .filter(WebhookDelivery.event_type == BILLING_STATEMENT_FINALIZED_EVENT_TYPE)
        .order_by(WebhookDelivery.endpoint_id.asc())
        .all()
    )
    assert {row.endpoint_id for row in deliveries} == {exact.id, wildcard.id}
    assert ignored.id not in {row.endpoint_id for row in deliveries}
    assert len({row.event_id for row in deliveries}) == 1

    payload = json.loads(deliveries[0].payload_json)
    assert payload["type"] == BILLING_STATEMENT_FINALIZED_EVENT_TYPE
    assert payload["version"] == 1
    finalized_at = payload["data"].pop("finalized_at")
    assert finalized_at.replace("+00:00", "Z") == first.json()["finalized_at"]
    assert payload["data"] == {
        "billing_entity_external_id": "erp-api-entity",
        "billing_entity_id": entity.id,
        "currency": "EUR",
        "period_end": "2026-01-31",
        "period_start": "2026-01-01",
        "statement_api_reference": (
            f"/api/integrations/billing/v1/statements/{generated['public_id']}"
        ),
        "statement_id": generated["id"],
        "statement_public_id": generated["public_id"],
    }
    assert "lines" not in payload["data"]
    assert "total" not in payload["data"]

    repeated = client.post(f"/api/admin/billing/statements/{generated['id']}/finalize")
    assert repeated.status_code == 200
    assert (
        db_session.query(WebhookDelivery)
        .filter(WebhookDelivery.event_type == BILLING_STATEMENT_FINALIZED_EVENT_TYPE)
        .count()
        == 2
    )


def test_statement_finalization_survives_webhook_queue_failure(
    client,
    db_session,
    monkeypatch,
):
    entity = _seed_complete_statement_scope(db_session)
    generated = client.post(
        "/api/admin/billing/statements/generate",
        json={"month": "2026-01", "billing_entity_id": entity.id, "regenerate": False},
    ).json()["statements"][0]

    def fail_queue(self, **_kwargs):
        raise RuntimeError("webhook queue unavailable")

    monkeypatch.setattr(WebhookEventPublisher, "publish_event_in_current_transaction", fail_queue)
    response = client.post(f"/api/admin/billing/statements/{generated['id']}/finalize")

    assert response.status_code == 200, response.text
    db_session.expire_all()
    persisted = db_session.get(BillingStatement, generated["id"])
    assert persisted is not None
    assert persisted.status == "finalized"
    assert persisted.finalized_at is not None
