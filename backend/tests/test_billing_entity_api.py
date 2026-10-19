from __future__ import annotations

import json

from fastapi import HTTPException

from app.db import AuditLog, S3Account, StorageEndpoint, TagDefinition
from app.main import app
from app.routers import dependencies
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED


def _seed(db_session):
    endpoint = StorageEndpoint(
        name="entity-api-endpoint",
        endpoint_url="https://entity-api.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.flush()
    account = S3Account(
        name="Research account",
        rgw_account_id="RGW-RESEARCH",
        rgw_user_uid="RGW-RESEARCH-root",
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    tag = TagDefinition(
        domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
        owner_user_id=None,
        label="research",
        label_key="research",
        color_key="sky",
        scope="administrative",
    )
    db_session.add_all([account, tag])
    db_session.commit()
    return account, tag


def _payload(account_id: int, tag_id: int, *, name: str = "Research") -> dict:
    return {
        "name": name,
        "code": "RES",
        "external_id": "cost-center-42",
        "subject_type": "account",
        "include_tag_ids": [tag_id],
        "explicit_include_ids": [account_id],
        "explicit_exclude_ids": [],
        "rate_assignments": [],
    }


def test_billing_entity_api_supports_preview_crud_deactivation_and_safe_audit(client, db_session):
    account, tag = _seed(db_session)
    payload = _payload(account.id, tag.id)

    subjects = client.get(
        "/api/admin/billing/entity-subjects",
        params={"subject_type": "account", "search": "Research"},
    )
    assert subjects.status_code == 200, subjects.text
    assert subjects.json()[0]["subject_id"] == account.id

    preview = client.post("/api/admin/billing/entities/preview", json=payload)
    assert preview.status_code == 200, preview.text
    preview_json = preview.json()
    assert preview_json["entities"][-1]["entity_name"] == "Research"
    assert preview_json["entities"][-1]["members"][0]["subject_id"] == account.id

    created_response = client.post("/api/admin/billing/entities", json=payload)
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert created["name"] == "Research"
    assert created["member_count"] == 1
    assert created["include_tags"][0]["id"] == tag.id

    listed = client.get("/api/admin/billing/entities", params={"search": "cost-center"})
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [created["id"]]

    updated_payload = _payload(account.id, tag.id, name="Research unit")
    updated_payload["code"] = "RES-UNIT"
    updated = client.put(f"/api/admin/billing/entities/{created['id']}", json=updated_payload)
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Research unit"

    deactivated = client.post(f"/api/admin/billing/entities/{created['id']}/deactivate")
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["active"] is False
    active_only = client.get("/api/admin/billing/entities", params={"include_inactive": False})
    assert active_only.json() == []

    audits = (
        db_session.query(AuditLog)
        .filter(AuditLog.action.in_(("billing_entity.create", "billing_entity.update", "billing_entity.deactivate")))
        .order_by(AuditLog.id)
        .all()
    )
    assert [row.action for row in audits] == [
        "billing_entity.create",
        "billing_entity.update",
        "billing_entity.deactivate",
    ]
    metadata = json.loads(audits[0].metadata_json or "{}")
    assert metadata["include_tag_ids"] == [tag.id]
    assert metadata["explicit_include_ids"] == [account.id]
    assert all("secret" not in (row.metadata_json or "").lower() for row in audits)


def test_billing_entity_api_exposes_conflicts_in_preview(client, db_session):
    account, tag = _seed(db_session)
    first = client.post("/api/admin/billing/entities", json=_payload(account.id, tag.id, name="First"))
    assert first.status_code == 201, first.text

    second_payload = _payload(account.id, tag.id, name="Second")
    second_payload["code"] = "SECOND"
    second_payload["external_id"] = "second-external"
    preview = client.post("/api/admin/billing/entities/preview", json=second_payload)
    assert preview.status_code == 200, preview.text
    conflicts = preview.json()["conflicts"]
    assert len(conflicts) == 1
    assert conflicts[0]["subject"]["subject_id"] == account.id
    assert [entity["entity_name"] for entity in conflicts[0]["entities"]] == ["First", "Second"]


def test_billing_entity_api_requires_superadmin(client):
    previous = app.dependency_overrides.get(dependencies.get_current_super_admin)

    def deny_superadmin():
        raise HTTPException(status_code=403, detail="Superadmin required")

    app.dependency_overrides[dependencies.get_current_super_admin] = deny_superadmin
    try:
        response = client.get("/api/admin/billing/entities")
    finally:
        if previous is None:
            app.dependency_overrides.pop(dependencies.get_current_super_admin, None)
        else:
            app.dependency_overrides[dependencies.get_current_super_admin] = previous

    assert response.status_code == 403
