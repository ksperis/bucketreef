# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import ceph_admin_user_key_service as module
from app.services.ceph_admin_user_access import serialize_access_keys
from app.services.ceph_admin_user_key_service import CephAdminUserKeyService


class _FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args):
        return self

    def all(self):
        return self.rows


class _FakeSession:
    def __init__(self, rows):
        self.rows = rows

    def query(self, _model):
        return _FakeQuery(self.rows)


class _FakeRgwAdmin:
    def __init__(self):
        self.status_calls: list[tuple[str, str, bool, str | None]] = []
        self.delete_calls: list[tuple[str, str, str | None]] = []
        self.create_calls: list[tuple[str, str | None]] = []

    def get_user(self, uid, tenant=None, allow_not_found=True):
        return {"user": {"uid": uid, "tenant": tenant}}

    def list_user_keys(self, uid, tenant=None):
        return [
            {
                "access_key": "AKIA-LISTED",
                "secret_key": "SECRET-MUST-NOT-LEAK",
                "status": "enabled",
            }
        ]

    def create_access_key(self, uid, tenant=None):
        self.create_calls.append((uid, tenant))
        return {
            "keys": [
                {
                    "access_key": "AKIA-CREATED",
                    "secret_key": "SECRET-CREATED",
                }
            ]
        }

    @staticmethod
    def extract_keys(payload):
        return payload.get("keys", [])

    def set_access_key_status(self, uid, access_key, active, tenant=None):
        self.status_calls.append((uid, access_key, active, tenant))

    def delete_access_key(self, uid, access_key, tenant=None):
        self.delete_calls.append((uid, access_key, tenant))


def _ctx(rgw_admin):
    return SimpleNamespace(
        endpoint=SimpleNamespace(id=902),
        rgw_admin=rgw_admin,
        actor=None,
        audit_service=None,
    )


def test_serialize_access_keys_drops_upstream_secret_material():
    keys = serialize_access_keys(
        [{"access_key": "AKIA-LISTED", "secret_key": "SECRET", "status": "enabled"}]
    )

    assert keys[0].access_key == "AKIA-LISTED"
    assert "secret_key" not in keys[0].model_dump()


def test_list_keys_marks_managed_private_access(monkeypatch):
    rgw_admin = _FakeRgwAdmin()
    source = SimpleNamespace(id=41)

    class _ManagedPrivateAccess:
        def __init__(self, db):  # noqa: ARG002
            pass

        def managed_key(self, source_kind, source_id, access_key):
            assert (source_kind, source_id, access_key) == ("s3_user", 41, "AKIA-LISTED")
            return SimpleNamespace(s3_connection_id=77)

    monkeypatch.setattr(module, "ManagedPrivateAccessService", _ManagedPrivateAccess)

    keys = CephAdminUserKeyService(
        _ctx(rgw_admin),
        _FakeSession([source]),
    ).list_keys("billing-user")

    assert keys[0].is_private_access_managed is True
    assert keys[0].managed_connection_id == 77
    assert "secret_key" not in keys[0].model_dump()


def test_create_key_preserves_one_time_secret_delivery():
    rgw_admin = _FakeRgwAdmin()

    created = CephAdminUserKeyService(
        _ctx(rgw_admin),
        _FakeSession([]),
    ).create_key("billing-user")

    assert created.access_key == "AKIA-CREATED"
    assert created.secret_key == "SECRET-CREATED"
    assert rgw_admin.create_calls == [("billing-user", None)]


@pytest.mark.parametrize("operation", ["update", "delete"])
def test_managed_private_key_blocks_mutation_before_rgw_call(monkeypatch, operation):
    rgw_admin = _FakeRgwAdmin()
    source = SimpleNamespace(id=41)

    class _ManagedPrivateAccess:
        def __init__(self, db):  # noqa: ARG002
            pass

        def managed_key(self, source_kind, source_id, access_key):
            assert (source_kind, source_id, access_key) == ("s3_user", 41, "AKIA-LISTED")
            return SimpleNamespace(s3_connection_id=77)

    monkeypatch.setattr(module, "ManagedPrivateAccessService", _ManagedPrivateAccess)
    service = CephAdminUserKeyService(_ctx(rgw_admin), _FakeSession([source]))

    with pytest.raises(HTTPException) as raised:
        if operation == "update":
            service.update_status("billing-user", "AKIA-LISTED", active=False)
        else:
            service.delete_key("billing-user", "AKIA-LISTED")

    assert raised.value.status_code == 409
    assert rgw_admin.status_calls == []
    assert rgw_admin.delete_calls == []
