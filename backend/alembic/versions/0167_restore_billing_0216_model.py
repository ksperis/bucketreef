"""Restore the Billing data model used by BucketReef 0.2.16.

The 0.2.17 Billing configuration model is intentionally reset. Daily usage and
storage history are preserved, while versioned rate plans, entities, groups,
statements, automation runs, and their configuration are removed. Rate cards
and assignments are recreated empty in the 0.2.16 shape and must be configured
again after upgrade.

Downgrading recreates the 0.2.17 schema so the Alembic chain remains valid, but
cannot restore the Billing configuration data discarded by the upgrade.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic import op


revision = "0167_restore_billing_0216_model"
down_revision = "0166_billing_statement_estimation"
branch_labels = None
depends_on = None


def _load_revision(filename: str) -> ModuleType:
    path = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(f"bucketreef_alembic_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load historical migration {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(filename: str, direction: str) -> None:
    migration = _load_revision(filename)
    getattr(migration, direction)()


def _drop_retired_app_settings() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, payload_json FROM app_settings")
    ).mappings()
    for row in rows:
        payload = json.loads(row["payload_json"])
        if not isinstance(payload, dict):
            continue
        changed = False
        for key in ("billing_automation", "billing_statement_pdf"):
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


def upgrade() -> None:
    # Unwind only the Billing-specific 0.2.17 schema. Revision 0165 changes
    # S3-account name uniqueness and remains part of the current schema.
    _run("0166_billing_statement_estimation.py", "downgrade")
    _run("0164_billing_statement_automation.py", "downgrade")
    _run("0163_billing_statements.py", "downgrade")
    _run("0162_billing_entity_groups.py", "downgrade")
    _run("0161_billing_entities.py", "downgrade")
    _run("0160_billing_storage_quota_history.py", "downgrade")

    # Reset all 0.2.17 tariff configuration before converting the remaining
    # versioned tables back to the 0.2.16 layout. Daily measurements are not
    # touched.
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM billing_assignments"))
    bind.execute(sa.text("DELETE FROM billing_rate_cards"))
    bind.execute(sa.text("DELETE FROM billing_rate_plans"))
    _run("0159_billing_rate_card_versions.py", "downgrade")
    _drop_retired_app_settings()


def downgrade() -> None:
    # Recreate the 0.2.17 Billing schema from empty 0.2.16 configuration.
    # Configuration removed during upgrade is intentionally unrecoverable.
    _run("0159_billing_rate_card_versions.py", "upgrade")
    _run("0160_billing_storage_quota_history.py", "upgrade")
    _run("0161_billing_entities.py", "upgrade")
    _run("0162_billing_entity_groups.py", "upgrade")
    _run("0163_billing_statements.py", "upgrade")
    _run("0164_billing_statement_automation.py", "upgrade")
    _run("0166_billing_statement_estimation.py", "upgrade")
