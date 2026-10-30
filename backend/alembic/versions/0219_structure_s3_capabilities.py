# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store S3 connection and session capabilities as structured JSON.

Revision ID: 0219_structure_s3_capabilities
Revises: 0218_structure_cost_measurement_breakdowns
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0219_structure_s3_capabilities"
down_revision = "0218_structure_cost_measurement_breakdowns"
branch_labels = None
depends_on = None


_SESSION_BOOLEAN_KEYS = {
    "can_manage_iam",
    "can_manage_buckets",
    "can_view_traffic",
    "access_browser",
}
_SESSION_KEYS = _SESSION_BOOLEAN_KEYS | {"endpoint_url"}
_CONNECTION_DEFAULT_JSON = '{"can_manage_iam":false}'


legacy_connections = sa.table(
    "s3_connections",
    sa.column("id", sa.Integer()),
    sa.column("capabilities_json", sa.Text()),
    sa.column("capabilities_structured", sa.JSON(none_as_null=True)),
)
structured_connections = sa.table(
    "s3_connections",
    sa.column("id", sa.Integer()),
    sa.column("capabilities", sa.JSON(none_as_null=True)),
    sa.column("capabilities_json", sa.Text()),
)
legacy_sessions = sa.table(
    "s3_sessions",
    sa.column("id", sa.String()),
    sa.column("capabilities", sa.Text()),
    sa.column("capabilities_structured", sa.JSON(none_as_null=True)),
)
structured_sessions = sa.table(
    "s3_sessions",
    sa.column("id", sa.String()),
    sa.column("capabilities", sa.JSON(none_as_null=True)),
    sa.column("capabilities_text", sa.Text()),
)


def _load_json_object(*, row_label: str, raw: object) -> dict[str, Any]:
    if not isinstance(raw, str):
        raise ValueError(f"{row_label} capabilities must contain a JSON object.")
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{row_label} capabilities contain invalid JSON.") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{row_label} capabilities must contain a JSON object.")
    return value


def _validate_connection_capabilities(
    row_id: int,
    value: object,
) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("can_manage_iam"), bool):
        raise ValueError(
            f"S3 connection {row_id} capabilities must define boolean can_manage_iam."
        )
    return value


def _validate_session_capabilities(
    session_id: str,
    value: object,
) -> dict[str, bool | str | None]:
    if not isinstance(value, dict) or set(value) != _SESSION_KEYS:
        raise ValueError(
            f"S3 session {session_id} capabilities must use the canonical capability shape."
        )
    if any(not isinstance(value[key], bool) for key in _SESSION_BOOLEAN_KEYS):
        raise ValueError(
            f"S3 session {session_id} capabilities must define boolean capability flags."
        )
    endpoint_url = value["endpoint_url"]
    if endpoint_url is not None and not isinstance(endpoint_url, str):
        raise ValueError(
            f"S3 session {session_id} capabilities endpoint_url must be a string or null."
        )
    return value


def _load_connection_capabilities(row_id: int, raw: object) -> dict[str, Any]:
    return _validate_connection_capabilities(
        row_id,
        _load_json_object(row_label=f"S3 connection {row_id}", raw=raw),
    )


def _load_session_capabilities(
    session_id: str,
    raw: object,
) -> dict[str, bool | str | None]:
    return _validate_session_capabilities(
        session_id,
        _load_json_object(row_label=f"S3 session {session_id}", raw=raw),
    )


def _dump_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def upgrade() -> None:
    op.add_column(
        "s3_connections",
        sa.Column(
            "capabilities_structured",
            sa.JSON(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "s3_sessions",
        sa.Column(
            "capabilities_structured",
            sa.JSON(none_as_null=True),
            nullable=True,
        ),
    )
    bind = op.get_bind()
    connection_rows = bind.execute(
        sa.select(legacy_connections.c.id, legacy_connections.c.capabilities_json)
    ).all()
    for row in connection_rows:
        bind.execute(
            legacy_connections.update()
            .where(legacy_connections.c.id == row.id)
            .values(
                capabilities_structured=_load_connection_capabilities(
                    row.id,
                    row.capabilities_json,
                )
            )
        )
    session_rows = bind.execute(
        sa.select(legacy_sessions.c.id, legacy_sessions.c.capabilities)
    ).all()
    for row in session_rows:
        bind.execute(
            legacy_sessions.update()
            .where(legacy_sessions.c.id == row.id)
            .values(
                capabilities_structured=_load_session_capabilities(
                    row.id,
                    row.capabilities,
                )
            )
        )
    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.drop_column("capabilities_json")
        batch_op.alter_column(
            "capabilities_structured",
            existing_type=sa.JSON(none_as_null=True),
            new_column_name="capabilities",
            nullable=False,
            server_default=_CONNECTION_DEFAULT_JSON,
        )
    with op.batch_alter_table("s3_sessions") as batch_op:
        batch_op.drop_column("capabilities")
        batch_op.alter_column(
            "capabilities_structured",
            existing_type=sa.JSON(none_as_null=True),
            new_column_name="capabilities",
            nullable=False,
        )


def downgrade() -> None:
    op.add_column(
        "s3_connections",
        sa.Column("capabilities_json", sa.Text(), nullable=True),
    )
    op.add_column(
        "s3_sessions",
        sa.Column("capabilities_text", sa.Text(), nullable=True),
    )
    bind = op.get_bind()
    connection_rows = bind.execute(
        sa.select(structured_connections.c.id, structured_connections.c.capabilities)
    ).all()
    for row in connection_rows:
        bind.execute(
            structured_connections.update()
            .where(structured_connections.c.id == row.id)
            .values(
                capabilities_json=_dump_json(
                    _validate_connection_capabilities(row.id, row.capabilities)
                )
            )
        )
    session_rows = bind.execute(
        sa.select(structured_sessions.c.id, structured_sessions.c.capabilities)
    ).all()
    for row in session_rows:
        bind.execute(
            structured_sessions.update()
            .where(structured_sessions.c.id == row.id)
            .values(
                capabilities_text=_dump_json(
                    _validate_session_capabilities(row.id, row.capabilities)
                )
            )
        )
    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.drop_column("capabilities")
        batch_op.alter_column(
            "capabilities_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default=_CONNECTION_DEFAULT_JSON,
        )
    with op.batch_alter_table("s3_sessions") as batch_op:
        batch_op.drop_column("capabilities")
        batch_op.alter_column(
            "capabilities_text",
            existing_type=sa.Text(),
            new_column_name="capabilities",
            nullable=False,
        )
