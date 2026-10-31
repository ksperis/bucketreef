# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from pathlib import Path

import pytest

from scripts.backend_audit_matrix import (
    ALLOWLISTED_UNAUDITED_ROUTES,
    SIGNAL_FIELDS,
    RouteAuditRow,
    collect_rows,
    render_markdown,
)


def test_backend_audit_matrix_collects_mutating_routes():
    backend_root = Path(__file__).resolve().parents[1]

    rows = collect_rows(backend_root)

    assert rows
    assert any(row.method == "POST" and row.file.name == "auth_local.py" for row in rows)
    assert all(row.method in {"POST", "PUT", "PATCH", "DELETE"} for row in rows)


def test_backend_audit_matrix_renders_summary_sections():
    backend_root = Path(__file__).resolve().parents[1]

    report = render_markdown(backend_root)

    assert "# Backend mutating-route audit matrix" in report
    assert "## Routes without static audit signal" in report
    assert "## Allowlisted Routes Without Audit Signal" in report
    assert "## Full mutating route matrix" in report
    assert "Allowlisted routes without static audit signal" in report
    assert "Direct audit" in report


def test_backend_audit_matrix_does_not_treat_context_fields_as_audit_signals():
    signals = {name: False for name in SIGNAL_FIELDS}
    signals.update(
        {
            "audit_service": True,
            "actor": True,
            "scope": True,
            "entity_type": True,
            "entity_id": True,
            "account": True,
            "metadata": True,
        }
    )
    row = RouteAuditRow(
        file=Path("app/routers/example.py"),
        function="mutate_without_audit",
        method="POST",
        path="/example",
        signals=signals,
    )

    assert row.has_audit_signal is False
    signals["delegated_browser_audit"] = True
    assert row.has_audit_signal is True


def test_backend_audit_matrix_allowlist_entries_exist_without_audit_signals():
    backend_root = Path(__file__).resolve().parents[1]

    rows = collect_rows(backend_root)
    by_key = {
        (row.method, str(row.file.relative_to(backend_root)), row.function, row.path): row
        for row in rows
    }

    for key, reason in ALLOWLISTED_UNAUDITED_ROUTES.items():
        row = by_key.get(key)
        assert row is not None, key
        assert not row.has_audit_signal, key
        assert row.allowlist_reason(backend_root) == reason


def test_backend_audit_matrix_tracks_portal_stream_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    rows_by_function = {row.function: row for row in collect_rows(backend_root)}

    assert rows_by_function["portal_restore_deleted_prefix_stream"].file.relative_to(backend_root) == Path(
        "app/routers/portal_objects.py"
    )
    assert rows_by_function["portal_restore_deleted_prefix_stream"].signals[
        "delegated_portal_deleted_restore_audit"
    ]
    assert rows_by_function["portal_storage_space_version_cleanup_stream"].signals[
        "delegated_portal_version_cleanup_audit"
    ]



def test_backend_audit_matrix_tracks_manager_bucket_config_mutation_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    rows_by_function = {row.function: row for row in collect_rows(backend_root)}

    assert rows_by_function["put_bucket_encryption"].file.relative_to(backend_root) == Path(
        "app/routers/manager/bucket_config_core.py"
    )
    assert rows_by_function["put_bucket_encryption"].signals["delegated_bucket_config_mutation_audit"]
    assert rows_by_function["delete_bucket_encryption"].signals["delegated_bucket_config_mutation_audit"]


def test_backend_audit_matrix_tracks_bucket_migration_maintenance_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    rows_by_function = {row.function: row for row in collect_rows(backend_root)}

    for function in ("cleanup_source", "cleanup_target", "restore_access"):
        assert rows_by_function[function].signals[
            "delegated_bucket_migration_maintenance_audit"
        ]


def test_backend_audit_matrix_tracks_access_key_expiration_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    row = next(
        row
        for row in collect_rows(backend_root)
        if row.function == "run_access_key_expirations"
        and row.file.relative_to(backend_root)
        == Path("app/routers/internal/access_key_expirations.py")
    )

    assert row.signals["delegated_access_key_expiration_audit"]


def test_backend_audit_matrix_tracks_managed_private_access_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    rows = {
        (row.file.relative_to(backend_root), row.function): row
        for row in collect_rows(backend_root)
    }

    for key in (
        (Path("app/routers/manager/private_access.py"), "create_iam_private_access"),
        (Path("app/routers/manager/private_access.py"), "create_rgw_user_private_access"),
        (Path("app/routers/manager/private_access.py"), "retry_private_access_cleanup"),
        (
            Path("app/routers/manager/private_access.py"),
            "retry_private_access_provisioning_cleanup",
        ),
        (Path("app/routers/connections.py"), "delete_connection"),
    ):
        assert rows[key].signals["delegated_private_access_audit"]


@pytest.mark.parametrize(
    ("service_name", "method"),
    [
        ("ManagedPrivateAccessService", "future_mutation"),
        ("ManagedPrivateAccessCleanupService", "future_mutation"),
    ],
)
def test_private_access_service_reference_alone_does_not_imply_audit(
    tmp_path,
    service_name,
    method,
):
    routers = tmp_path / "app" / "routers"
    routers.mkdir(parents=True)
    (routers / "example.py").write_text(
        '@router.post("/example")\n'
        'def example():\n'
        f'    return {service_name}(db).{method}(user=user)\n'
    )

    row, = collect_rows(tmp_path)

    assert not row.signals["delegated_private_access_audit"]
    assert not row.has_audit_signal


def test_backend_audit_matrix_tracks_auth_attempt_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    rows = {
        (row.file.name, row.function): row
        for row in collect_rows(backend_root)
        if row.file.name in {"auth_local.py", "auth_ldap.py", "auth_oidc.py", "auth_identity_link.py", "auth_s3.py"}
    }

    for key in (
        ("auth_local.py", "login"),
        ("auth_ldap.py", "login_with_ldap"),
        ("auth_oidc.py", "complete_oidc_login"),
        ("auth_identity_link.py", "external_identity_link_password_proof"),
        ("auth_identity_link.py", "external_identity_link_ldap_proof"),
        ("auth_s3.py", "login_with_s3_keys"),
    ):
        assert rows[key].signals["delegated_auth_attempt_audit"]


def test_backend_audit_matrix_tracks_manager_iam_role_update_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    row = next(
        row
        for row in collect_rows(backend_root)
        if row.function == "update_role"
        and row.file.relative_to(backend_root)
        == Path("app/routers/manager/iam_roles.py")
    )

    assert row.signals["delegated_manager_iam_role_update_audit"]


def test_manager_iam_role_audit_signal_requires_exact_helper(tmp_path):
    routers = tmp_path / "app" / "routers"
    routers.mkdir(parents=True)
    (routers / "example.py").write_text(
        '@router.patch("/example")\n'
        'def example():\n'
        '    return future_update_iam_role(service, role_name, payload)\n'
    )

    row, = collect_rows(tmp_path)

    assert not row.signals["delegated_manager_iam_role_update_audit"]
    assert not row.has_audit_signal


@pytest.mark.parametrize(
    ("relative_file", "functions", "signal"),
    [
        (
            "app/routers/admin/settings.py",
            ("delete_oidc_provider_settings", "delete_ldap_provider_settings"),
            "delegated_admin_identity_provider_delete_audit",
        ),
        (
            "app/routers/manager/iam_groups.py",
            ("delete_group_inline_policy", "detach_group_policy"),
            "delegated_manager_iam_mutation_audit",
        ),
        (
            "app/routers/manager/iam_roles.py",
            ("delete_role_inline_policy", "detach_role_policy"),
            "delegated_manager_iam_mutation_audit",
        ),
        (
            "app/routers/manager/iam_users.py",
            ("delete_user_inline_policy", "detach_user_policy"),
            "delegated_manager_iam_mutation_audit",
        ),
        (
            "app/routers/manager/migrations_actions.py",
            (
                "start_migration",
                "pause_migration",
                "resume_migration",
                "stop_migration",
                "continue_after_presync",
            ),
            "delegated_bucket_migration_action_audit",
        ),
    ],
)
def test_backend_audit_matrix_tracks_shared_audit_helpers(relative_file, functions, signal):
    backend_root = Path(__file__).resolve().parents[1]
    rows = {
        row.function: row
        for row in collect_rows(backend_root)
        if row.file.relative_to(backend_root) == Path(relative_file)
    }

    for function in functions:
        assert rows[function].signals[signal]


@pytest.mark.parametrize(
    ("helper_name", "signal"),
    [
        (
            "_delete_identity_provider_settings",
            "delegated_admin_identity_provider_delete_audit",
        ),
        ("run_audited_iam_mutation", "delegated_manager_iam_mutation_audit"),
        ("_run_migration_action", "delegated_bucket_migration_action_audit"),
    ],
)
def test_shared_audit_signal_requires_exact_helper(tmp_path, helper_name, signal):
    routers = tmp_path / "app" / "routers"
    routers.mkdir(parents=True)
    (routers / "example.py").write_text(
        '@router.post("/example")\n'
        'def example():\n'
        f'    return future{helper_name}()\n'
    )

    row, = collect_rows(tmp_path)

    assert not row.signals[signal]
    assert not row.has_audit_signal


def test_backend_audit_matrix_tracks_ceph_admin_bucket_ui_tag_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    row = next(
        row
        for row in collect_rows(backend_root)
        if row.function == "patch_bucket_ui_tags"
        and row.file.relative_to(backend_root)
        == Path("app/routers/ceph_admin/bucket_ui_tags.py")
    )

    assert row.signals["delegated_ceph_admin_bucket_ui_tags_audit"]


def test_backend_audit_matrix_tracks_ceph_admin_user_key_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    rows = {
        row.function: row
        for row in collect_rows(backend_root)
        if row.file.relative_to(backend_root) == Path("app/routers/ceph_admin/user_keys.py")
    }

    for function in (
        "create_rgw_user_key",
        "update_rgw_user_key_status",
        "delete_rgw_user_key",
    ):
        assert rows[function].signals["delegated_ceph_admin_user_key_audit"]


@pytest.mark.parametrize("method", ["list_keys", "future_mutation"])
def test_ceph_admin_user_key_service_reference_alone_does_not_imply_audit(tmp_path, method):
    routers = tmp_path / "app" / "routers"
    routers.mkdir(parents=True)
    (routers / "example.py").write_text(
        '@router.post("/example")\n'
        'def example():\n'
        f'    return CephAdminUserKeyService(ctx, db).{method}("user")\n'
    )
    row, = collect_rows(tmp_path)
    assert not row.has_audit_signal
    assert row.allowlist_reason(tmp_path) is None


def test_backend_audit_matrix_classifies_every_mutating_route():
    backend_root = Path(__file__).resolve().parents[1]

    unclassified = [
        row
        for row in collect_rows(backend_root)
        if not row.has_audit_signal and not row.allowlist_reason(backend_root)
    ]

    assert unclassified == []


def test_backend_audit_matrix_tracks_audited_bucket_purge_wrapper(tmp_path):
    routers = tmp_path / "app" / "routers"
    routers.mkdir(parents=True)
    (routers / "example.py").write_text(
        '@router.post("/purge")\n'
        'def purge():\n'
        '    return stream_audited_bucket_purge(request, user=user, scope="manager", base_metadata={}, run_purge=run)\n'
    )
    row, = collect_rows(tmp_path)
    assert row.signals["delegated_purge_stream"]
    assert row.has_audit_signal


def test_backend_audit_matrix_tracks_only_audited_onboarding_routes():
    backend_root = Path(__file__).resolve().parents[1]
    rows = {
        row.function: row
        for row in collect_rows(backend_root)
        if row.file.relative_to(backend_root) == Path("app/routers/admin/onboarding.py")
    }
    assert len(rows) == 5
    preview = rows.pop("preview_onboarding")
    assert not preview.has_audit_signal
    assert preview.allowlist_reason(backend_root) == "read-only onboarding configuration preview"
    assert all(row.signals["delegated_onboarding_audit"] for row in rows.values())


@pytest.mark.parametrize("method", ["preview_draft", "status", "future_mutation"])
def test_onboarding_service_reference_alone_does_not_imply_audit(tmp_path, method):
    routers = tmp_path / "app" / "routers"
    routers.mkdir(parents=True)
    (routers / "example.py").write_text(
        f'@router.post("/example")\n'
        f'def example():\n'
        f'    return _run(lambda: OnboardingService(db).{method}(current_user))\n'
    )
    row, = collect_rows(tmp_path)
    assert not row.has_audit_signal
    assert row.allowlist_reason(tmp_path) is None
