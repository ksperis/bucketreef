from importlib import util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, select, text

from app.db import User
from app.db.browser_favorite import BrowserFavorite
from app.main import app
from app.models.browser_favorites import BrowserFavoriteInput
from app.routers import dependencies
from app.services.browser_favorites_service import BrowserFavoritesService


def login(db, email):
    user = User(email=email, role="ui_user", is_active=True)
    db.add(user); db.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    return user


def payload(**values):
    return {"name": "Mes fichiers", "context": "account-101", "bucket": "archive", "prefix": " données//", **values}


def test_favorites_are_personal(client, db_session):
    first = login(db_session, "first@example.test")
    created = client.post("/api/users/me/browser-favorites", json=payload())
    assert created.status_code == 201, created.text
    saved = created.json()
    assert saved["prefix"] == " données//"
    assert "view" not in saved and "kind" not in saved
    login(db_session, "second@example.test")
    assert client.get("/api/users/me/browser-favorites").json() == []
    assert client.put(f'/api/users/me/browser-favorites/{saved["id"]}?revision=1', json=payload()).status_code == 404
    assert client.delete(f'/api/users/me/browser-favorites/{saved["id"]}?revision=1').status_code == 404
    app.dependency_overrides[dependencies.get_current_user] = lambda: first
    assert len(client.get("/api/users/me/browser-favorites").json()) == 1


def test_two_clients_cannot_overwrite_or_delete_a_newer_revision(client, db_session):
    login(db_session, "first@example.test")
    saved = client.post("/api/users/me/browser-favorites", json=payload()).json()
    path = f'/api/users/me/browser-favorites/{saved["id"]}'
    updated = client.put(path, params={"revision": 1}, json=payload(name="Renamed"))
    assert updated.status_code == 200 and updated.json()["revision"] == 2
    assert client.put(path, params={"revision": 1}, json=payload(name="Stale")).status_code == 409
    assert client.delete(path, params={"revision": 1}).status_code == 409
    assert client.get("/api/users/me/browser-favorites").json()[0]["name"] == "Renamed"
    assert client.delete(path, params={"revision": 2}).status_code == 204


def test_favorite_create_rolls_back_when_commit_fails(db_session, monkeypatch):
    user = login(db_session, "create-rollback@example.test")
    service = BrowserFavoritesService(db_session)
    original_rollback = db_session.rollback
    rollback_calls: list[None] = []

    def rollback() -> None:
        rollback_calls.append(None)
        original_rollback()

    def commit() -> None:
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "rollback", rollback)
    monkeypatch.setattr(db_session, "commit", commit)

    with pytest.raises(RuntimeError, match="commit failed"):
        service.create(user, BrowserFavoriteInput.model_validate(payload()))

    assert rollback_calls == [None]
    assert db_session.scalars(
        select(BrowserFavorite).where(BrowserFavorite.user_id == user.id)
    ).all() == []


def test_favorite_mutation_rolls_back_when_commit_fails(db_session, monkeypatch):
    user = login(db_session, "mutate-rollback@example.test")
    service = BrowserFavoritesService(db_session)
    created = service.create(user, BrowserFavoriteInput.model_validate(payload()))
    original_rollback = db_session.rollback
    rollback_calls: list[None] = []

    def rollback() -> None:
        rollback_calls.append(None)
        original_rollback()

    def commit() -> None:
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "rollback", rollback)
    monkeypatch.setattr(db_session, "commit", commit)

    with pytest.raises(RuntimeError, match="commit failed"):
        service.mutate(
            user,
            created.id,
            created.revision,
            BrowserFavoriteInput.model_validate(payload(name="Renamed")),
        )

    assert rollback_calls == [None]
    db_session.expire_all()
    stored = db_session.get(BrowserFavorite, created.id)
    assert stored is not None
    assert stored.name == "Mes fichiers"
    assert stored.revision == 1


def test_favorites_reject_secrets_and_obsolete_view_fields(client, db_session):
    login(db_session, "first@example.test")
    assert client.post("/api/users/me/browser-favorites", json=payload(access_key="secret")).status_code == 422
    assert client.post("/api/users/me/browser-favorites", json=payload(view={"file_filters": {"min_size": 20, "max_size": 1}})).status_code == 422
    assert client.post("/api/users/me/browser-favorites", json=payload(surface="unknown")).status_code == 422
    assert client.post("/api/users/me/browser-favorites", json=payload(workspace="manager")).status_code == 422
    assert client.post("/api/users/me/browser-favorites", json=payload(kind="favorite")).status_code == 422
    assert "/api/users/me/browser-presets" not in app.openapi()["paths"]


def test_temporary_sessions_cannot_use_favorites(client):
    from types import SimpleNamespace
    app.dependency_overrides[dependencies.get_current_user] = lambda: SimpleNamespace(role="s3_session")
    assert client.get("/api/users/me/browser-favorites").status_code == 403



def load_migration(name, operations, monkeypatch):
    source = Path(__file__).parents[1] / "alembic/versions" / name
    spec = util.spec_from_file_location(name, source)
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    monkeypatch.setattr(migration, "op", operations)
    return migration


def test_path_favorite_migration_keeps_identity_and_drops_saved_views(monkeypatch):
    import json
    from datetime import datetime, timezone
    from sqlalchemy import bindparam, column, select, table
    from app.db.utc_datetime import UTCDateTime

    engine = create_engine("sqlite://")
    stamp = datetime(2026, 9, 28, 8, 15, tzinfo=timezone.utc)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        connection.execute(text("INSERT INTO users (id) VALUES (1), (2)"))
        operations = Operations(MigrationContext.configure(connection))
        old = load_migration("0135_browser_presets.py", operations, monkeypatch)
        new = load_migration("0137_browser_path_favorites.py", operations, monkeypatch)
        old.upgrade()
        insert_preset = text(
            "INSERT INTO browser_presets VALUES "
            "(:id, :user_id, :surface, :payload, 7, :created, :updated)"
        ).bindparams(
            bindparam("created", type_=UTCDateTime()),
            bindparam("updated", type_=UTCDateTime()),
        )
        for identifier, owner, kind, surface in [("favorite-a", 1, "favorite", "browser"), ("favorite-b", 2, "favorite", "portal"), ("view-a", 1, "view", "browser")]:
            data = payload(name=identifier, kind=kind, workspace=surface, surface=surface, view={"query": "csv"} if kind == "view" else None)
            connection.execute(insert_preset, dict(id=identifier, user_id=owner, surface=surface, payload=json.dumps(data), created=stamp, updated=stamp))
        new.upgrade()
        expected = {"id", "user_id", "name", "surface", "workspace", "context", "bucket", "prefix", "revision", "created_at", "updated_at"}
        assert {c["name"] for c in inspect(connection).get_columns("browser_favorites")} == expected
        assert "browser_presets" not in inspect(connection).get_table_names()
        rows = connection.execute(text("SELECT * FROM browser_favorites ORDER BY id")).mappings().all()
        assert [row["id"] for row in rows] == ["favorite-a", "favorite-b"]
        assert [row["user_id"] for row in rows] == [1, 2]
        assert all(row["revision"] == 7 and row["prefix"] == " données//" for row in rows)
        assert [row["workspace"] for row in rows] == ["browser", "portal"]
        timestamps = table("browser_favorites", column("created_at", UTCDateTime()), column("updated_at", UTCDateTime()))
        assert all(created == stamp and updated == stamp for created, updated in connection.execute(select(timestamps)))
        assert inspect(connection).get_foreign_keys("browser_favorites")[0]["options"]["ondelete"] == "CASCADE"
        new.downgrade()
        restored = connection.execute(text("SELECT payload_json FROM browser_presets")).scalars().all()
        assert len(restored) == 2
        assert all(json.loads(row)["kind"] == "favorite" for row in restored)
        new.upgrade()
        assert connection.execute(text("SELECT COUNT(*) FROM browser_favorites")).scalar() == 2


def test_path_favorite_migration_accepts_an_empty_database(monkeypatch):
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        operations = Operations(MigrationContext.configure(connection))
        load_migration("0135_browser_presets.py", operations, monkeypatch).upgrade()
        migration = load_migration("0137_browser_path_favorites.py", operations, monkeypatch)
        migration.upgrade()
        assert connection.execute(text("SELECT COUNT(*) FROM browser_favorites")).scalar() == 0
        migration.downgrade()
        migration.upgrade()


def test_canonical_browser_favorites_migration_removes_retired_surface_state(monkeypatch):
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        connection.execute(text("INSERT INTO users (id) VALUES (1)"))
        connection.execute(text(
            "CREATE TABLE browser_favorites ("
            "id VARCHAR(36) PRIMARY KEY, user_id INTEGER NOT NULL, name VARCHAR(120) NOT NULL, "
            "surface VARCHAR(24) NOT NULL, workspace VARCHAR(24) NOT NULL, "
            "context VARCHAR(256) NOT NULL, bucket VARCHAR(255) NOT NULL, "
            "prefix VARCHAR(1024) NOT NULL, revision INTEGER NOT NULL, "
            "created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, "
            "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
        ))
        connection.execute(text(
            "CREATE INDEX ix_browser_favorites_user_surface "
            "ON browser_favorites (user_id, surface)"
        ))
        connection.execute(text(
            "INSERT INTO browser_favorites VALUES "
            "('browser-root', 1, 'Root', 'browser', 'browser', '101', 'a', '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
            "('browser-legacy-workspace', 1, 'Legacy', 'browser', 'manager', '101', 'b', '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
            "('embedded', 1, 'Embedded', 'portal', 'portal', '101', 'c', '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        operations = Operations(MigrationContext.configure(connection))
        migration = load_migration("0249_canonical_browser_favorites.py", operations, monkeypatch)

        migration.upgrade()

        columns = {column["name"] for column in inspect(connection).get_columns("browser_favorites")}
        assert columns == {
            "id", "user_id", "name", "context", "bucket", "prefix",
            "revision", "created_at", "updated_at",
        }
        rows = connection.execute(
            text("SELECT id, bucket FROM browser_favorites ORDER BY id")
        ).mappings().all()
        assert [dict(row) for row in rows] == [
            {"id": "browser-legacy-workspace", "bucket": "b"},
            {"id": "browser-root", "bucket": "a"},
        ]
        index_names = {index["name"] for index in inspect(connection).get_indexes("browser_favorites")}
        assert "ix_browser_favorites_user_id" in index_names
        assert "ix_browser_favorites_user_surface" not in index_names

        migration.downgrade()

        restored = connection.execute(
            text("SELECT id, surface, workspace FROM browser_favorites ORDER BY id")
        ).mappings().all()
        assert [dict(row) for row in restored] == [
            {"id": "browser-legacy-workspace", "surface": "browser", "workspace": "browser"},
            {"id": "browser-root", "surface": "browser", "workspace": "browser"},
        ]
        restored_indexes = {index["name"] for index in inspect(connection).get_indexes("browser_favorites")}
        assert "ix_browser_favorites_user_surface" in restored_indexes
        assert "ix_browser_favorites_user_id" not in restored_indexes


def test_full_alembic_chain_upgrades_empty_database_and_round_trips(tmp_path):
    from alembic import command
    from alembic.config import Config

    backend = Path(__file__).parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    config.attributes["configure_logger"] = False
    expected_head = ScriptDirectory.from_config(config).get_current_head()
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        assert "browser_favorites" in inspect(connection).get_table_names()
        assert "browser_presets" not in inspect(connection).get_table_names()
        assert {column["name"] for column in inspect(connection).get_columns("browser_favorites")} == {
            "id", "user_id", "name", "context", "bucket", "prefix",
            "revision", "created_at", "updated_at",
        }
        command.downgrade(config, "0136_merge_browser_migration_heads")
        assert "browser_presets" in inspect(connection).get_table_names()
        command.upgrade(config, "head")
        assert "browser_presets" not in inspect(connection).get_table_names()
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == expected_head
