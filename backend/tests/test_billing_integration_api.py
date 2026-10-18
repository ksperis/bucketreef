from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.security import get_password_hash
from app.db import (
    BillingEntity,
    BillingEntityGroup,
    BillingEntityGroupMembership,
    BillingStatement,
    BillingStatementLine,
    User,
    UserRole,
)
from app.main import app
from app.models.app_settings import AppSettings
from app.models.billing import (
    BillingAnalysisCoverage,
    BillingCoverage,
    BillingRateResolutionExplanation,
    BillingStatementComponentAmounts,
    BillingStatementLineSnapshot,
    BillingStatementUnitPrices,
    BillingStorageChargeQuantity,
    BillingStorageTotals,
    BillingUsageTotals,
)
from app.routers import dependencies
from app.services import billing_integration_service as integration_module
from app.utils.time import utcnow
from tests.auth_test_utils import authenticate_ui_client, clear_ui_client, trusted_origin_headers


@pytest.fixture
def integration_client(db_session, monkeypatch):
    def override_get_db():
        yield db_session

    settings = AppSettings()
    settings.general.billing_enabled = True
    monkeypatch.setattr(integration_module, "load_app_settings_for_db", lambda _db: settings)
    app.dependency_overrides[dependencies.get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}


def _create_admin(db_session, *, email: str = "billing-integration-admin@example.com") -> User:
    user = User(
        email=email,
        full_name="Billing Integration Admin",
        hashed_password=get_password_hash("supersecret"),
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _issue_token(client: TestClient, db_session, admin: User, *, scope: str) -> str:
    credentials = authenticate_ui_client(client, db_session, admin)
    response = client.post(
        "/api/auth/api-tokens",
        json={"name": f"integration-{scope}", "expires_in_days": 30, "scopes": [scope]},
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    clear_ui_client(client)
    return token


def _entity(db_session, name: str, external_id: str) -> BillingEntity:
    row = BillingEntity(
        name=name,
        code=name.upper(),
        external_id=external_id,
        subject_type="account",
        active=True,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(row)
    db_session.flush()
    return row


def _statement(
    db_session,
    entity: BillingEntity,
    month: date,
    *,
    total: str,
    status: str = "finalized",
    currency: str = "EUR",
    basis: str = "actual_usage",
) -> BillingStatement:
    amount = Decimal(total)
    now = utcnow()
    coverage = BillingAnalysisCoverage(
        member_count=1,
        expected_daily_observations=monthrange(month.year, month.month)[1],
        storage_observations=monthrange(month.year, month.month)[1],
        usage_observations=monthrange(month.year, month.month)[1],
        storage_coverage_ratio=Decimal("1"),
        usage_coverage_ratio=Decimal("1"),
        quota_observations_collected=(monthrange(month.year, month.month)[1] if basis == "allocated_quota" else 0),
        quota_observations_expected=(monthrange(month.year, month.month)[1] if basis == "allocated_quota" else 0),
        quota_coverage_ratio=(Decimal("1") if basis == "allocated_quota" else None),
    )
    row = BillingStatement(
        public_id=str(uuid4()),
        billing_entity_id=entity.id,
        billing_entity_name=entity.name,
        billing_entity_code=entity.code,
        billing_entity_external_id=entity.external_id,
        subject_type="account",
        period_start=month,
        period_end=date(month.year, month.month, monthrange(month.year, month.month)[1]),
        currency=currency,
        status=status,
        member_count=1,
        coverage_json=coverage.model_dump_json(),
        blockers_json="[]",
        storage_charge_bases_json=f'["{basis}"]',
        subtotal=amount,
        total=amount,
        source_fingerprint=(str(entity.id) * 64)[:64],
        revision=1,
        generated_at=now,
        finalized_at=now if status == "finalized" else None,
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.flush()
    days = monthrange(month.year, month.month)[1]
    snapshot = BillingStatementLineSnapshot(
        subject_type="account",
        subject_id=entity.id,
        subject_name=f"Subject {entity.name}",
        rgw_identifier=f"RGW-{entity.id}",
        membership_reasons=[],
        membership_conflict=False,
        included_in_total=True,
        storage_endpoint_id=10 + entity.id,
        storage_endpoint_name=f"Endpoint {entity.id}",
        usage=BillingUsageTotals(bytes_in=1024, bytes_out=2048, ops_total=30),
        storage=BillingStorageTotals(
            avg_bytes=1024**3,
            avg_gb_month=Decimal("1.250000"),
            total_objects=2,
        ),
        coverage=BillingCoverage(
            days_collected=days,
            days_in_month=days,
            coverage_ratio=1,
            storage_days_collected=days,
            usage_days_collected=days,
        ),
        storage_charge_basis=basis,
        priced_storage_quantity=BillingStorageChargeQuantity(
            basis=basis,
            quantity_gib_month=Decimal("2.500000") if basis == "allocated_quota" else Decimal("1.250000"),
            observations_collected=days,
            observations_expected=days,
            calendar_days=days,
            coverage_ratio=Decimal("1"),
            status="complete",
            issues=[],
        ),
        rate_resolution=BillingRateResolutionExplanation(
            status="resolved",
            layer="billing_entity",
            rate_plan_id=100 + entity.id,
            rate_plan_name=f"Plan {entity.id}",
            rate_card_id=200 + entity.id,
            rate_card_effective_from=month,
            billing_entity_id=entity.id,
            billing_entity_name=entity.name,
            currency=currency,
            storage_charge_basis=basis,
        ),
        unit_prices=BillingStatementUnitPrices(storage_gb_month_price=Decimal("1.000000")),
        amounts=BillingStatementComponentAmounts(storage_cost=amount, total_cost=amount),
        complete=True,
        issues=[],
    )
    db_session.add(
        BillingStatementLine(
            billing_statement_id=row.id,
            line_index=1,
            subject_type="account",
            subject_id=entity.id,
            subject_name=f"Subject {entity.name}",
            rgw_identifier=f"RGW-{entity.id}",
            storage_endpoint_id=10 + entity.id,
            storage_endpoint_name=f"Endpoint {entity.id}",
            currency=currency,
            storage_charge_basis=basis,
            total_cost=amount,
            complete=True,
            snapshot_json=snapshot.model_dump_json(),
            created_at=now,
        )
    )
    db_session.commit()
    db_session.refresh(row)
    return row


def _seed_contract(db_session):
    research = _entity(db_session, "research", "erp-research")
    platform = _entity(db_session, "platform", "erp-platform")
    group = BillingEntityGroup(
        name="DSI",
        code="DSI",
        external_id="erp-dsi",
        description="Infrastructure scope",
        active=True,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(group)
    db_session.flush()
    db_session.add_all(
        [
            BillingEntityGroupMembership(
                billing_entity_group_id=group.id,
                billing_entity_id=research.id,
                effective_from=date(2026, 1, 1),
                effective_to=date(2026, 1, 31),
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
            BillingEntityGroupMembership(
                billing_entity_group_id=group.id,
                billing_entity_id=platform.id,
                effective_from=date(2026, 2, 1),
                effective_to=None,
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
        ]
    )
    db_session.commit()
    january = _statement(db_session, research, date(2026, 1, 1), total="10", basis="actual_usage")
    february = _statement(db_session, platform, date(2026, 2, 1), total="20", basis="allocated_quota")
    draft = _statement(db_session, research, date(2026, 3, 1), total="30", status="draft")
    return research, platform, group, january, february, draft


def test_billing_integration_v1_exposes_finalized_contract_and_historical_groups(
    integration_client,
    db_session,
):
    research, platform, group, january, february, draft = _seed_contract(db_session)
    admin = _create_admin(db_session)
    token = _issue_token(integration_client, db_session, admin, scope="billing:read")
    headers = {"Authorization": f"Bearer {token}"}

    entities = integration_client.get("/api/integrations/billing/v1/entities", headers=headers)
    assert entities.status_code == 200, entities.text
    assert entities.json() == [
        {
            "id": platform.id,
            "name": "platform",
            "code": "PLATFORM",
            "external_id": "erp-platform",
            "subject_type": "account",
            "active": True,
        },
        {
            "id": research.id,
            "name": "research",
            "code": "RESEARCH",
            "external_id": "erp-research",
            "subject_type": "account",
            "active": True,
        },
    ]

    january_groups = integration_client.get(
        "/api/integrations/billing/v1/groups",
        params={"month": "2026-01"},
        headers=headers,
    )
    assert january_groups.status_code == 200, january_groups.text
    payload = january_groups.json()[0]
    assert payload["external_id"] == "erp-dsi"
    assert payload["membership_month"] == "2026-01"
    assert [item["billing_entity_id"] for item in payload["memberships"]] == [research.id]

    february_groups = integration_client.get(
        "/api/integrations/billing/v1/groups",
        params={"month": "2026-02"},
        headers=headers,
    )
    assert [item["billing_entity_id"] for item in february_groups.json()[0]["memberships"]] == [platform.id]

    entity_cost = integration_client.get(
        f"/api/integrations/billing/v1/entities/{research.id}/costs",
        params={"period": "month", "month": "2026-01"},
        headers=headers,
    )
    assert entity_cost.status_code == 200, entity_cost.text
    cost = entity_cost.json()
    assert cost["period_type"] == "month"
    assert cost["complete"] is True
    assert cost["currency_totals"][0]["total"] == "10.000000"
    assert cost["currency_totals"][0]["statement_public_ids"] == [january.public_id]
    assert cost["currency_totals"][0]["storage_charge_bases"] == ["actual_usage"]

    annual_cost = integration_client.get(
        f"/api/integrations/billing/v1/entities/{research.id}/costs",
        params={"period": "year", "year": 2026},
        headers=headers,
    )
    assert annual_cost.status_code == 200, annual_cost.text
    annual_payload = annual_cost.json()
    assert annual_payload["period_type"] == "year"
    assert annual_payload["start_month"] == "2026-01"
    assert annual_payload["end_month"] == "2026-12"
    assert len(annual_payload["expected_months"]) == 12
    assert annual_payload["complete"] is False
    assert annual_payload["currency_totals"][0]["total"] == "10.000000"

    group_cost = integration_client.get(
        f"/api/integrations/billing/v1/groups/{group.id}/costs",
        params={"period": "range", "start_month": "2026-01", "end_month": "2026-02"},
        headers=headers,
    )
    assert group_cost.status_code == 200, group_cost.text
    group_payload = group_cost.json()
    assert group_payload["complete"] is True
    assert group_payload["expected_months"] == ["2026-01", "2026-02"]
    assert [month["member_entity_ids"] for month in group_payload["months"]] == [
        [research.id],
        [platform.id],
    ]
    assert {item["currency"]: item["total"] for item in group_payload["currency_totals"]} == {
        "EUR": "30.000000",
    }
    assert group_payload["currency_totals"][0]["storage_charge_bases"] == [
        "actual_usage",
        "allocated_quota",
    ]

    statements = integration_client.get(
        "/api/integrations/billing/v1/statements",
        params={"start_month": "2026-01", "end_month": "2026-03"},
        headers=headers,
    )
    assert statements.status_code == 200, statements.text
    statement_payload = statements.json()
    assert [item["statement_public_id"] for item in statement_payload["items"]] == [
        february.public_id,
        january.public_id,
    ]
    assert draft.public_id not in {item["statement_public_id"] for item in statement_payload["items"]}
    assert "finalized_by_user_email" not in statement_payload["items"][0]

    detail = integration_client.get(
        f"/api/integrations/billing/v1/statements/{february.public_id}",
        headers=headers,
    )
    assert detail.status_code == 200, detail.text
    line = detail.json()["lines"][0]
    assert line["storage_charge_basis"] == "allocated_quota"
    assert line["priced_storage_quantity"]["quantity_gib_month"] == "2.500000"
    assert line["storage"]["measured_gib_month"] == "1.250000"
    assert line["rate_resolution"]["layer"] == "billing_entity"
    assert line["unit_prices"]["storage_gb_month_price"] == "1.000000"

    missing_draft = integration_client.get(
        f"/api/integrations/billing/v1/statements/{draft.public_id}",
        headers=headers,
    )
    assert missing_draft.status_code == 404


def test_billing_integration_v1_cursor_exports_and_period_validation(integration_client, db_session):
    research, _platform, _group, january, february, _draft = _seed_contract(db_session)
    admin = _create_admin(db_session, email="billing-pagination@example.com")
    token = _issue_token(integration_client, db_session, admin, scope="billing:read")
    headers = {"Authorization": f"Bearer {token}"}

    first = integration_client.get(
        "/api/integrations/billing/v1/statements",
        params={"limit": 1},
        headers=headers,
    )
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert first_payload["items"][0]["statement_public_id"] == february.public_id
    assert first_payload["has_more"] is True
    assert first_payload["next_cursor"]

    second = integration_client.get(
        "/api/integrations/billing/v1/statements",
        params={"limit": 1, "cursor": first_payload["next_cursor"]},
        headers=headers,
    )
    assert second.status_code == 200, second.text
    assert second.json()["items"][0]["statement_public_id"] == january.public_id
    assert second.json()["has_more"] is False

    replayed = integration_client.get(
        "/api/integrations/billing/v1/statements",
        params={"limit": 1, "cursor": first_payload["next_cursor"]},
        headers=headers,
    )
    assert replayed.json() == second.json()

    filtered = integration_client.get(
        "/api/integrations/billing/v1/statements",
        params={"billing_entity_external_id": research.external_id},
        headers=headers,
    )
    assert [item["statement_public_id"] for item in filtered.json()["items"]] == [january.public_id]

    invalid_cursor = integration_client.get(
        "/api/integrations/billing/v1/statements",
        params={"cursor": "not-a-cursor"},
        headers=headers,
    )
    assert invalid_cursor.status_code == 400
    assert invalid_cursor.json()["detail"] == "Invalid pagination cursor"

    invalid_period = integration_client.get(
        f"/api/integrations/billing/v1/entities/{research.id}/costs",
        params={"period": "month", "month": "2026-01", "year": 2026},
        headers=headers,
    )
    assert invalid_period.status_code == 400
    assert invalid_period.json()["detail"] == "period=month requires only the month parameter"

    json_export = integration_client.get(
        f"/api/integrations/billing/v1/statements/{january.public_id}/export.json",
        headers=headers,
    )
    assert json_export.status_code == 200
    assert json_export.json()["statement_public_id"] == january.public_id
    assert "finalized_by_user_email" not in json_export.json()

    csv_export = integration_client.get(
        f"/api/integrations/billing/v1/statements/{january.public_id}/export.csv",
        headers=headers,
    )
    assert csv_export.status_code == 200
    assert csv_export.headers["content-type"].startswith("text/csv")
    assert "priced_storage_gib_month" in csv_export.text
    assert january.public_id in csv_export.text


def test_billing_integration_token_is_least_privilege_and_ui_session_is_rejected(
    integration_client,
    db_session,
):
    _seed_contract(db_session)
    admin = _create_admin(db_session, email="billing-security@example.com")

    authenticate_ui_client(integration_client, db_session, admin)
    ui_only = integration_client.get("/api/integrations/billing/v1/entities")
    assert ui_only.status_code == 401
    assert ui_only.json()["detail"] == "API token required"
    clear_ui_client(integration_client)

    billing_token = _issue_token(integration_client, db_session, admin, scope="billing:read")
    billing_headers = {"Authorization": f"Bearer {billing_token}"}
    allowed = integration_client.get("/api/integrations/billing/v1/entities", headers=billing_headers)
    assert allowed.status_code == 200

    admin_route = integration_client.get("/api/admin/users/minimal", headers=billing_headers)
    assert admin_route.status_code == 403
    assert admin_route.json()["detail"] == "API token scope is insufficient"

    secret_route = integration_client.get("/api/browser/sts/credentials", headers=billing_headers)
    assert secret_route.status_code == 403
    assert secret_route.json()["detail"] == "API tokens are not allowed for this route"

    admin_token = _issue_token(integration_client, db_session, admin, scope="admin:read")
    integration_with_admin_scope = integration_client.get(
        "/api/integrations/billing/v1/entities",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert integration_with_admin_scope.status_code == 403
    assert integration_with_admin_scope.json()["detail"] == "API token scope is insufficient"


def test_billing_integration_v1_openapi_surface_is_versioned_and_read_only(integration_client):
    schema = integration_client.get("/openapi.json").json()
    prefix = "/api/integrations/billing/v1"
    expected = {
        f"{prefix}/entities",
        f"{prefix}/groups",
        f"{prefix}/entities/{{entity_id}}/costs",
        f"{prefix}/groups/{{group_id}}/costs",
        f"{prefix}/statements",
        f"{prefix}/statements/{{public_id}}",
        f"{prefix}/statements/{{public_id}}/export.json",
        f"{prefix}/statements/{{public_id}}/export.csv",
    }
    paths = {path for path in schema["paths"] if path.startswith(prefix)}
    assert paths == expected
    assert all(set(schema["paths"][path]) == {"get"} for path in paths)
