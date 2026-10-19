# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import base64
import json
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.db import AuditLog
from app.models.app_settings import AppSettings, BillingStatementPdfSettings
from app.services.billing_statement_pdf_service import (
    BillingStatementPdfService,
    _PdfLine,
    _PdfStatement,
)


PNG_1X1_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUB"
    "AScY42YAAAAASUVORK5CYII="
)


def test_pdf_settings_defaults_normalization_and_validation() -> None:
    settings = BillingStatementPdfSettings(
        organization_name="  Research IT  ",
        organization_details="  Platform services  ",
        accent_color=" #AABBCC ",
        statement_note="  Internal chargeback  ",
        footer_text="  storage@example.test  ",
    )
    assert settings.organization_name == "Research IT"
    assert settings.organization_details == "Platform services"
    assert settings.accent_color == "#aabbcc"
    assert settings.statement_note == "Internal chargeback"
    assert settings.footer_text == "storage@example.test"
    assert BillingStatementPdfSettings().organization_name == "BucketReef"

    with pytest.raises(ValidationError):
        BillingStatementPdfSettings(accent_color="blue")
    with pytest.raises(ValidationError):
        BillingStatementPdfSettings(logo_data_url="data:image/svg+xml;base64,PHN2Zz4=")
    with pytest.raises(ValidationError):
        BillingStatementPdfSettings(logo_data_url="data:image/png;base64,not-valid***")
    with pytest.raises(ValidationError):
        BillingStatementPdfSettings(
            logo_data_url="data:image/png;base64," + base64.b64encode(b"not-a-png").decode("ascii")
        )
    with pytest.raises(ValidationError):
        BillingStatementPdfSettings(
            logo_data_url="data:image/jpeg;base64," + base64.b64encode(b"not-a-jpeg").decode("ascii")
        )
    with pytest.raises(ValidationError):
        BillingStatementPdfSettings(
            logo_data_url="data:image/png;base64,"
            + base64.b64encode(b"\x89PNG\r\n\x1a\ncorrupted-image-body").decode("ascii")
        )

    oversized = base64.b64encode(b"x" * (512 * 1024 + 1)).decode("ascii")
    with pytest.raises(ValidationError):
        BillingStatementPdfSettings(
            logo_data_url=f"data:image/png;base64,{oversized}"
        )


def test_pdf_settings_routes_persist_preview_and_audit_without_logo_payload(
    client,
    db_session,
    monkeypatch,
) -> None:
    current = AppSettings()
    monkeypatch.setattr("app.routers.admin.billing.load_app_settings", lambda: current)

    def save_settings(payload: AppSettings) -> AppSettings:
        current.billing_statement_pdf = payload.billing_statement_pdf.model_copy(deep=True)
        return current

    monkeypatch.setattr("app.routers.admin.billing.save_app_settings", save_settings)
    payload = {
        "organization_name": "Research IT",
        "organization_details": "Infrastructure department",
        "accent_color": "#123456",
        "logo_data_url": PNG_1X1_DATA_URL,
        "statement_note": "Internal cost allocation",
        "footer_text": "storage@example.test",
    }

    updated = client.put("/api/admin/billing/pdf/settings", json=payload)
    assert updated.status_code == 200, updated.text
    assert updated.json() == payload

    loaded = client.get("/api/admin/billing/pdf/settings")
    assert loaded.status_code == 200
    assert loaded.json() == payload

    preview = client.post("/api/admin/billing/pdf/preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.headers["content-type"].startswith("application/pdf")
    assert preview.headers["content-disposition"] == 'inline; filename="billing-statement-preview.pdf"'
    assert preview.content.startswith(b"%PDF-")

    audit = (
        db_session.query(AuditLog)
        .filter_by(action="billing_statement_pdf.settings_update")
        .one()
    )
    metadata = json.loads(audit.metadata_json or "{}")
    assert metadata["after"]["has_logo"] is True
    assert PNG_1X1_DATA_URL not in (audit.metadata_json or "")
    assert "base64" not in (audit.metadata_json or "").lower()


def test_pdf_renderer_is_deterministic_and_handles_multipage_tables() -> None:
    settings = BillingStatementPdfSettings(
        organization_name="Équipe Recherche & IT",
        organization_details="Infrastructure, stockage et données — plateforme européenne",
        accent_color="#123456",
        logo_data_url=PNG_1X1_DATA_URL,
        statement_note="Répartition interne des coûts — données d’essai",
        footer_text=(
            "Infrastructure department · storage@example.test · Internal chargeback statement · "
            "Research platform · Cost center CC-001 · This deliberately long footer verifies that "
            "configured footer content is wrapped instead of being silently truncated in the PDF."
        ),
    )
    preview_a = BillingStatementPdfService.render_preview(settings)
    preview_b = BillingStatementPdfService.render_preview(settings)
    assert preview_a == preview_b
    assert preview_a.startswith(b"%PDF-")

    statement = _PdfStatement(
        public_id="multi-page",
        entity_name="Research",
        entity_code="RES",
        entity_external_id="CC-001",
        period_start=date(2026, 9, 1),
        period_end=date(2026, 9, 30),
        currency="EUR",
        total=Decimal("800.00"),
        member_count=80,
        storage_coverage=Decimal("1"),
        usage_coverage=Decimal("1"),
        quota_coverage=Decimal("1"),
        finalized_at=datetime(2026, 10, 5, 8, 30, tzinfo=timezone.utc),
        lines=tuple(
            _PdfLine(
                subject=f"Research account {index:03d}",
                endpoint="Ceph production",
                basis="Actual Usage",
                storage_quantity="10.000 GiB-month",
                rate_plan="research-standard",
                amount="10.00 EUR",
            )
            for index in range(80)
        ),
    )
    rendered = BillingStatementPdfService._render(statement, settings)
    assert rendered.startswith(b"%PDF-")
    assert rendered.count(b"/Type /Page") >= 2
