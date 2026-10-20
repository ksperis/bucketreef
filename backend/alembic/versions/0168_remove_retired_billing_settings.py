"""Remove retired Billing v2 application settings.

Revision 0167 originally restored the 0.2.16 Billing model. Databases that
reached that revision before its settings cleanup was added can still contain
Billing v2 settings that the restored AppSettings model rejects. This
follow-up migration is intentionally idempotent so every already-upgraded
database receives the cleanup.
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op


revision = "0168_remove_retired_billing_settings"
down_revision = "0167_restore_billing_0216_model"
branch_labels = None
depends_on = None


_RETIRED_SETTINGS = ("billing_automation", "billing_statement_pdf")


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, payload_json FROM app_settings")
    ).mappings()
    for row in rows:
        payload = json.loads(row["payload_json"])
        if not isinstance(payload, dict):
            continue
        changed = False
        for key in _RETIRED_SETTINGS:
            if key in payload:
                payload.pop(key)
                changed = True
        if changed:
            bind.execute(
                sa.text(
                    "UPDATE app_settings SET payload_json = :payload_json WHERE key = :key"
                ),
                {
                    "key": row["key"],
                    "payload_json": json.dumps(payload, separators=(",", ":")),
                },
            )


def downgrade() -> None:
    # The removed Billing v2 settings cannot be reconstructed safely.
    pass
