# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from pathlib import Path

from scripts.backend_sensitive_route_matrix import (
    ADMIN_AUTH,
    EXPECTED_GUARDS,
    INTERACTIVE_UI,
    RECENT_WEBAUTHN,
    collect_rows,
    render_markdown,
    validation_errors,
)


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[1]


def test_sensitive_route_matrix_classifies_every_admin_mutation():
    backend_root = _backend_root()
    rows = collect_rows(backend_root)

    assert rows
    assert validation_errors(backend_root, rows) == []
    assert len(rows) == len(EXPECTED_GUARDS)
    assert {row.observed_guard for row in rows} <= {
        RECENT_WEBAUTHN,
        INTERACTIVE_UI,
        ADMIN_AUTH,
    }


def test_sensitive_route_matrix_keeps_high_risk_routes_guarded():
    expected = {
        ("app/routers/admin/groups.py", "create_group"): RECENT_WEBAUTHN,
        ("app/routers/admin/groups.py", "update_group"): RECENT_WEBAUTHN,
        ("app/routers/admin/s3_connections.py", "create_s3_connection"): RECENT_WEBAUTHN,
        ("app/routers/admin/s3_connections.py", "update_s3_connection"): RECENT_WEBAUTHN,
        ("app/routers/admin/storage_endpoints.py", "detect_storage_endpoint_features"): INTERACTIVE_UI,
        ("app/routers/admin/storage_endpoints.py", "create_storage_endpoint"): RECENT_WEBAUTHN,
        ("app/routers/admin/storage_endpoints.py", "update_storage_endpoint"): RECENT_WEBAUTHN,
        ("app/routers/admin/users.py", "create_user"): RECENT_WEBAUTHN,
        ("app/routers/admin/users.py", "update_user"): RECENT_WEBAUTHN,
        ("app/routers/admin/settings.py", "update_settings"): RECENT_WEBAUTHN,
        ("app/routers/admin/settings.py", "delete_oidc_provider_settings"): RECENT_WEBAUTHN,
        ("app/routers/admin/settings.py", "delete_ldap_provider_settings"): RECENT_WEBAUTHN,
        ("app/routers/admin/users.py", "upload_user_avatar"): INTERACTIVE_UI,
        ("app/routers/admin/users.py", "delete_user_avatar"): INTERACTIVE_UI,
        ("app/routers/admin/webhooks.py", "create_webhook_endpoint"): RECENT_WEBAUTHN,
        ("app/routers/admin/webhooks.py", "update_webhook_endpoint"): RECENT_WEBAUTHN,
        ("app/routers/admin/webhooks.py", "delete_webhook_endpoint"): RECENT_WEBAUTHN,
        ("app/routers/admin/webhooks.py", "rotate_webhook_secret"): RECENT_WEBAUTHN,
        ("app/routers/admin/webhooks.py", "test_webhook_endpoint"): RECENT_WEBAUTHN,
    }

    assert {key: EXPECTED_GUARDS[key] for key in expected} == expected


def test_sensitive_route_matrix_propagates_local_helper_guard(tmp_path):
    routers = tmp_path / "app" / "routers" / "admin"
    routers.mkdir(parents=True)
    route_file = routers / "example.py"
    route_file.write_text(
        'router = APIRouter(prefix="/admin/example")\n'
        'def _mutate(request, db, user):\n'
        '    require_admin_sensitive_action(request, db, user)\n'
        '@router.delete("/{item_id}")\n'
        'def delete_item(item_id, current_user=Depends(get_current_ui_superadmin)):\n'
        '    return _mutate(request, db, current_user)\n'
    )

    row, = collect_rows(tmp_path)

    assert row.observed_guard == RECENT_WEBAUTHN

    route_file.write_text(
        'router = APIRouter(prefix="/admin/example")\n'
        'def _mutate(request, db, user):\n'
        '    require_admin_interactive_session(request, db, user)\n'
        '@router.delete("/{item_id}")\n'
        'def delete_item(item_id, current_user=Depends(get_current_ui_superadmin)):\n'
        '    return _mutate(request, db, current_user)\n'
    )

    row, = collect_rows(tmp_path)

    assert row.observed_guard == INTERACTIVE_UI


def test_sensitive_route_matrix_report_is_ci_readable():
    report = render_markdown(_backend_root())

    assert "# Backend sensitive-route security matrix" in report
    assert "Recent WebAuthn routes:" in report
    assert "Interactive UI routes:" in report
    assert "Admin-auth routes:" in report
    assert "Contract errors: 0" in report
    assert "`/admin/storage-endpoints/detect-features`" in report
    assert "`app/routers/admin/groups.py::update_group`" in report
