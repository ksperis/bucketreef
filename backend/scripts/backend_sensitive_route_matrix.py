#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import argparse
import ast
from dataclasses import dataclass
from pathlib import Path
import sys


MUTATING_METHODS = {"post", "put", "patch", "delete"}
RECENT_WEBAUTHN = "recent_webauthn"
INTERACTIVE_UI = "interactive_ui"
ADMIN_AUTH = "admin_auth"


def _entries(file_name: str, guard: str, *functions: str) -> dict[tuple[str, str], str]:
    relative_file = f"app/routers/admin/{file_name}"
    return {(relative_file, function): guard for function in functions}


# This is a deliberate policy inventory, not a derived allowlist. Every Admin
# mutation must be reviewed and added here. CI rejects missing/stale entries and
# any drift between the expected guard and the route implementation.
EXPECTED_GUARDS: dict[tuple[str, str], str] = {
    **_entries("billing.py", ADMIN_AUTH, "billing_collect_daily"),
    **_entries("groups.py", RECENT_WEBAUTHN, "create_group", "update_group"),
    **_entries(
        "groups.py",
        ADMIN_AUTH,
        "upload_group_avatar",
        "delete_group_avatar",
        "delete_group",
    ),
    **_entries("healthchecks.py", ADMIN_AUTH, "run_healthchecks"),
    **_entries(
        "identity_security.py",
        RECENT_WEBAUTHN,
        "reset_user_mfa",
        "set_user_password",
        "add_user_external_identity",
        "revoke_user_external_identity",
        "restore_user_external_identity",
        "decide_identity_link_request",
    ),
    **_entries(
        "identity_security.py",
        INTERACTIVE_UI,
        "revoke_user_session",
        "revoke_global_session",
    ),
    **_entries("key_rotation.py", ADMIN_AUTH, "rotate_keys"),
    **_entries(
        "onboarding.py",
        ADMIN_AUTH,
        "dismiss_onboarding",
        "preview_onboarding",
        "resume_onboarding",
    ),
    **_entries("onboarding.py", INTERACTIVE_UI, "save_onboarding_journey"),
    **_entries("onboarding.py", RECENT_WEBAUTHN, "apply_onboarding_journey"),
    **_entries(
        "portal_requests.py",
        ADMIN_AUTH,
        "approve_admin_portal_request",
        "reject_admin_portal_request",
        "add_admin_portal_request_message",
    ),
    **_entries(
        "s3_accounts.py",
        ADMIN_AUTH,
        "update_account_portal_settings",
        "create_account",
        "import_accounts",
        "update_account",
        "delete_account",
    ),
    **_entries(
        "s3_connections.py",
        ADMIN_AUTH,
        "validate_s3_connection_credentials",
        "delete_s3_connection",
    ),
    **_entries(
        "s3_connections.py",
        RECENT_WEBAUTHN,
        "create_s3_connection",
        "update_s3_connection",
    ),
    **_entries(
        "s3_users.py",
        ADMIN_AUTH,
        "create_s3_user",
        "import_s3_users",
        "update_s3_user",
        "rotate_s3_user_keys",
        "create_s3_user_access_key",
        "update_s3_user_access_key_status",
        "delete_s3_user_access_key",
        "delete_s3_user",
    ),
    **_entries(
        "settings.py",
        RECENT_WEBAUTHN,
        "update_settings",
        "create_oidc_provider_settings",
        "update_oidc_provider_settings",
        "delete_oidc_provider_settings",
        "create_ldap_provider_settings",
        "update_ldap_provider_settings",
        "delete_ldap_provider_settings",
    ),
    **_entries("settings.py", INTERACTIVE_UI, "send_quota_notifications_test_email"),
    **_entries("storage_endpoints.py", INTERACTIVE_UI, "detect_storage_endpoint_features"),
    **_entries(
        "storage_endpoints.py",
        RECENT_WEBAUTHN,
        "create_storage_endpoint",
        "update_storage_endpoint",
    ),
    **_entries(
        "storage_endpoints.py",
        INTERACTIVE_UI,
        "update_storage_endpoint_tags",
        "set_default_storage_endpoint",
        "delete_storage_endpoint",
    ),
    **_entries("usage_history.py", ADMIN_AUTH, "collect_usage_history"),
    **_entries("usage_stats.py", ADMIN_AUTH, "stream_admin_managed_usage_stats_aggregate"),
    **_entries("users.py", RECENT_WEBAUTHN, "create_user", "update_user", "delete_user"),
    **_entries("users.py", ADMIN_AUTH, "upload_user_avatar", "delete_user_avatar"),
    **_entries(
        "webhooks.py",
        RECENT_WEBAUTHN,
        "create_webhook_endpoint",
        "update_webhook_endpoint",
        "delete_webhook_endpoint",
        "rotate_webhook_secret",
        "test_webhook_endpoint",
    ),
}


ROUTE_NOTES: dict[tuple[str, str], str] = {
    ("app/routers/admin/groups.py", "create_group"): "step-up only when creation carries effective access",
    ("app/routers/admin/groups.py", "update_group"): "step-up only when effective access/security state changes",
    ("app/routers/admin/identity_security.py", "decide_identity_link_request"): "approval steps up; rejection is defensive",
    ("app/routers/admin/identity_security.py", "revoke_user_session"): "defensive session revocation",
    ("app/routers/admin/identity_security.py", "revoke_global_session"): "defensive session revocation",
    ("app/routers/admin/onboarding.py", "save_onboarding_journey"): "draft persistence only; apply is separately protected",
    ("app/routers/admin/s3_connections.py", "update_s3_connection"): "step-up only for access, credential, target, reactivation, or remediation changes",
    ("app/routers/admin/storage_endpoints.py", "detect_storage_endpoint_features"): "UI-only probe prevents stored credential pivot via API token",
    ("app/routers/admin/storage_endpoints.py", "update_storage_endpoint_tags"): "tag-only mutation",
    ("app/routers/admin/users.py", "update_user"): "step-up only when identity or effective access changes",
}


@dataclass(frozen=True)
class RouteSecurityRow:
    file: Path
    function: str
    method: str
    path: str
    full_path: str
    observed_guard: str

    def key(self, backend_root: Path) -> tuple[str, str]:
        return str(self.file.relative_to(backend_root)), self.function


def _router_prefix(tree: ast.AST) -> str:
    for node in getattr(tree, "body", []):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == "router" for target in targets):
            continue
        value = node.value
        if not isinstance(value, ast.Call):
            continue
        if not (
            isinstance(value.func, ast.Name) and value.func.id == "APIRouter"
        ):
            continue
        for keyword in value.keywords:
            if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant):
                return str(keyword.value.value or "")
    return ""


def _decorator_route(decorator: ast.AST) -> tuple[str, str] | None:
    if not isinstance(decorator, ast.Call):
        return None
    func = decorator.func
    if not isinstance(func, ast.Attribute):
        return None
    method = func.attr.lower()
    if method not in MUTATING_METHODS:
        return None
    if not isinstance(func.value, ast.Name) or func.value.id != "router":
        return None
    if decorator.args and isinstance(decorator.args[0], ast.Constant):
        return method.upper(), str(decorator.args[0].value or "")
    return method.upper(), ""


def _observed_guard(body: str) -> str:
    if "require_admin_sensitive_action(" in body:
        return RECENT_WEBAUTHN
    if "require_admin_interactive_session(" in body or "get_current_ui_superadmin" in body:
        return INTERACTIVE_UI
    if "get_current_super_admin" in body:
        return ADMIN_AUTH
    return "missing"


def _join_route(prefix: str, path: str) -> str:
    if not prefix:
        return path or "/"
    if not path:
        return prefix or "/"
    return f"{prefix.rstrip('/')}/{path.lstrip('/')}"


def collect_rows(backend_root: Path) -> list[RouteSecurityRow]:
    routers_root = backend_root / "app" / "routers" / "admin"
    rows: list[RouteSecurityRow] = []
    for file_path in sorted(routers_root.glob("*.py")):
        source = file_path.read_text(encoding="utf-8", errors="ignore")
        tree = ast.parse(source, filename=str(file_path))
        prefix = _router_prefix(tree)
        lines = source.splitlines()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            routes = [route for decorator in node.decorator_list if (route := _decorator_route(decorator))]
            if not routes:
                continue
            end_lineno = getattr(node, "end_lineno", node.lineno)
            body = "\n".join(lines[node.lineno - 1 : end_lineno])
            guard = _observed_guard(body)
            for method, path in routes:
                rows.append(
                    RouteSecurityRow(
                        file=file_path,
                        function=node.name,
                        method=method,
                        path=path,
                        full_path=_join_route(prefix, path),
                        observed_guard=guard,
                    )
                )
    return sorted(rows, key=lambda row: (str(row.file), row.full_path, row.method, row.function))


def validation_errors(backend_root: Path, rows: list[RouteSecurityRow] | None = None) -> list[str]:
    rows = collect_rows(backend_root) if rows is None else rows
    by_key = {row.key(backend_root): row for row in rows}
    expected = set(EXPECTED_GUARDS)
    discovered = set(by_key)
    errors: list[str] = []
    for key in sorted(discovered - expected):
        row = by_key[key]
        errors.append(
            f"unclassified Admin mutation: {row.method} {row.full_path} ({key[0]}::{key[1]})"
        )
    for key in sorted(expected - discovered):
        errors.append(f"stale security-matrix entry: {key[0]}::{key[1]}")
    for key in sorted(discovered & expected):
        row = by_key[key]
        wanted = EXPECTED_GUARDS[key]
        if row.observed_guard != wanted:
            errors.append(
                f"guard drift for {row.method} {row.full_path} ({key[0]}::{key[1]}): "
                f"expected {wanted}, observed {row.observed_guard}"
            )
    return errors


def render_markdown(backend_root: Path) -> str:
    rows = collect_rows(backend_root)
    errors = validation_errors(backend_root, rows)
    counts = {RECENT_WEBAUTHN: 0, INTERACTIVE_UI: 0, ADMIN_AUTH: 0, "missing": 0}
    for row in rows:
        counts[row.observed_guard] = counts.get(row.observed_guard, 0) + 1
    lines = [
        "# Backend sensitive-route security matrix",
        "",
        f"- Admin mutating routes: {len(rows)}",
        f"- Recent WebAuthn routes: {counts[RECENT_WEBAUTHN]}",
        f"- Interactive UI routes: {counts[INTERACTIVE_UI]}",
        f"- Admin-auth routes: {counts[ADMIN_AUTH]}",
        f"- Contract errors: {len(errors)}",
        "",
        "| Method | Route | Handler | Expected guard | Observed guard | Note |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        key = row.key(backend_root)
        expected = EXPECTED_GUARDS.get(key, "unclassified")
        note = ROUTE_NOTES.get(key, "")
        lines.append(
            f"| {row.method} | `{row.full_path}` | `{key[0]}::{row.function}` | "
            f"{expected} | {row.observed_guard} | {note} |"
        )
    if errors:
        lines.extend(["", "## Contract errors", ""])
        lines.extend(f"- {error}" for error in errors)
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and render the Admin mutating-route security guard matrix."
    )
    parser.add_argument("--backend-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    backend_root = args.backend_root.resolve()
    report = render_markdown(backend_root)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report, end="")
    errors = validation_errors(backend_root)
    if args.check and errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
