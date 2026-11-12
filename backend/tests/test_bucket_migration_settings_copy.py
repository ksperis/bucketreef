# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import ANY

import pytest

from app.db import BucketMigration, BucketMigrationItem
from app.services.bucket_migration.diagnostics import MigrationSettingsCopyError
from app.services.bucket_migration_service import BucketMigrationService
from app.services.s3_client import S3OperationError


class _SettingsStub:
    def __init__(
        self,
        *,
        fail_write: str | None = None,
        versioning_status: str | None = "Enabled",
    ) -> None:
        self.fail_write = fail_write
        self.versioning_status = versioning_status
        self.calls: list[tuple[str, object]] = []

    def _read(self, name: str, value):
        self.calls.append((name, None))
        return value

    def _write(self, name: str, value=None) -> None:
        self.calls.append((name, value))
        if name == self.fail_write:
            raise S3OperationError(f"{name} failed")

    def get_bucket_properties(self, *_args):
        return self._read(
            "get_bucket_properties",
            SimpleNamespace(versioning_status=self.versioning_status),
        )

    def set_versioning(self, *_args, enabled: bool):
        self._write("set_versioning", enabled)

    def get_bucket_object_lock(self, *_args):
        return self._read(
            "get_bucket_object_lock",
            SimpleNamespace(enabled=True, mode="GOVERNANCE", days=7, years=None),
        )

    def set_object_lock(self, *_args):
        self._write("set_object_lock")

    def get_bucket_encryption(self, *_args):
        return self._read(
            "get_bucket_encryption",
            SimpleNamespace(rules=[{"algorithm": "AES256"}]),
        )

    def set_bucket_encryption(self, *_args):
        self._write("set_bucket_encryption")

    def delete_bucket_encryption(self, *_args):
        self._write("delete_bucket_encryption")

    def get_public_access_block(self, *_args):
        return self._read(
            "get_public_access_block",
            SimpleNamespace(
                block_public_acls=True,
                ignore_public_acls=False,
                block_public_policy=False,
                restrict_public_buckets=False,
            ),
        )

    def set_public_access_block(self, *_args):
        self._write("set_public_access_block")

    def get_lifecycle(self, *_args):
        return self._read("get_lifecycle", SimpleNamespace(rules=[]))

    def set_lifecycle(self, *_args):
        self._write("set_lifecycle")

    def delete_lifecycle(self, *_args):
        self._write("delete_lifecycle")

    def get_bucket_cors(self, *_args):
        return self._read("get_bucket_cors", [{"allowed_methods": ["GET"]}])

    def set_cors(self, *_args):
        self._write("set_cors")

    def delete_cors(self, *_args):
        self._write("delete_cors")

    def get_policy(self, *_args):
        return self._read("get_policy", None)

    def put_policy(self, *_args):
        self._write("put_policy")

    def delete_policy(self, *_args):
        self._write("delete_policy")

    def get_bucket_tags(self, *_args):
        return self._read(
            "get_bucket_tags",
            [SimpleNamespace(key="team", value="storage")],
        )

    def set_bucket_tags(self, *_args):
        self._write("set_bucket_tags", _args[-1])

    def delete_bucket_tags(self, *_args):
        self._write("delete_bucket_tags")

    def get_bucket_logging(self, *_args):
        return self._read("get_bucket_logging", {"enabled": True})

    def set_bucket_logging(self, *_args):
        self._write("set_bucket_logging")


def _install_in_memory_checkpoint(service, *, strategy: str):
    migration = BucketMigration(
        id=1,
        source_context_id="source",
        target_context_id="target",
    )
    item = BucketMigrationItem(
        id=1,
        migration_id=1,
        source_bucket="source-bucket",
        target_bucket="target-bucket",
        execution_strategy=strategy,
    )

    def persist_item_checkpoint(_migration_id, _item_id, mutate):
        mutate(migration, item)
        return migration, item

    service._persist_item_checkpoint = persist_item_checkpoint  # type: ignore[method-assign]
    return migration, item


def _run_copy(db_session, *, strategy: str, settings: _SettingsStub):
    service = BucketMigrationService(db_session)
    service._configuration = settings  # type: ignore[assignment]
    events: list[dict[str, object]] = []
    service._add_event = (  # type: ignore[method-assign]
        lambda *_args, **kwargs: events.append(kwargs)
    )
    migration, item = _install_in_memory_checkpoint(service, strategy=strategy)
    service._copy_bucket_settings(
        object(),
        "source-bucket",
        object(),
        "target-bucket",
        migration,
        item,
    )
    return events


def test_copy_bucket_settings_runs_declarative_operations_in_order(db_session):
    settings = _SettingsStub()

    events = _run_copy(db_session, strategy="current_only", settings=settings)

    assert settings.calls == [
        ("get_bucket_properties", None),
        ("set_versioning", True),
        ("get_bucket_object_lock", None),
        ("set_object_lock", None),
        ("get_bucket_encryption", None),
        ("set_bucket_encryption", None),
        ("get_public_access_block", None),
        ("set_public_access_block", None),
        ("get_lifecycle", None),
        ("delete_lifecycle", None),
        ("get_bucket_cors", None),
        ("set_cors", None),
        ("get_policy", None),
        ("delete_policy", None),
        ("get_bucket_tags", None),
        ("set_bucket_tags", [{"key": "team", "value": "storage"}]),
        ("get_bucket_logging", None),
        ("set_bucket_logging", None),
    ]
    assert events == [
        {
            "item": ANY,
            "level": "info",
            "message": "Bucket settings copied.",
        }
    ]


def test_copy_bucket_settings_forces_versioning_for_version_aware_strategy(
    db_session,
):
    settings = _SettingsStub()

    events = _run_copy(db_session, strategy="version_aware", settings=settings)

    assert settings.calls[0] == ("set_versioning", True)
    assert all(name != "get_bucket_properties" for name, _value in settings.calls)
    assert events[-1]["message"] == "Bucket settings copied."


def test_copy_bucket_settings_normalizes_versioning_status(db_session):
    settings = _SettingsStub(versioning_status=" ENABLED ")

    _run_copy(db_session, strategy="current_only", settings=settings)

    assert settings.calls[:2] == [
        ("get_bucket_properties", None),
        ("set_versioning", True),
    ]


def test_copy_bucket_settings_requires_persisted_item_before_remote_io(db_session):
    settings = _SettingsStub()
    service = BucketMigrationService(db_session)
    service._configuration = settings  # type: ignore[assignment]
    migration = BucketMigration(source_context_id="source", target_context_id="target")
    item = BucketMigrationItem(
        source_bucket="source-bucket",
        target_bucket="target-bucket",
        execution_strategy="current_only",
    )

    with pytest.raises(RuntimeError, match="requires a persisted migration item"):
        service._copy_bucket_settings(
            object(),
            "source-bucket",
            object(),
            "target-bucket",
            migration,
            item,
        )

    assert settings.calls == []


def test_copy_bucket_settings_continues_after_failure_and_aggregates(db_session):
    settings = _SettingsStub(fail_write="set_bucket_encryption")
    service = BucketMigrationService(db_session)
    service._configuration = settings  # type: ignore[assignment]
    events: list[dict[str, object]] = []
    service._add_event = (  # type: ignore[method-assign]
        lambda *_args, **kwargs: events.append(kwargs)
    )
    migration, item = _install_in_memory_checkpoint(service, strategy="current_only")

    with pytest.raises(
        MigrationSettingsCopyError,
        match="Bucket settings copy failed.*encryption: set_bucket_encryption failed",
    ):
        service._copy_bucket_settings(
            object(),
            "source-bucket",
            object(),
            "target-bucket",
            migration,
            item,
        )

    assert ("set_bucket_logging", None) in settings.calls
    assert events == [
        {
            "item": ANY,
            "level": "error",
            "message": "Default bucket encryption copy failed.",
            "metadata": {
                "error": "set_bucket_encryption failed",
                "setting": "encryption",
            },
        }
    ]


def test_copy_bucket_settings_sanitizes_aggregated_failure(db_session):
    settings = _SettingsStub()
    settings.set_bucket_encryption = lambda *_args: (_ for _ in ()).throw(
        S3OperationError(
            "secret_key=TOPSECRET endpoint=https://private.example.test/admin"
        )
    )
    service = BucketMigrationService(db_session)
    service._configuration = settings  # type: ignore[assignment]
    events: list[dict[str, object]] = []
    service._add_event = (  # type: ignore[method-assign]
        lambda *_args, **kwargs: events.append(kwargs)
    )
    migration, item = _install_in_memory_checkpoint(service, strategy="current_only")

    with pytest.raises(MigrationSettingsCopyError) as error:
        service._copy_bucket_settings(
            object(),
            "source-bucket",
            object(),
            "target-bucket",
            migration,
            item,
        )

    assert "TOPSECRET" not in str(error.value)
    assert "private.example.test" not in str(error.value)
    assert "secret_key=<redacted> endpoint=<redacted-url>" in str(error.value)
    assert events[0]["metadata"] == {
        "error": "secret_key=<redacted> endpoint=<redacted-url>",
        "setting": "encryption",
    }


def test_copy_bucket_settings_does_not_mask_unexpected_runtime_failure(db_session):
    settings = _SettingsStub()
    settings.set_bucket_encryption = lambda *_args: (_ for _ in ()).throw(
        RuntimeError("unexpected settings regression")
    )
    service = BucketMigrationService(db_session)
    service._configuration = settings  # type: ignore[assignment]
    service._add_event = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    migration, item = _install_in_memory_checkpoint(service, strategy="current_only")

    with pytest.raises(RuntimeError, match="unexpected settings regression"):
        service._copy_bucket_settings(
            object(),
            "source-bucket",
            object(),
            "target-bucket",
            migration,
            item,
        )

    assert ("set_bucket_logging", None) not in settings.calls
