from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
import json

from fastapi import HTTPException

from app.db import (
    AuditLog,
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
from app.routers import dependencies
from app.services.billing_entity_service import BillingEntityService
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
