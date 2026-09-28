# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Replace saved views and JSON presets with personal path favorites."""
import json
from alembic import op
import sqlalchemy as sa
from app.db.utc_datetime import UTCDateTime

revision = "0137_browser_path_favorites"
down_revision = "0136_merge_browser_migration_heads"
branch_labels = None
depends_on = None

_PATH_FIELDS = ("name", "surface", "workspace", "context", "bucket", "prefix")
_IDENTITY_FIELDS = ("id", "user_id", "revision", "created_at", "updated_at")


def _source_table(name):
    table = sa.Table(name, sa.MetaData(), autoload_with=op.get_bind())
    table.c.created_at.type = UTCDateTime()
    table.c.updated_at.type = UTCDateTime()
    return table


def upgrade():
    favorites = op.create_table(
        "browser_favorites",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("surface", sa.String(24), nullable=False),
        sa.Column("workspace", sa.String(24), nullable=False),
        sa.Column("context", sa.String(256), nullable=False),
        sa.Column("bucket", sa.String(255), nullable=False),
        sa.Column("prefix", sa.String(1024), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_browser_favorites_user_surface", "browser_favorites", ["user_id", "surface"])
    connection = op.get_bind()
    for row in connection.execute(sa.select(_source_table("browser_presets"))).mappings():
        payload = json.loads(row["payload_json"])
        if payload["kind"] == "view":
            continue
        if payload["kind"] != "favorite":
            raise ValueError("Unexpected Browser preset kind")
        values = {key: row[key] for key in _IDENTITY_FIELDS}
        values.update({key: payload[key] for key in _PATH_FIELDS})
        connection.execute(favorites.insert().values(**values))
    op.drop_table("browser_presets")


def downgrade():
    presets = op.create_table(
        "browser_presets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("surface", sa.String(24), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_browser_presets_user_surface", "browser_presets", ["user_id", "surface"])
    connection = op.get_bind()
    for row in connection.execute(sa.select(_source_table("browser_favorites"))).mappings():
        payload = {key: row[key] for key in _PATH_FIELDS}
        payload.update(kind="favorite", view=None)
        connection.execute(presets.insert().values(
            **{key: row[key] for key in _IDENTITY_FIELDS},
            surface=row["surface"], payload_json=json.dumps(payload, ensure_ascii=False),
        ))
    op.drop_table("browser_favorites")
