# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
import pytest
import sqlalchemy as sa

from app.core.config import get_settings
from app.db import Base


_EXPECTED_ALEMBIC_HEAD = "0195_openstack_catalog_targets"


def _alembic_config() -> Config:
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["configure_logger"] = False
    return config


def test_alembic_exposes_single_merge_head():
    script = ScriptDirectory.from_config(_alembic_config())

    assert script.get_heads() == [_EXPECTED_ALEMBIC_HEAD]


def test_alembic_head_matches_sqlalchemy_metadata(tmp_path, monkeypatch):
    database_path = tmp_path / "schema-current.sqlite"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    try:
        command.upgrade(config, "head")
        engine = sa.create_engine(f"sqlite:///{database_path}")
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection,
                opts={"compare_type": True},
            )
            assert compare_metadata(context, Base.metadata) == []
        engine.dispose()
    finally:
        get_settings.cache_clear()


def test_openstack_catalog_target_migration_marks_existing_context_for_reactivation(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "openstack-catalog-cutover.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, "0194_openstack_connect")
        with engine.begin() as connection:
            connection.execute(sa.text("PRAGMA foreign_keys=OFF"))
            connection.execute(sa.text(
                "INSERT INTO storage_endpoints "
                "(id, name, endpoint_url, provider, region, is_default, is_editable, created_at, updated_at, "
                "verify_tls, force_path_style, identity_namespace, ceph_admin_allowed) "
                "VALUES (91, 'Legacy S3', 'https://legacy-s3.example.test', 'ceph', 'legacy-region', 0, 1, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 'legacy-openstack', 0)"
            ))
            connection.execute(sa.text(
                "INSERT INTO openstack_clouds "
                "(id, name, auth_url, enabled, allow_password, allow_token, all_users, created_at) "
                "VALUES (7, 'Legacy cloud', 'https://identity.example.test/v3', 1, 1, 1, 0, CURRENT_TIMESTAMP)"
            ))
            connection.execute(sa.text(
                "INSERT INTO openstack_cloud_endpoints (cloud_id, endpoint_id) VALUES (7, 91)"
            ))
            connection.execute(sa.text(
                "INSERT INTO openstack_connections "
                "(id, user_id, cloud_id, keystone_user_id, display_name, created_at) "
                "VALUES ('conn-legacy', 1, 7, 'keystone-user', 'Legacy user', CURRENT_TIMESTAMP)"
            ))
            connection.execute(sa.text(
                "INSERT INTO openstack_project_contexts "
                "(id, connection_id, endpoint_id, project_id, project_name) "
                "VALUES ('ctx-legacy', 'conn-legacy', 91, 'project-legacy', 'Legacy project')"
            ))

        command.upgrade(config, "head")

        with engine.connect() as connection:
            row = connection.execute(sa.text(
                "SELECT endpoint_id, target_id, region_id, endpoint_url, endpoint_name, "
                "endpoint_interface, service_type, service_name "
                "FROM openstack_project_contexts WHERE id = 'ctx-legacy'"
            )).mappings().one()
            assert row == {
                "endpoint_id": 91,
                "target_id": "legacy-storage-endpoint:91",
                "region_id": "legacy-region",
                "endpoint_url": "https://legacy-s3.example.test",
                "endpoint_name": "Legacy S3",
                "endpoint_interface": "legacy",
                "service_type": "s3",
                "service_name": "Legacy S3",
            }
            assert "openstack_cloud_endpoints" not in sa.inspect(connection).get_table_names()
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_billing_rate_plan_migration_backfills_existing_cards_and_assignments(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "billing-rate-plan-cutover.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, "0158_connection_rgw_identity")
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO storage_endpoints "
                    "(id, name, endpoint_url, provider, is_default, is_editable, created_at, updated_at, "
                    "verify_tls, force_path_style, identity_namespace, ceph_admin_allowed) "
                    "VALUES (41, 'Billing endpoint', 'https://billing.example.test', 'ceph', 0, 1, "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 'billing-cutover', 0)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_rate_cards "
                    "(id, name, currency, storage_gb_month_price, effective_from, storage_endpoint_id, "
                    "created_at, updated_at) "
                    "VALUES (51, 'default', 'EUR', 0.020000, '2026-03-01', 41, "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_assignments "
                    "(id, storage_endpoint_id, rate_card_id, created_at) "
                    "VALUES (61, 41, 51, CURRENT_TIMESTAMP)"
                )
            )

        command.upgrade(config, "0159_billing_rate_card_versions")

        with engine.connect() as connection:
            plan = connection.execute(
                sa.text(
                    "SELECT id, name, storage_endpoint_id FROM billing_rate_plans WHERE name = 'default'"
                )
            ).mappings().one()
            card = connection.execute(
                sa.text(
                    "SELECT rate_plan_id, storage_charge_basis, effective_from, effective_to "
                    "FROM billing_rate_cards WHERE id = 51"
                )
            ).mappings().one()
            assignment = connection.execute(
                sa.text(
                    "SELECT rate_plan_id, effective_from, effective_to "
                    "FROM billing_assignments WHERE id = 61"
                )
            ).mappings().one()

            assert plan["storage_endpoint_id"] == 41
            assert card["rate_plan_id"] == plan["id"]
            assert card["storage_charge_basis"] == "actual_usage"
            assert str(card["effective_from"]) == "2026-03-01"
            assert assignment["rate_plan_id"] == plan["id"]
            assert str(assignment["effective_from"]) == "2026-03-01"
            assert assignment["effective_to"] is None
            assert "ck_billing_rate_cards_storage_charge_basis" in {
                item["name"]
                for item in sa.inspect(connection).get_check_constraints("billing_rate_cards")
            }

        command.downgrade(config, "0158_connection_rgw_identity")
        with engine.connect() as connection:
            restored_card = connection.execute(
                sa.text(
                    "SELECT name, storage_endpoint_id FROM billing_rate_cards WHERE id = 51"
                )
            ).mappings().one()
            restored_assignment = connection.execute(
                sa.text("SELECT rate_card_id FROM billing_assignments WHERE id = 61")
            ).mappings().one()
            assert restored_card == {"name": "default", "storage_endpoint_id": 41}
            assert restored_assignment["rate_card_id"] == 51
            assert "billing_rate_plans" not in sa.inspect(connection).get_table_names()
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_billing_0216_restore_preserves_history_and_resets_v2_configuration(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "billing-0216-restore.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, "0166_billing_statement_estimation")
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO storage_endpoints "
                    "(id, name, endpoint_url, provider, is_default, is_editable, created_at, updated_at, "
                    "verify_tls, force_path_style, identity_namespace, ceph_admin_allowed) "
                    "VALUES (91, 'Billing restore endpoint', 'https://restore.example.test', 'ceph', 0, 1, "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 'billing-restore', 0)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_usage_daily "
                    "(id, day, storage_endpoint_id, bytes_in, bytes_out, ops_total, source, collected_at) "
                    "VALUES (92, '2026-10-01', 91, 123, 456, 7, 'rgw_admin_usage', CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_storage_daily "
                    "(id, day, storage_endpoint_id, total_bytes, total_objects, source, collected_at, "
                    "quota_size_bytes, quota_state) "
                    "VALUES (93, '2026-10-01', 91, 789, 8, 'rgw_admin_bucket_stats', CURRENT_TIMESTAMP, "
                    "4096, 'valid')"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_rate_plans "
                    "(id, name, storage_endpoint_id, created_at, updated_at) "
                    "VALUES (94, 'v2-plan', 91, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_rate_cards "
                    "(id, currency, storage_gb_month_price, effective_from, rate_plan_id, "
                    "storage_charge_basis, created_at, updated_at) "
                    "VALUES (95, 'EUR', 0.020000, '2026-10-01', 94, 'allocated_quota', "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_assignments "
                    "(id, storage_endpoint_id, rate_plan_id, effective_from, created_at, updated_at) "
                    "VALUES (96, 91, 94, '2026-10-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_entities "
                    "(id, name, subject_type, active, created_at, updated_at) "
                    "VALUES (97, 'V2 entity', 'account', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_statements "
                    "(id, public_id, billing_entity_id, billing_entity_name, subject_type, period_start, "
                    "period_end, currency, status, member_count, coverage_json, blockers_json, "
                    "storage_charge_bases_json, subtotal, total, source_fingerprint, revision, generated_at, "
                    "created_at, updated_at, estimation_mode) "
                    "VALUES (98, '00000000-0000-0000-0000-000000000098', 97, 'V2 entity', 'account', "
                    "'2026-10-01', '2026-10-31', 'EUR', 'draft', 0, '{}', '[]', '[]', 0, 0, "
                    "'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'strict')"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO app_settings (key, payload_json, created_at, updated_at) "
                    "VALUES ('default', :payload_json, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "payload_json": json.dumps(
                        {
                            "general": {"billing_enabled": True},
                            "billing_automation": {"mode": "automatic_draft"},
                            "billing_statement_pdf": {"organization_name": "BucketReef"},
                        }
                    )
                },
            )

        command.upgrade(config, "head")

        with engine.connect() as connection:
            inspector = sa.inspect(connection)
            table_names = set(inspector.get_table_names())
            assert {
                "billing_rate_plans",
                "billing_entities",
                "billing_entity_groups",
                "billing_statements",
                "billing_statement_lines",
                "billing_automation_runs",
            }.isdisjoint(table_names)

            usage = connection.execute(
                sa.text(
                    "SELECT bytes_in, bytes_out, ops_total FROM cost_usage_daily WHERE id = 92"
                )
            ).mappings().one()
            assert usage == {"bytes_in": 123, "bytes_out": 456, "ops_total": 7}
            storage = connection.execute(
                sa.text(
                    "SELECT total_bytes, total_objects FROM cost_storage_daily WHERE id = 93"
                )
            ).mappings().one()
            assert storage == {"total_bytes": 789, "total_objects": 8}
            storage_columns = {
                column["name"] for column in inspector.get_columns("cost_storage_daily")
            }
            assert "quota_size_bytes" not in storage_columns
            assert "quota_state" not in storage_columns

            assert "billing_usage_daily" not in table_names
            assert "billing_storage_daily" not in table_names
            assert "billing_rate_cards" not in table_names
            assert "billing_assignments" not in table_names
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM cost_models")) == 0
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM cost_endpoint_overrides")) == 0
            app_settings = json.loads(
                connection.scalar(
                    sa.text(
                        "SELECT payload_json FROM app_settings WHERE key = 'default'"
                    )
                )
            )
            assert app_settings == {"general": {"cost_enabled": True}}

        command.downgrade(config, "0166_billing_statement_estimation")
        with engine.connect() as connection:
            inspector = sa.inspect(connection)
            table_names = set(inspector.get_table_names())
            assert "billing_rate_plans" in table_names
            assert "billing_entities" in table_names
            assert "billing_statements" in table_names
            assert "billing_automation_runs" in table_names
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM billing_rate_plans")) == 0
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM billing_rate_cards")) == 0
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM billing_assignments")) == 0
            storage_columns = {
                column["name"] for column in inspector.get_columns("billing_storage_daily")
            }
            assert {"quota_size_bytes", "quota_state"}.issubset(storage_columns)
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_billing_0216_followup_removes_retired_settings_from_existing_0167_database(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "billing-0216-settings-followup.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, "0167_restore_billing_0216_model")
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO app_settings (key, payload_json, created_at, updated_at) "
                    "VALUES ('default', :payload_json, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "payload_json": json.dumps(
                        {
                            "general": {"billing_enabled": True},
                            "billing_automation": {"mode": "automatic_draft"},
                            "billing_statement_pdf": {"organization_name": "BucketReef"},
                        }
                    )
                },
            )

        command.upgrade(config, "head")

        with engine.connect() as connection:
            payload = json.loads(
                connection.scalar(
                    sa.text(
                        "SELECT payload_json FROM app_settings WHERE key = 'default'"
                    )
                )
            )
            assert payload == {"general": {"cost_enabled": True}}
            assert connection.scalar(
                sa.text("SELECT version_num FROM alembic_version")
            ) == _EXPECTED_ALEMBIC_HEAD
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_billing_quota_history_migration_marks_existing_storage_rows_missing(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "billing-quota-history-cutover.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, "0159_billing_rate_card_versions")
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO storage_endpoints "
                    "(id, name, endpoint_url, provider, is_default, is_editable, created_at, updated_at, "
                    "verify_tls, force_path_style, identity_namespace, ceph_admin_allowed) "
                    "VALUES (71, 'Billing quota endpoint', 'https://quota.example.test', 'ceph', 0, 1, "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 'billing-quota', 0)"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO billing_storage_daily "
                    "(id, day, storage_endpoint_id, total_bytes, total_objects, source, collected_at) "
                    "VALUES (81, '2026-09-01', 71, 1024, 1, 'rgw_admin_bucket_stats', CURRENT_TIMESTAMP)"
                )
            )

        command.upgrade(config, "0160_billing_storage_quota_history")

        with engine.connect() as connection:
            row = connection.execute(
                sa.text(
                    "SELECT quota_size_bytes, quota_state FROM billing_storage_daily WHERE id = 81"
                )
            ).mappings().one()
            assert row == {"quota_size_bytes": None, "quota_state": "missing"}
            assert "ck_billing_storage_daily_quota_state" in {
                item["name"]
                for item in sa.inspect(connection).get_check_constraints("billing_storage_daily")
            }
    finally:
        engine.dispose()
        get_settings.cache_clear()


@pytest.mark.parametrize(
    "starting_revision",
    [
        "0134_portal_collaborator_delegation",
        "0135_bucket_migration_workflow",
        "0135_browser_presets",
    ],
)
def test_alembic_merge_head_upgrades_from_each_branch(
    tmp_path,
    monkeypatch,
    starting_revision: str,
):
    database_path = tmp_path / f"upgrade-{starting_revision}.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, starting_revision)
        with engine.connect() as connection:
            table_names = set(sa.inspect(connection).get_table_names())
            migration_columns = {
                column["name"]
                for column in sa.inspect(connection).get_columns("bucket_migrations")
            }
            assert ("browser_presets" in table_names) is (
                starting_revision == "0135_browser_presets"
            )
            assert ("workflow_version" in migration_columns) is (
                starting_revision == "0135_bucket_migration_workflow"
            )

        command.upgrade(config, "head")

        with engine.connect() as connection:
            assert connection.scalars(
                sa.text("SELECT version_num FROM alembic_version")
            ).all() == [_EXPECTED_ALEMBIC_HEAD]
            table_names = set(sa.inspect(connection).get_table_names())
            assert "browser_favorites" in table_names
            assert "browser_presets" not in table_names
            assert "workflow_version" in {
                column["name"]
                for column in sa.inspect(connection).get_columns("bucket_migrations")
            }
            context = MigrationContext.configure(
                connection,
                opts={"compare_type": True},
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_canonical_audit_context_migration_backfills_and_drops_legacy_columns(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "audit-context-cutover.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, "0154_bucket_usage_stats_collection_policy")
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO audit_logs "
                    "(created_at, user_email, user_role, scope, action, account_id, account_name, status) "
                    "VALUES (CURRENT_TIMESTAMP, 'admin@example.test', 'ui_admin', 'admin', "
                    "'legacy-account-event', 42, 'Research', 'success')"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO audit_logs "
                    "(created_at, user_email, user_role, scope, action, account_id, account_name, "
                    "context_kind, context_id, context_name, status) "
                    "VALUES (CURRENT_TIMESTAMP, 'portal@example.test', 'ui_user', 'portal', "
                    "'legacy-portal-event', 43, 'Portal Research', 'account', '43', "
                    "'Portal Research', 'success')"
                )
            )

        command.upgrade(config, "head")

        with engine.connect() as connection:
            columns = {column["name"] for column in sa.inspect(connection).get_columns("audit_logs")}
            assert "account_id" not in columns
            assert "account_name" not in columns
            row = connection.execute(
                sa.text(
                    "SELECT context_kind, context_id, context_name "
                    "FROM audit_logs WHERE action = 'legacy-account-event'"
                )
            ).one()
            assert tuple(row) == ("account", "42", "Research")
            portal_row = connection.execute(
                sa.text(
                    "SELECT context_kind, context_id, context_name "
                    "FROM audit_logs WHERE action = 'legacy-portal-event'"
                )
            ).one()
            assert tuple(portal_row) == ("portal_account", "43", "Portal Research")
    finally:
        engine.dispose()
        get_settings.cache_clear()
