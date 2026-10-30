# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Store custom S3 connection endpoint fields as structured columns."""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0199_normalize_s3_connection_custom_endpoints"
down_revision = "0198_remove_openstack_legacy_contexts"
branch_labels = None
depends_on = None


def _decode_custom_endpoint(raw: object) -> dict[str, object]:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError) as exc:
        raise ValueError("configuration is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("configuration is not a JSON object")

    endpoint_url = payload.get("endpoint_url")
    if not isinstance(endpoint_url, str) or not endpoint_url.strip():
        raise ValueError("endpoint_url is missing")
    force_path_style = payload.get("force_path_style")
    verify_tls = payload.get("verify_tls")
    if not isinstance(force_path_style, bool) or not isinstance(verify_tls, bool):
        raise ValueError("endpoint flags are invalid")

    def optional_text(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None

    return {
        "custom_endpoint_url": endpoint_url.strip().rstrip("/"),
        "custom_region": optional_text(payload.get("region")),
        "custom_force_path_style": force_path_style,
        "custom_verify_tls": verify_tls,
        "custom_provider": optional_text(payload.get("provider")),
    }


def upgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("s3_connections") as batch:
        batch.add_column(sa.Column("custom_endpoint_url", sa.String(), nullable=True))
        batch.add_column(sa.Column("custom_region", sa.String(), nullable=True))
        batch.add_column(sa.Column("custom_force_path_style", sa.Boolean(), nullable=True))
        batch.add_column(sa.Column("custom_verify_tls", sa.Boolean(), nullable=True))
        batch.add_column(sa.Column("custom_provider", sa.String(), nullable=True))

    rows = bind.execute(
        sa.text(
            "SELECT id, storage_endpoint_id, custom_endpoint_config "
            "FROM s3_connections"
        )
    ).mappings()
    for row in rows:
        if row["storage_endpoint_id"] is not None:
            values = {
                "custom_endpoint_url": None,
                "custom_region": None,
                "custom_force_path_style": None,
                "custom_verify_tls": None,
                "custom_provider": None,
            }
        else:
            try:
                values = _decode_custom_endpoint(row["custom_endpoint_config"])
            except ValueError as exc:
                raise RuntimeError(
                    f"S3 connection {row['id']} has no usable custom endpoint: {exc}"
                ) from exc
        bind.execute(
            sa.text(
                """
                UPDATE s3_connections
                SET custom_endpoint_url = :custom_endpoint_url,
                    custom_region = :custom_region,
                    custom_force_path_style = :custom_force_path_style,
                    custom_verify_tls = :custom_verify_tls,
                    custom_provider = :custom_provider
                WHERE id = :id
                """
            ),
            {"id": row["id"], **values},
        )

    with op.batch_alter_table("s3_connections") as batch:
        batch.drop_column("custom_endpoint_config")
        batch.create_check_constraint(
            "ck_s3_connections_endpoint_source",
            (
                "(storage_endpoint_id IS NOT NULL "
                "AND custom_endpoint_url IS NULL "
                "AND custom_region IS NULL "
                "AND custom_force_path_style IS NULL "
                "AND custom_verify_tls IS NULL "
                "AND custom_provider IS NULL) "
                "OR "
                "(storage_endpoint_id IS NULL "
                "AND custom_endpoint_url IS NOT NULL "
                "AND custom_force_path_style IS NOT NULL "
                "AND custom_verify_tls IS NOT NULL)"
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("s3_connections") as batch:
        batch.add_column(sa.Column("custom_endpoint_config", sa.Text(), nullable=True))

    rows = bind.execute(
        sa.text(
            """
            SELECT id, storage_endpoint_id, custom_endpoint_url, custom_region,
                   custom_force_path_style, custom_verify_tls, custom_provider
            FROM s3_connections
            """
        )
    ).mappings()
    for row in rows:
        encoded = None
        if row["storage_endpoint_id"] is None:
            encoded = json.dumps(
                {
                    "endpoint_url": row["custom_endpoint_url"],
                    "force_path_style": bool(row["custom_force_path_style"]),
                    "provider": row["custom_provider"],
                    "region": row["custom_region"],
                    "verify_tls": bool(row["custom_verify_tls"]),
                },
                separators=(",", ":"),
                sort_keys=True,
            )
        bind.execute(
            sa.text(
                "UPDATE s3_connections "
                "SET custom_endpoint_config = :custom_endpoint_config "
                "WHERE id = :id"
            ),
            {"id": row["id"], "custom_endpoint_config": encoded},
        )

    with op.batch_alter_table("s3_connections") as batch:
        batch.drop_constraint("ck_s3_connections_endpoint_source", type_="check")
        batch.drop_column("custom_provider")
        batch.drop_column("custom_verify_tls")
        batch.drop_column("custom_force_path_style")
        batch.drop_column("custom_region")
        batch.drop_column("custom_endpoint_url")
