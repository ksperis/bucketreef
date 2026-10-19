from __future__ import annotations

import json

from fastapi import HTTPException

from app.db import AuditLog
from app.main import app
from app.models.billing import BillingEntityPayload
from app.routers import dependencies
from app.services.billing_entity_service import BillingEntityService


def _entity(db_session, name: str = "Research entity"):
    return BillingEntityService(db_session).create(
        BillingEntityPayload(name=name, subject_type="account")
    )


def _payload(entity_id: int, *, name: str = "Research") -> dict:
    return {
        "name": name,
        "code": "RES",
        "external_id": "org-research",
        "description": "Research organization",
        "memberships": [
            {
                "billing_entity_id": entity_id,
                "effective_from": "2026-01-01",
                "effective_to": None,
            }
        ],
    }


def test_billing_entity_group_api_supports_crud_deactivation_and_safe_audit(client, db_session):
    entity = _entity(db_session)
    payload = _payload(entity.id)

    created_response = client.post("/api/admin/billing/groups", json=payload)
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert created["name"] == "Research"
    assert created["memberships"][0]["billing_entity_id"] == entity.id

    listed = client.get("/api/admin/billing/groups", params={"search": "org-research"})
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [created["id"]]

    updated_payload = _payload(entity.id, name="Research division")
    updated_payload["code"] = "RDI"
    updated = client.put(f"/api/admin/billing/groups/{created['id']}", json=updated_payload)
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Research division"

    deactivated = client.post(f"/api/admin/billing/groups/{created['id']}/deactivate")
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["active"] is False
    active_only = client.get("/api/admin/billing/groups", params={"include_inactive": False})
    assert active_only.json() == []

    audits = (
        db_session.query(AuditLog)
        .filter(
            AuditLog.action.in_(
                (
                    "billing_entity_group.create",
                    "billing_entity_group.update",
                    "billing_entity_group.deactivate",
                )
            )
        )
        .order_by(AuditLog.id)
        .all()
    )
    assert [row.action for row in audits] == [
        "billing_entity_group.create",
        "billing_entity_group.update",
        "billing_entity_group.deactivate",
    ]
    metadata = json.loads(audits[0].metadata_json or "{}")
    assert metadata["memberships"] == [
        {
            "billing_entity_id": entity.id,
            "effective_from": "2026-01-01",
            "effective_to": None,
        }
    ]
    assert all("secret" not in (row.metadata_json or "").lower() for row in audits)


def test_billing_entity_group_api_rejects_same_entity_period_overlap(client, db_session):
    entity = _entity(db_session)
    payload = _payload(entity.id)
    payload["memberships"].append(
        {
            "billing_entity_id": entity.id,
            "effective_from": "2026-06-01",
            "effective_to": None,
        }
    )

    response = client.post("/api/admin/billing/groups", json=payload)

    assert response.status_code == 409
    assert "must not overlap" in response.json()["detail"]


def test_billing_entity_group_api_requires_superadmin(client):
    previous = app.dependency_overrides.get(dependencies.get_current_super_admin)

    def deny_superadmin():
        raise HTTPException(status_code=403, detail="Superadmin required")

    app.dependency_overrides[dependencies.get_current_super_admin] = deny_superadmin
    try:
        response = client.get("/api/admin/billing/groups")
    finally:
        if previous is None:
            app.dependency_overrides.pop(dependencies.get_current_super_admin, None)
        else:
            app.dependency_overrides[dependencies.get_current_super_admin] = previous

    assert response.status_code == 403
