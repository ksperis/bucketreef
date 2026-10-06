# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Return Ceph Admin to external credentials while preserving stored pairs."""
import sqlalchemy as sa
from alembic import op

revision = "0143_external_ceph_admin_credentials"
down_revision = "0142_explicit_service_identity_provisioning"
branch_labels = None
depends_on = None


def _cutover_to_external():
    connection = op.get_bind()
    identities = sa.table("endpoint_service_identities",
        sa.column("kind"), sa.column("mode"), sa.column("rgw_uid"),
        sa.column("access_key"), sa.column("secret_key"), sa.column("provenance"),
        sa.column("status"), sa.column("last_error"), sa.column("last_reconciled_at"))
    intents = sa.table("key_rotation_intents", sa.column("key_type"))
    connection.execute(intents.delete().where(intents.c.key_type == "ceph_admin"))
    connection.execute(identities.update().where(identities.c.kind == "ceph_admin").values(
        mode="external", rgw_uid=None, provenance=None,
        status="missing",
        last_error=None, last_reconciled_at=None))


def _reset_to_managed():
    connection = op.get_bind()
    identities = sa.table("endpoint_service_identities",
        sa.column("kind"), sa.column("mode"), sa.column("rgw_uid"),
        sa.column("access_key"), sa.column("secret_key"), sa.column("provenance"),
        sa.column("status"), sa.column("last_error"), sa.column("last_reconciled_at"))
    intents = sa.table("key_rotation_intents", sa.column("key_type"))
    connection.execute(intents.delete().where(intents.c.key_type == "ceph_admin"))
    connection.execute(identities.update().where(identities.c.kind == "ceph_admin").values(
        mode="managed", rgw_uid=None, access_key=None, secret_key=None, provenance=None,
        status="missing", last_error=None, last_reconciled_at=None))


def upgrade():
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.drop_constraint("ck_endpoint_service_identity_ceph_admin_managed", type_="check")
    _cutover_to_external()
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.create_check_constraint("ck_endpoint_service_identity_ceph_admin_external",
            "kind != 'ceph_admin' OR mode = 'external'")


def downgrade():
    # The previous managed-only contract cannot safely represent operator-owned keys.
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.drop_constraint("ck_endpoint_service_identity_ceph_admin_external", type_="check")
    _reset_to_managed()
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.create_check_constraint("ck_endpoint_service_identity_ceph_admin_managed",
            "kind != 'ceph_admin' OR mode = 'managed'")
