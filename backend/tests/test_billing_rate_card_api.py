from __future__ import annotations

from datetime import date
import json

from fastapi import HTTPException

from app.db import AuditLog, StorageEndpoint
from app.main import app
from app.routers import dependencies
from app.utils.time import utcnow


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _next_month(value: date) -> date:
    return date(
        value.year + (1 if value.month == 12 else 0),
        1 if value.month == 12 else value.month + 1,
        1,
    )


def _payload(
    *,
    name: str,
    effective_from: date,
    storage_endpoint_id: int | None = None,
    storage_charge_basis: str = "actual_usage",
) -> dict:
    return {
        "name": name,
        "currency": "EUR",
        "storage_charge_basis": storage_charge_basis,
        "storage_gb_month_price": 0.02,
        "egress_gb_price": 0.08,
        "ingress_gb_price": 0,
        "requests_per_1000_price": 0.004,
        "effective_from": effective_from.isoformat(),
        "effective_to": None,
        "storage_endpoint_id": storage_endpoint_id,
    }


def test_rate_card_api_crud_is_available_independently_of_billing_collection(client, db_session):
    future = _next_month(utcnow().date())

    assert client.get("/api/admin/billing/rate-cards").json() == []

    created_response = client.post(
        "/api/admin/billing/rate-cards",
        json=_payload(
            name="quota-plan",
            effective_from=future,
            storage_charge_basis="allocated_quota",
        ),
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert created["storage_charge_basis"] == "allocated_quota"
    assert created["identity_editable"] is True

    detail = client.get(f"/api/admin/billing/rate-cards/{created['id']}")
    assert detail.status_code == 200
    assert detail.json()["rate_plan_id"] == created["rate_plan_id"]
    assert len(client.get("/api/admin/billing/rate-cards").json()) == 1

    duplicate = client.post(
        "/api/admin/billing/rate-cards",
        json=_payload(name="quota-plan", effective_from=future),
    )
    assert duplicate.status_code == 409

    missing = client.get("/api/admin/billing/rate-cards/999999")
    assert missing.status_code == 404

    updated_response = client.put(
        f"/api/admin/billing/rate-cards/{created['id']}",
        json=_payload(
            name="quota-plan",
            effective_from=future,
            storage_charge_basis="actual_usage",
        ),
    )
    assert updated_response.status_code == 200, updated_response.text
    assert updated_response.json()["storage_charge_basis"] == "actual_usage"

    deleted = client.delete(f"/api/admin/billing/rate-cards/{created['id']}")
    assert deleted.status_code == 204

    audits = (
        db_session.query(AuditLog)
        .filter(
            AuditLog.action.in_(
                (
                    "billing_rate_card.create",
                    "billing_rate_card.update",
                    "billing_rate_card.delete",
                )
            )
        )
        .order_by(AuditLog.id)
        .all()
    )
    assert [row.action for row in audits] == [
        "billing_rate_card.create",
        "billing_rate_card.update",
        "billing_rate_card.delete",
    ]
    create_metadata = json.loads(audits[0].metadata_json or "{}")
    update_metadata = json.loads(audits[1].metadata_json or "{}")
    assert create_metadata["storage_charge_basis"] == "allocated_quota"
    assert update_metadata["before"]["storage_charge_basis"] == "allocated_quota"
    assert update_metadata["after"]["storage_charge_basis"] == "actual_usage"
    assert all("secret" not in (row.metadata_json or "").lower() for row in audits)


def test_rate_card_api_versioning_and_immutability(client, db_session):
    today = utcnow().date()
    endpoint = StorageEndpoint(
        name="api-rate-endpoint",
        endpoint_url="https://api-rate.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()

    current_response = client.post(
        "/api/admin/billing/rate-cards",
        json=_payload(
            name="endpoint-plan",
            effective_from=_month_start(today),
            storage_endpoint_id=endpoint.id,
        ),
    )
    assert current_response.status_code == 201, current_response.text
    current = current_response.json()

    in_place = client.put(
        f"/api/admin/billing/rate-cards/{current['id']}",
        json=_payload(
            name="endpoint-plan",
            effective_from=_month_start(today),
            storage_endpoint_id=endpoint.id,
            storage_charge_basis="allocated_quota",
        ),
    )
    assert in_place.status_code == 409

    version = client.post(
        f"/api/admin/billing/rate-cards/{current['id']}/versions",
        json={
            "currency": "EUR",
            "storage_charge_basis": "allocated_quota",
            "storage_gb_month_price": 0.03,
            "egress_gb_price": 0.09,
            "ingress_gb_price": 0,
            "requests_per_1000_price": 0.005,
            "effective_from": _next_month(today).isoformat(),
        },
    )
    assert version.status_code == 201, version.text
    payload = version.json()
    assert payload["rate_plan_id"] == current["rate_plan_id"]
    assert payload["storage_charge_basis"] == "allocated_quota"
    assert payload["identity_editable"] is False

    refreshed = client.get(f"/api/admin/billing/rate-cards/{current['id']}").json()
    assert refreshed["effective_to"] is not None

    version_audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "billing_rate_card.version_create")
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert version_audit is not None
    version_metadata = json.loads(version_audit.metadata_json or "{}")
    assert version_metadata["source"]["rate_card_id"] == current["id"]
    assert version_metadata["version"]["storage_charge_basis"] == "allocated_quota"
    assert "secret" not in (version_audit.metadata_json or "").lower()


def test_rate_card_api_requires_superadmin_dependency(client):
    previous = app.dependency_overrides.get(dependencies.get_current_super_admin)

    def deny_superadmin():
        raise HTTPException(status_code=403, detail="Superadmin required")

    app.dependency_overrides[dependencies.get_current_super_admin] = deny_superadmin
    try:
        response = client.get("/api/admin/billing/rate-cards")
    finally:
        if previous is None:
            app.dependency_overrides.pop(dependencies.get_current_super_admin, None)
        else:
            app.dependency_overrides[dependencies.get_current_super_admin] = previous

    assert response.status_code == 403
