from importlib import util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text

from app.db import User
from app.main import app
from app.routers import dependencies


def login(db, email):
    user = User(email=email, role="ui_user", is_active=True)
    db.add(user); db.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    return user


def payload(**values):
    return {"name": "Mes CSV", "kind": "view", "surface": "browser", "context": "account-101", "bucket": "archive", "prefix": " données//", "view": {"file_filters": {"extensions": [".csv"], "min_size": 10}}, **values}


def test_presets_are_personal_and_surface_scoped(client, db_session):
    first = login(db_session, "first@example.test")
    created = client.post("/api/users/me/browser-presets", json=payload())
    assert created.status_code == 201, created.text
    saved = created.json()
    assert saved["prefix"] == " données//"
    assert saved["view"]["file_filters"]["extensions"] == ["csv"]
    assert client.get("/api/users/me/browser-presets", params={"surface": "manager"}).json() == []
    login(db_session, "second@example.test")
    assert client.get("/api/users/me/browser-presets").json() == []
    assert client.put(f'/api/users/me/browser-presets/{saved["id"]}?revision=1', json=payload()).status_code == 404
    assert client.delete(f'/api/users/me/browser-presets/{saved["id"]}?revision=1').status_code == 404
    app.dependency_overrides[dependencies.get_current_user] = lambda: first
    assert len(client.get("/api/users/me/browser-presets").json()) == 1


def test_two_clients_cannot_overwrite_or_delete_a_newer_revision(client, db_session):
    login(db_session, "first@example.test")
    saved = client.post("/api/users/me/browser-presets", json=payload()).json()
    path = f'/api/users/me/browser-presets/{saved["id"]}'
    updated = client.put(path, params={"revision": 1}, json=payload(name="Renamed"))
    assert updated.status_code == 200 and updated.json()["revision"] == 2
    assert client.put(path, params={"revision": 1}, json=payload(name="Stale")).status_code == 409
    assert client.delete(path, params={"revision": 1}).status_code == 409
    assert client.get("/api/users/me/browser-presets").json()[0]["name"] == "Renamed"
    assert client.delete(path, params={"revision": 2}).status_code == 204


def test_presets_reject_secrets_and_invalid_filters(client, db_session):
    login(db_session, "first@example.test")
    assert client.post("/api/users/me/browser-presets", json=payload(access_key="secret")).status_code == 422
    assert client.post("/api/users/me/browser-presets", json=payload(view={"file_filters": {"min_size": 20, "max_size": 1}})).status_code == 422
    assert client.post("/api/users/me/browser-presets", json=payload(surface="unknown")).status_code == 422


def test_temporary_sessions_cannot_use_presets(client):
    from types import SimpleNamespace
    app.dependency_overrides[dependencies.get_current_user] = lambda: SimpleNamespace(role="s3_session")
    assert client.get("/api/users/me/browser-presets").status_code == 403


def test_preset_migration_round_trip(monkeypatch):
    source = Path(__file__).parents[1] / "alembic/versions/0135_browser_presets.py"
    spec = util.spec_from_file_location("preset_migration", source)
    migration = util.module_from_spec(spec); spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        assert {column["name"] for column in inspect(connection).get_columns("browser_presets")} == {"id", "user_id", "surface", "payload_json", "revision", "created_at", "updated_at"}
        assert inspect(connection).get_foreign_keys("browser_presets")[0]["options"]["ondelete"] == "CASCADE"
        migration.downgrade()
        assert "browser_presets" not in inspect(connection).get_table_names()
