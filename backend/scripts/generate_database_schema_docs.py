#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Generate Mermaid and ChartDB database-schema documentation from SQLAlchemy."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import json
import math
from pathlib import Path
import re
import sys

from sqlalchemy import CheckConstraint, UniqueConstraint


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db import Base  # noqa: E402


SCHEMA_DIR = REPOSITORY_ROOT / "doc/docs/developer/en/architecture/database-schema"
CHARTDB_PATH = (
    REPOSITORY_ROOT
    / "doc/docs/assets/diagrams/database-schema/bucketreef-database.chartdb.json"
)

TABLE_WIDTH = 360
TABLE_HEADER_HEIGHT = 76
FIELD_HEIGHT = 30
AREA_PADDING = 60
AREA_HEADER_HEIGHT = 72
TABLE_GAP_X = 60
TABLE_GAP_Y = 60
AREA_GAP_X = 300
AREA_GAP_Y = 300


@dataclass(frozen=True)
class Domain:
    name: str
    slug: str
    color: str
    tables: tuple[str, ...]


DOMAINS = (
    Domain(
        "Identity and UI access",
        "identity-ui-access",
        "#4F46E5",
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
        "#0F766E",
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
        "#7C3AED",
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
        "#2563EB",
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
        "#D97706",
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
        "Observability quota and cost",
        "observability-quota-cost",
        "#059669",
        (
            "endpoint_health_checks",
            "endpoint_health_latest",
            "endpoint_health_status_segments",
            "endpoint_health_rollups",
            "quota_usage_hourly",
            "quota_usage_daily",
            "quota_alert_states",
            "cost_usage_daily",
            "cost_storage_daily",
            "cost_models",
            "cost_endpoint_overrides",
        ),
    ),
)


def _column_name(value: object) -> str:
    return str(getattr(value, "name", value))


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
        raise RuntimeError(
            "Database schema domain mapping is incomplete: " + "; ".join(details)
        )
    return owners


def _foreign_keys(source_tables: tuple[str, ...] | None = None):
    table_names = source_tables or tuple(Base.metadata.tables)
    for source_table_name in table_names:
        table = Base.metadata.tables[source_table_name]
        for column in table.columns:
            for foreign_key in sorted(
                column.foreign_keys,
                key=lambda item: (item.column.table.name, item.column.name),
            ):
                yield source_table_name, column.name, foreign_key


def _single_column_unique_names(table) -> set[str]:
    unique = {column.name for column in table.columns if column.unique}
    for constraint in table.constraints:
        if isinstance(constraint, UniqueConstraint) and len(constraint.columns) == 1:
            unique.update(column.name for column in constraint.columns)
    if len(table.primary_key.columns) == 1:
        unique.update(column.name for column in table.primary_key.columns)
    return unique


def _mermaid_identifier(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]", "_", value)
    if not normalized or normalized[0].isdigit():
        normalized = f"db_{normalized}"
    return normalized


def _mermaid_type(column) -> str:
    value = str(column.type).lower()
    value = re.sub(r"[^a-z0-9]+", "_", value).strip("_") or "value"
    if value[0].isdigit():
        value = f"type_{value}"
    return value


def _mermaid_comment(column) -> str:
    notes: list[str] = []
    if not column.nullable:
        notes.append("NN")
    if column.server_default is not None:
        default = str(getattr(column.server_default, "arg", column.server_default))
        default = " ".join(default.split())
        notes.append(f"default={default}")
    if column.comment:
        notes.append(str(column.comment))
    value = "; ".join(notes)
    return value.replace('"', "'")[:180]


def _mermaid_entity(
    table_name: str, *, columns: list[str] | None = None, external: bool = False
) -> list[str]:
    table = Base.metadata.tables[table_name]
    selected = (
        list(table.columns) if columns is None else [table.c[name] for name in columns]
    )
    unique_names = _single_column_unique_names(table)
    lines = [f"    {_mermaid_identifier(table_name)} {{"]
    for column in selected:
        flags: list[str] = []
        if column.primary_key:
            flags.append("PK")
        if column.foreign_keys:
            flags.append("FK")
        if column.name in unique_names and not column.primary_key:
            flags.append("UK")
        flag_suffix = f" {', '.join(flags)}" if flags else ""
        comment = "external reference" if external else _mermaid_comment(column)
        comment_suffix = f' "{comment}"' if comment else ""
        lines.append(
            f"        {_mermaid_type(column)} "
            f"{_mermaid_identifier(column.name)}{flag_suffix}{comment_suffix}"
        )
    lines.append("    }")
    return lines


def _mermaid_relation(source_table: str, source_column: str, foreign_key) -> str:
    source = Base.metadata.tables[source_table]
    target_table = foreign_key.column.table.name
    unique_source = source_column in _single_column_unique_names(source)
    source_marker = "o|" if unique_source else "}o"
    target_marker = "o|" if source.c[source_column].nullable else "||"
    label = f"{source_column} to {foreign_key.column.name}"
    if foreign_key.ondelete:
        label += f"; ON DELETE {foreign_key.ondelete}"
    return (
        f"    {_mermaid_identifier(source_table)} {source_marker}--{target_marker} "
        f'{_mermaid_identifier(target_table)} : "{label}"'
    )


def _render_mermaid_overview() -> str:
    owners = _table_owner()
    cross_domain = Counter()
    for source_table, _source_column, foreign_key in _foreign_keys():
        source_domain = owners[source_table]
        target_domain = owners[foreign_key.column.table.name]
        if source_domain != target_domain:
            cross_domain[(source_domain.slug, target_domain.slug)] += 1

    lines = [
        "flowchart LR",
        "    %% Generated from backend/app/db SQLAlchemy models via app.db.Base.metadata.",
    ]
    for domain in DOMAINS:
        node = domain.slug.replace("-", "_")
        lines.append(f'    {node}["{domain.name}<br/>{len(domain.tables)} tables"]')
    for (source_slug, target_slug), count in sorted(cross_domain.items()):
        source = source_slug.replace("-", "_")
        target = target_slug.replace("-", "_")
        lines.append(f'    {source} -->|"{count} FK"| {target}')
    return "\n".join(lines).rstrip() + "\n"


def _render_mermaid_domain(domain: Domain) -> str:
    owners = _table_owner()
    external_columns: dict[str, set[str]] = {}
    relations: list[str] = []
    for source_table, source_column, foreign_key in _foreign_keys(domain.tables):
        target_table = foreign_key.column.table.name
        if owners[target_table] != domain:
            external_columns.setdefault(target_table, set()).add(foreign_key.column.name)
        relations.append(_mermaid_relation(source_table, source_column, foreign_key))

    lines = [
        "erDiagram",
        "    %% Generated from backend/app/db SQLAlchemy models via app.db.Base.metadata.",
        f"    %% Domain: {domain.name}.",
        "    %% PK=primary key, FK=foreign key, UK=single-column unique, NN=not nullable.",
    ]
    for table_name in domain.tables:
        lines.extend(_mermaid_entity(table_name))
    for table_name in sorted(external_columns):
        lines.extend(
            _mermaid_entity(
                table_name,
                columns=sorted(external_columns[table_name]),
                external=True,
            )
        )
    lines.extend(relations)
    return "\n".join(lines).rstrip() + "\n"


def _chartdb_type(column) -> dict[str, str]:
    type_id = re.sub(r"\s+", " ", str(column.type)).strip().lower()
    return {"id": type_id, "name": type_id}


def _chartdb_default(column) -> str | None:
    if column.server_default is None:
        return None
    return str(getattr(column.server_default, "arg", column.server_default))


def _chartdb_field(table, column) -> dict[str, object]:
    length = getattr(column.type, "length", None)
    precision = getattr(column.type, "precision", None)
    scale = getattr(column.type, "scale", None)
    return {
        "id": f"field:{table.name}.{column.name}",
        "name": column.name,
        "type": _chartdb_type(column),
        "primaryKey": bool(column.primary_key),
        "unique": column.name in _single_column_unique_names(table),
        "nullable": bool(column.nullable),
        "increment": True if column.autoincrement is True else None,
        "isArray": bool(hasattr(column.type, "item_type")),
        "createdAt": 0,
        "characterMaximumLength": str(length) if length is not None else None,
        "precision": int(precision) if precision is not None else None,
        "scale": int(scale) if scale is not None else None,
        "default": _chartdb_default(column),
        "collation": getattr(column.type, "collation", None),
        "comments": str(column.comment) if column.comment else None,
        "check": None,
    }


def _chartdb_indexes(table) -> list[dict[str, object]]:
    indexes: list[dict[str, object]] = []
    primary_columns = [column.name for column in table.primary_key.columns]
    if primary_columns:
        indexes.append(
            {
                "id": f"index:{table.name}:primary-key",
                "name": table.primary_key.name or "",
                "unique": True,
                "fieldIds": [
                    f"field:{table.name}.{name}" for name in primary_columns
                ],
                "createdAt": 0,
                "isPrimaryKey": True,
                "comments": None,
            }
        )

    for index in sorted(table.indexes, key=lambda item: item.name or ""):
        columns = [_column_name(column) for column in index.columns]
        indexes.append(
            {
                "id": f"index:{table.name}:{index.name or '-'.join(columns)}",
                "name": index.name or "",
                "unique": bool(index.unique),
                "fieldIds": [f"field:{table.name}.{name}" for name in columns],
                "createdAt": 0,
                "isPrimaryKey": False,
                "comments": None,
            }
        )

    for constraint in sorted(
        (item for item in table.constraints if isinstance(item, UniqueConstraint)),
        key=lambda item: item.name
        or ",".join(column.name for column in item.columns),
    ):
        columns = [column.name for column in constraint.columns]
        signature = tuple(columns)
        if any(
            item["unique"]
            and tuple(
                field_id.rsplit(".", 1)[-1] for field_id in item["fieldIds"]
            )
            == signature
            for item in indexes
        ):
            continue
        name = constraint.name or f"uq_{table.name}_{'_'.join(columns)}"
        indexes.append(
            {
                "id": f"unique:{table.name}:{name}",
                "name": name,
                "unique": True,
                "fieldIds": [
                    f"field:{table.name}.{column}" for column in columns
                ],
                "createdAt": 0,
                "isPrimaryKey": False,
                "comments": "SQLAlchemy UniqueConstraint",
            }
        )
    return indexes


def _chartdb_checks(table) -> list[dict[str, object]]:
    checks = []
    for index, constraint in enumerate(
        sorted(
            (
                item
                for item in table.constraints
                if isinstance(item, CheckConstraint)
            ),
            key=lambda item: (item.name or "", str(item.sqltext)),
        )
    ):
        name = constraint.name or str(index)
        checks.append(
            {
                "id": f"check:{table.name}:{name}",
                "expression": " ".join(str(constraint.sqltext).split()),
                "createdAt": 0,
            }
        )
    return checks


def _chartdb_table_height(table) -> int:
    return TABLE_HEADER_HEIGHT + FIELD_HEIGHT * max(1, len(table.columns))


def _area_column_count(table_count: int) -> int:
    if table_count <= 6:
        return 2
    if table_count <= 12:
        return 3
    return 4


def _table_degrees() -> Counter[str]:
    degrees: Counter[str] = Counter()
    for source_table, _source_column, foreign_key in _foreign_keys():
        degrees[source_table] += 1
        degrees[foreign_key.column.table.name] += 1
    return degrees


def _domain_layout(domain: Domain) -> tuple[int, int, list[tuple[str, int, int]]]:
    degrees = _table_degrees()
    ordered = sorted(domain.tables, key=lambda name: (-degrees[name], name))
    columns = _area_column_count(len(ordered))
    rows = math.ceil(len(ordered) / columns)
    row_heights: list[int] = []
    for row in range(rows):
        names = ordered[row * columns : (row + 1) * columns]
        row_heights.append(
            max(
                _chartdb_table_height(Base.metadata.tables[name])
                for name in names
            )
        )

    area_width = (
        AREA_PADDING * 2
        + columns * TABLE_WIDTH
        + (columns - 1) * TABLE_GAP_X
    )
    area_height = (
        AREA_PADDING * 2
        + AREA_HEADER_HEIGHT
        + sum(row_heights)
        + max(0, rows - 1) * TABLE_GAP_Y
    )

    positions: list[tuple[str, int, int]] = []
    y = AREA_PADDING + AREA_HEADER_HEIGHT
    for row in range(rows):
        names = ordered[row * columns : (row + 1) * columns]
        for column, table_name in enumerate(names):
            x = AREA_PADDING + column * (TABLE_WIDTH + TABLE_GAP_X)
            positions.append((table_name, x, y))
        y += row_heights[row] + TABLE_GAP_Y
    return area_width, area_height, positions


def _chartdb_layout() -> tuple[
    list[dict[str, object]], dict[str, tuple[int, int, str]]
]:
    specs = []
    for domain in DOMAINS:
        width, height, positions = _domain_layout(domain)
        specs.append((domain, width, height, positions))

    global_column_width = max(
        width for _domain, width, _height, _positions in specs
    )
    areas: list[dict[str, object]] = []
    table_positions: dict[str, tuple[int, int, str]] = {}
    y = 0
    for row_start in range(0, len(specs), 2):
        row_specs = specs[row_start : row_start + 2]
        row_height = max(
            height for _domain, _width, height, _positions in row_specs
        )
        for column, (domain, width, height, positions) in enumerate(row_specs):
            area_x = column * (global_column_width + AREA_GAP_X)
            area_y = y
            area_id = f"area:{domain.slug}"
            areas.append(
                {
                    "id": area_id,
                    "name": domain.name,
                    "x": area_x,
                    "y": area_y,
                    "width": width,
                    "height": height,
                    "color": domain.color,
                    "order": len(areas),
                }
            )
            for table_name, relative_x, relative_y in positions:
                table_positions[table_name] = (
                    area_x + relative_x,
                    area_y + relative_y,
                    area_id,
                )
        y += row_height + AREA_GAP_Y
    return areas, table_positions


def _chartdb_relationships() -> list[dict[str, object]]:
    relationships = []
    for source_table, source_column, foreign_key in _foreign_keys():
        target_table = foreign_key.column.table.name
        target_column = foreign_key.column.name
        name = foreign_key.constraint.name or (
            f"fk_{source_table}_{source_column}_{target_table}_{target_column}"
        )
        if foreign_key.ondelete:
            name += f" [ON DELETE {foreign_key.ondelete}]"
        relationships.append(
            {
                "id": (
                    f"relationship:{source_table}.{source_column}"
                    f"->{target_table}.{target_column}"
                ),
                "name": name,
                "sourceSchema": None,
                "sourceTableId": f"table:{source_table}",
                "targetSchema": None,
                "targetTableId": f"table:{target_table}",
                "sourceFieldId": f"field:{source_table}.{source_column}",
                "targetFieldId": f"field:{target_table}.{target_column}",
                "sourceCardinality": (
                    "one"
                    if source_column
                    in _single_column_unique_names(
                        Base.metadata.tables[source_table]
                    )
                    else "many"
                ),
                "targetCardinality": "one",
                "createdAt": 0,
            }
        )
    return relationships


def chartdb_document() -> dict[str, object]:
    owners = _table_owner()
    areas, positions = _chartdb_layout()
    table_order = {name: index for index, name in enumerate(Base.metadata.tables)}
    tables = []
    for table_name, table in Base.metadata.tables.items():
        x, y, area_id = positions[table_name]
        domain = owners[table_name]
        tables.append(
            {
                "id": f"table:{table_name}",
                "name": table_name,
                "schema": None,
                "x": x,
                "y": y,
                "fields": [
                    _chartdb_field(table, column)
                    for column in table.columns
                ],
                "indexes": _chartdb_indexes(table),
                "checkConstraints": _chartdb_checks(table),
                "color": domain.color,
                "isView": False,
                "isMaterializedView": False,
                "createdAt": 0,
                "width": TABLE_WIDTH,
                "comments": str(table.comment) if table.comment else None,
                "order": table_order[table_name],
                "expanded": True,
                "parentAreaId": area_id,
            }
        )

    return {
        "id": "bucketreef-database",
        "name": "BucketReef Database",
        "databaseType": "sqlite",
        "tables": tables,
        "relationships": _chartdb_relationships(),
        "dependencies": [],
        "areas": areas,
        "customTypes": [],
        "notes": [],
        "createdAt": "1970-01-01T00:00:00.000Z",
        "updatedAt": "1970-01-01T00:00:00.000Z",
    }


def _validate_chartdb_document(document: dict[str, object]) -> None:
    tables = document["tables"]
    relationships = document["relationships"]
    areas = document["areas"]
    assert isinstance(tables, list)
    assert isinstance(relationships, list)
    assert isinstance(areas, list)

    area_by_id = {area["id"]: area for area in areas}
    table_by_id = {table["id"]: table for table in tables}
    field_ids = {
        field["id"]
        for table in tables
        for field in table["fields"]
    }
    if len(table_by_id) != len(Base.metadata.tables):
        raise RuntimeError(
            "ChartDB table count does not match SQLAlchemy metadata"
        )
    if len(relationships) != sum(1 for _item in _foreign_keys()):
        raise RuntimeError(
            "ChartDB relationship count does not match SQLAlchemy metadata"
        )

    for table in tables:
        area = area_by_id.get(table["parentAreaId"])
        if area is None:
            raise RuntimeError(
                f"ChartDB table {table['name']} has no valid area"
            )
        source = Base.metadata.tables[table["name"]]
        expected_fields = {
            f"field:{table['name']}.{column.name}"
            for column in source.columns
        }
        actual_fields = {field["id"] for field in table["fields"]}
        if actual_fields != expected_fields:
            raise RuntimeError(
                f"ChartDB fields are incomplete for {table['name']}"
            )
        height = _chartdb_table_height(source)
        if not (
            table["x"] >= area["x"] + AREA_PADDING
            and table["y"]
            >= area["y"] + AREA_PADDING + AREA_HEADER_HEIGHT
            and table["x"] + TABLE_WIDTH
            <= area["x"] + area["width"] - AREA_PADDING
            and table["y"] + height
            <= area["y"] + area["height"] - AREA_PADDING
        ):
            raise RuntimeError(
                f"ChartDB table {table['name']} exceeds its area"
            )

    for relationship in relationships:
        if relationship["sourceTableId"] not in table_by_id:
            raise RuntimeError(
                f"Invalid ChartDB source table in {relationship['id']}"
            )
        if relationship["targetTableId"] not in table_by_id:
            raise RuntimeError(
                f"Invalid ChartDB target table in {relationship['id']}"
            )
        if relationship["sourceFieldId"] not in field_ids:
            raise RuntimeError(
                f"Invalid ChartDB source field in {relationship['id']}"
            )
        if relationship["targetFieldId"] not in field_ids:
            raise RuntimeError(
                f"Invalid ChartDB target field in {relationship['id']}"
            )


def expected_sources() -> dict[Path, str]:
    sources = {
        SCHEMA_DIR / "overview.mmd": _render_mermaid_overview()
    }
    for domain in DOMAINS:
        sources[SCHEMA_DIR / f"{domain.slug}.mmd"] = (
            _render_mermaid_domain(domain)
        )
    document = chartdb_document()
    _validate_chartdb_document(document)
    sources[CHARTDB_PATH] = (
        json.dumps(document, indent=2, ensure_ascii=False) + "\n"
    )
    return sources


def obsolete_paths() -> tuple[Path, ...]:
    d2_sources = [
        REPOSITORY_ROOT
        / "doc/docs/developer/en/architecture/database-schema.d2",
        SCHEMA_DIR / "full.d2",
        *(SCHEMA_DIR / f"{domain.slug}.d2" for domain in DOMAINS),
    ]
    svg_dir = (
        REPOSITORY_ROOT / "doc/docs/assets/diagrams/database-schema"
    )
    svg_assets = [
        svg_dir / "overview.svg",
        svg_dir / "full.svg",
        *(svg_dir / f"{domain.slug}.svg" for domain in DOMAINS),
    ]
    return tuple([*d2_sources, *svg_assets])


def _write_sources(sources: dict[Path, str]) -> None:
    for path, content in sources.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"generated {path.relative_to(REPOSITORY_ROOT)}")
    for path in obsolete_paths():
        if path.is_file():
            path.unlink()
            print(f"removed {path.relative_to(REPOSITORY_ROOT)}")


def _check_sources(sources: dict[Path, str]) -> int:
    stale = []
    for path, expected in sources.items():
        current = (
            path.read_text(encoding="utf-8")
            if path.is_file()
            else None
        )
        if current != expected:
            stale.append(path.relative_to(REPOSITORY_ROOT).as_posix())
    stale.extend(
        path.relative_to(REPOSITORY_ROOT).as_posix()
        for path in obsolete_paths()
        if path.is_file()
    )
    if stale:
        print("Database schema documentation is stale:", file=sys.stderr)
        for path in stale:
            print(f"- {path}", file=sys.stderr)
        print(
            "Run backend/.venv/bin/python "
            "backend/scripts/generate_database_schema_docs.py",
            file=sys.stderr,
        )
        return 1
    print("Database schema documentation matches SQLAlchemy metadata.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help=(
            "Fail when generated Mermaid or ChartDB files differ "
            "from SQLAlchemy metadata."
        ),
    )
    args = parser.parse_args()

    sources = expected_sources()
    if args.check:
        return _check_sources(sources)
    _write_sources(sources)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
