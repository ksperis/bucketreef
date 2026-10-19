#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Generate database-schema D2 sources from the SQLAlchemy metadata."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import shutil
import subprocess
import sys

from sqlalchemy import CheckConstraint, UniqueConstraint


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db import Base  # noqa: E402


SCHEMA_SOURCE = REPOSITORY_ROOT / "doc/docs/developer/en/architecture/database-schema.d2"
SCHEMA_DIR = REPOSITORY_ROOT / "doc/docs/developer/en/architecture/database-schema"
ASSET_DIR = REPOSITORY_ROOT / "doc/docs/assets/diagrams/database-schema"


@dataclass(frozen=True)
class Domain:
    name: str
    slug: str
    tables: tuple[str, ...]


DOMAINS = (
    Domain(
        "Identity and UI access",
        "identity-ui-access",
        (
            "users",
            "ui_groups",
            "user_ui_groups",
            "api_tokens",
            "auth_sessions",
            "refresh_tokens",
            "external_identities",
            "external_identity_link_requests",
            "webauthn_credentials",
            "auth_challenges",
            "recovery_codes",
            "auth_rate_limits",
            "first_admin_bootstrap",
            "s3_sessions",
            "oidc_providers",
            "oidc_login_states",
            "oidc_authorization_codes",
            "ldap_providers",
            "browser_favorites",
            "onboarding_preferences",
            "onboarding_journeys",
        ),
    ),
    Domain(
        "Storage and S3 execution",
        "storage-s3-execution",
        (
            "storage_endpoints",
            "endpoint_service_identities",
            "key_rotation_intents",
            "manager_access_key_metadata",
            "s3_accounts",
            "user_s3_accounts",
            "account_iam_users",
            "s3_users",
            "user_s3_users",
            "s3_connections",
            "user_s3_connections",
            "managed_private_accesses",
            "ui_group_s3_accounts",
            "ui_group_s3_users",
            "ui_group_s3_connections",
        ),
    ),
    Domain(
        "Tags and classification",
        "tags-classification",
        (
            "tag_definitions",
            "bucket_ui_tag_assignments",
            "storage_endpoint_tags",
            "s3_account_tags",
            "s3_user_tags",
            "s3_connection_tags",
        ),
    ),
    Domain(
        "Portal",
        "portal",
        (
            "portal_storage_space_metadata",
            "portal_storage_space_grants",
            "portal_public_links",
            "portal_external_access_credentials",
            "portal_admin_requests",
            "portal_admin_request_messages",
        ),
    ),
    Domain(
        "Operations and audit",
        "operations-audit",
        (
            "audit_logs",
            "user_notifications",
            "webhook_endpoints",
            "webhook_endpoint_subscriptions",
            "webhook_deliveries",
            "bucket_migrations",
            "bucket_migration_items",
            "bucket_migration_events",
            "bucket_usage_stats_snapshots",
            "backend_operation_leases",
            "app_settings",
        ),
    ),
    Domain(
        "Observability quota and billing",
        "observability-quota-billing",
        (
            "endpoint_health_checks",
            "endpoint_health_latest",
            "endpoint_health_status_segments",
            "endpoint_health_rollups",
            "quota_usage_hourly",
            "quota_usage_daily",
            "quota_alert_states",
            "billing_usage_daily",
            "billing_storage_daily",
            "billing_rate_plans",
            "billing_rate_cards",
            "billing_assignments",
            "billing_entities",
            "billing_entity_tag_rules",
            "billing_entity_subject_rules",
            "billing_entity_rate_assignments",
            "billing_entity_groups",
            "billing_entity_group_memberships",
            "billing_statements",
            "billing_statement_lines",
            "billing_automation_runs",
        ),
    ),
)


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _column_name(value: object) -> str:
    return str(getattr(value, "name", value))


def _table_tooltip(table) -> str:
    lines: list[str] = []
    primary_key = [column.name for column in table.primary_key.columns]
    if primary_key:
        lines.append(f"PK: {', '.join(primary_key)}")

    unique_constraints = []
    check_constraints = []
    for constraint in table.constraints:
        if isinstance(constraint, UniqueConstraint):
            columns = ", ".join(column.name for column in constraint.columns)
            unique_constraints.append(f"{constraint.name or 'unnamed'}({columns})")
        elif isinstance(constraint, CheckConstraint):
            expression = " ".join(str(constraint.sqltext).split())
            check_constraints.append(f"{constraint.name or 'unnamed'}: {expression}")

    if unique_constraints:
        lines.append(f"Unique: {'; '.join(sorted(unique_constraints))}")
    if check_constraints:
        lines.append(f"Check: {'; '.join(sorted(check_constraints))}")

    indexes = []
    for index in table.indexes:
        columns = ", ".join(_column_name(column) for column in index.columns)
        kind = "unique" if index.unique else "index"
        indexes.append(f"{index.name or 'unnamed'}({columns}) [{kind}]")
    if indexes:
        lines.append(f"Indexes: {'; '.join(sorted(indexes))}")
    return "\\n".join(lines)


def _column_label(column) -> str:
    flags: list[str] = []
    if column.primary_key:
        flags.append("PK")
    if column.foreign_keys:
        flags.append("FK")
    if not column.nullable:
        flags.append("NN")
    if column.unique:
        flags.append("UQ")
    suffix = f" [{', '.join(flags)}]" if flags else ""
    return f"{column.type}{suffix}"


def _table_block(table_name: str, *, columns: bool, indent: str = "  ") -> list[str]:
    table = Base.metadata.tables[table_name]
    lines = [f'{indent}"{table_name}": {{', f"{indent}  class: table"]
    tooltip = _table_tooltip(table)
    if tooltip:
        lines.append(f'{indent}  tooltip: "{_escape(tooltip)}"')
    if columns:
        for column in table.columns:
            lines.append(
                f'{indent}  "{_escape(column.name)}": "{_escape(_column_label(column))}"'
            )
    lines.append(f"{indent}}}")
    return lines


def _domain_block(domain: Domain, *, columns: bool) -> list[str]:
    lines = [
        f'"{domain.name}": {{',
        '  style.fill: "#f8fafc"',
        '  style.stroke: "#cbd5e1"',
    ]
    for table_name in domain.tables:
        lines.extend(_table_block(table_name, columns=columns))
    lines.append("}")
    return lines


def _detail_header(scope: str, *, external: bool) -> list[str]:
    lines = [
        "# Generated from backend/app/db SQLAlchemy models via app.db.Base.metadata.",
        f"# Scope: {scope}",
        "# Column flags: PK=primary key, FK=foreign key, NN=not nullable, UQ=single-column unique.",
        "# Composite constraints and indexes are available as table tooltips in rendered D2 output.",
        "direction: right",
        "classes: {",
        "  table: {",
        "    shape: sql_table",
        "  }",
    ]
    if external:
        lines.extend(
            [
                "  external: {",
                "    shape: rectangle",
                '    style.fill: "#fff7ed"',
                '    style.stroke: "#fdba74"',
                "  }",
            ]
        )
    lines.extend(["}", ""])
    return lines


def _table_owner() -> dict[str, Domain]:
    owners: dict[str, Domain] = {}
    duplicates: set[str] = set()
    for domain in DOMAINS:
        for table_name in domain.tables:
            if table_name in owners:
                duplicates.add(table_name)
            owners[table_name] = domain

    metadata_tables = set(Base.metadata.tables)
    assigned_tables = set(owners)
    missing = sorted(metadata_tables - assigned_tables)
    unknown = sorted(assigned_tables - metadata_tables)
    if duplicates or missing or unknown:
        details = []
        if duplicates:
            details.append(f"duplicate assignments={sorted(duplicates)}")
        if missing:
            details.append(f"unassigned metadata tables={missing}")
        if unknown:
            details.append(f"unknown assigned tables={unknown}")
        raise RuntimeError("Database schema domain mapping is incomplete: " + "; ".join(details))
    return owners


def _foreign_keys(source_tables: tuple[str, ...]):
    for source_table_name in source_tables:
        table = Base.metadata.tables[source_table_name]
        for column in table.columns:
            for foreign_key in sorted(
                column.foreign_keys,
                key=lambda item: (item.column.table.name, item.column.name),
            ):
                yield source_table_name, column.name, foreign_key


def _relation_line(
    source_table: str,
    source_column: str,
    foreign_key,
    *,
    include_columns: bool,
) -> str:
    target_table = foreign_key.column.table.name
    if include_columns:
        relation = (
            f'"{source_table}"."{source_column}" -> '
            f'"{target_table}"."{foreign_key.column.name}"'
        )
    else:
        relation = f'"{source_table}" -> "{target_table}"'
    if foreign_key.ondelete:
        relation += f': "ondelete={_escape(foreign_key.ondelete)}"'
    return relation


def _render_overview() -> str:
    _table_owner()
    lines = [
        "# Generated from backend/app/db SQLAlchemy models via app.db.Base.metadata.",
        "# Scope: all tables and foreign-key topology; use detail slices for readable column-level views.",
        "# Column flags: PK=primary key, FK=foreign key, NN=not nullable, UQ=single-column unique.",
        "# Composite constraints and indexes are available as table tooltips in rendered D2 output.",
        "# Detail slices:",
    ]
    for domain in DOMAINS:
        lines.append(
            f"# - doc/docs/developer/en/architecture/database-schema/{domain.slug}.d2 ({domain.name})"
        )
    lines.extend(
        [
            "# - doc/docs/developer/en/architecture/database-schema/full.d2 (monolithic fallback)",
            "direction: right",
            "classes: {",
            "  table: {",
            "    shape: rectangle",
            '    style.fill: "#ffffff"',
            '    style.stroke: "#64748b"',
            "  }",
            "}",
            "",
            "Legend: {",
            "  shape: text",
            '  label: "Overview only: all tables and FK topology. Render per-domain D2 files for readable columns."',
            "}",
            "",
        ]
    )
    for domain in DOMAINS:
        lines.extend(_domain_block(domain, columns=False))
        lines.append("")

    seen_edges: set[tuple[str, str]] = set()
    for domain in DOMAINS:
        for source_table, source_column, foreign_key in _foreign_keys(domain.tables):
            target_table = foreign_key.column.table.name
            edge = (source_table, target_table)
            if edge in seen_edges:
                continue
            seen_edges.add(edge)
            lines.append(
                _relation_line(
                    source_table,
                    source_column,
                    foreign_key,
                    include_columns=False,
                )
            )
    return "\n".join(lines).rstrip() + "\n"


def _render_detail(domain: Domain) -> str:
    owners = _table_owner()
    lines = _detail_header(
        f"{domain.name} slice with local columns and cross-domain FK stubs.",
        external=True,
    )
    lines.extend(
        [
            "Legend: {",
            "  shape: text",
            '  label: "Local tables show full columns. Orange boxes are cross-domain references defined in another slice."',
            "}",
            "",
        ]
    )
    lines.extend(_domain_block(domain, columns=True))

    external_tables = {
        foreign_key.column.table.name
        for _source_table, _source_column, foreign_key in _foreign_keys(domain.tables)
        if foreign_key.column.table.name not in domain.tables
    }
    if external_tables:
        lines.extend(
            [
                "",
                '"External references": {',
                '  style.fill: "#fff7ed"',
                '  style.stroke: "#fdba74"',
            ]
        )
        table_order = {name: index for index, name in enumerate(Base.metadata.tables)}
        for table_name in sorted(external_tables, key=table_order.__getitem__):
            owner = owners[table_name]
            lines.extend(
                [
                    f'  "{table_name}": {{',
                    "    class: external",
                    (
                        '    tooltip: "Full definition: '
                        f'doc/docs/developer/en/architecture/database-schema/{owner.slug}.d2"'
                    ),
                    "  }",
                ]
            )
        lines.append("}")

    lines.append("")
    for source_table, source_column, foreign_key in _foreign_keys(domain.tables):
        lines.append(
            _relation_line(
                source_table,
                source_column,
                foreign_key,
                include_columns=True,
            )
        )
    return "\n".join(lines).rstrip() + "\n"


def _render_full() -> str:
    _table_owner()
    lines = _detail_header(
        "monolithic column-level schema for all SQLAlchemy tables; prefer slices for reading.",
        external=False,
    )
    lines.extend(
        [
            "Legend: {",
            "  shape: text",
            '  label: "Monolithic fallback. Prefer database-schema.d2 plus per-domain slices for browsing."',
            "}",
            "",
        ]
    )
    for domain in DOMAINS:
        lines.extend(_domain_block(domain, columns=True))
        lines.append("")
    for domain in DOMAINS:
        for source_table, source_column, foreign_key in _foreign_keys(domain.tables):
            lines.append(
                _relation_line(
                    source_table,
                    source_column,
                    foreign_key,
                    include_columns=True,
                )
            )
    return "\n".join(lines).rstrip() + "\n"


def expected_sources() -> dict[Path, str]:
    sources = {SCHEMA_SOURCE: _render_overview(), SCHEMA_DIR / "full.d2": _render_full()}
    for domain in DOMAINS:
        sources[SCHEMA_DIR / f"{domain.slug}.d2"] = _render_detail(domain)
    return sources


def _write_sources(sources: dict[Path, str]) -> None:
    for path, content in sources.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"generated {path.relative_to(REPOSITORY_ROOT)}")


def _check_sources(sources: dict[Path, str]) -> int:
    stale = []
    for path, expected in sources.items():
        current = path.read_text(encoding="utf-8") if path.is_file() else None
        if current != expected:
            stale.append(path.relative_to(REPOSITORY_ROOT).as_posix())
    if stale:
        print("Database schema documentation is stale:", file=sys.stderr)
        for path in stale:
            print(f"- {path}", file=sys.stderr)
        print(
            "Run backend/.venv/bin/python backend/scripts/generate_database_schema_docs.py --render",
            file=sys.stderr,
        )
        return 1
    print("Database schema documentation matches SQLAlchemy metadata.")
    return 0


def _render_svgs() -> None:
    d2 = shutil.which("d2")
    if d2 is None:
        raise RuntimeError("d2 is required for --render")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    render_targets = [(SCHEMA_SOURCE, ASSET_DIR / "overview.svg")]
    render_targets.extend(
        (SCHEMA_DIR / f"{domain.slug}.d2", ASSET_DIR / f"{domain.slug}.svg")
        for domain in DOMAINS
    )
    render_targets.append((SCHEMA_DIR / "full.d2", ASSET_DIR / "full.svg"))
    for source, target in render_targets:
        subprocess.run([d2, str(source), str(target)], check=True)
        print(f"rendered {target.relative_to(REPOSITORY_ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when committed D2 sources differ from SQLAlchemy metadata.",
    )
    parser.add_argument(
        "--render",
        action="store_true",
        help="Render the generated D2 sources to the published SVG assets.",
    )
    args = parser.parse_args()
    if args.check and args.render:
        parser.error("--check and --render cannot be combined")

    sources = expected_sources()
    if args.check:
        return _check_sources(sources)

    _write_sources(sources)
    if args.render:
        _render_svgs()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
