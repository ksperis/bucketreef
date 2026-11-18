# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from types import SimpleNamespace

import pytest

from app.models.s3_account import S3AccountUpdate
from app.models.s3_user import S3UserUpdate
from app.services.s3_account_limits_service import S3AccountLimitsService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_user_limits_service import S3UserLimitsService
from app.services.s3_user_metrics_service import S3UserMetricsService


class _FakeAdmin:
    def __init__(
        self,
        *,
        caps: str = "users=read,write;accounts=read,write",
        account: dict | None = None,
        user: dict | None = None,
    ) -> None:
        self.caps = caps
        self.account = account or {}
        self.user = user or {}
        self.account_updates: list[tuple[str, dict[str, int]]] = []
        self.user_updates: list[tuple[str, str | None, int]] = []

    def get_user_by_access_key(self, _access_key: str, allow_not_found: bool = False):
        assert allow_not_found is True
        return {"caps": self.caps}

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        assert allow_not_found is True
        assert allow_not_implemented is True
        return {"id": account_id, **self.account}

    def update_account(self, account_id: str, **values: int):
        self.account_updates.append((account_id, values))
        return {"id": account_id, **values}

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = False):
        assert allow_not_found is True
        return {"uid": uid, "tenant": tenant or "", **self.user}

    def update_user(self, uid: str, *, tenant: str | None = None, max_buckets: int | None = None, **_kwargs):
        assert max_buckets is not None
        self.user_updates.append((uid, tenant, max_buckets))
        return {"uid": uid, "tenant": tenant or "", "max_buckets": max_buckets}


class _AccountRgwContext:
    def __init__(self, admin: _FakeAdmin) -> None:
        self.admin = admin
        self.endpoint = SimpleNamespace(admin_access_key="AKIA-ADMIN")

    def resolve_storage_endpoint(self, _endpoint_id: int):
        return self.endpoint

    def admin_for_endpoint(self, _endpoint):
        return self.admin


class _UserRgwContext:
    def __init__(self, admin: _FakeAdmin, *, tenant: str = "team-a") -> None:
        self.admin = admin
        self.tenant = tenant
        self.endpoint = SimpleNamespace(admin_access_key="AKIA-ADMIN")

    def endpoint_for_context(self, _context):
        return self.endpoint

    def admin_for_endpoint(self, _endpoint):
        return self.admin

    def verified_user_tenant(self, _context, _admin):
        return self.tenant


def test_account_metrics_reads_all_remote_limits():
    admin = _FakeAdmin(account={
        "max_buckets": 101,
        "max_users": 22,
        "max_roles": 33,
        "max_groups": 44,
    })
    context = SimpleNamespace(rgw_account_id="RGW000000000000001")

    assert S3AccountMetricsService().get_limits(context, admin)[2:] == (101, 22, 33, 44)


def test_user_metrics_reads_remote_max_buckets_with_tenant_identity():
    admin = _FakeAdmin(user={"max_buckets": 17})
    context = SimpleNamespace(rgw_user_uid="alice", rgw_tenant="team-a")

    assert S3UserMetricsService().get_limits(context, admin)[2] == 17


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (S3AccountUpdate(max_buckets=12), {"max_buckets": 12}),
        (S3AccountUpdate(max_buckets=0), {"max_buckets": 0}),
        (S3AccountUpdate(max_buckets=None), {"max_buckets": 0}),
        (S3AccountUpdate(max_users=9, max_roles=None), {"max_users": 9, "max_roles": 0}),
    ],
)
def test_account_limit_updates_preserve_field_presence(payload: S3AccountUpdate, expected: dict[str, int]):
    admin = _FakeAdmin(account={"max_buckets": 7, "max_users": 8, "max_roles": 0, "max_groups": 10})
    service = S3AccountLimitsService(_AccountRgwContext(admin))
    account = SimpleNamespace(storage_endpoint_id=1, rgw_account_id="RGW000000000000001")

    snapshot = service.capture(account)
    assert snapshot.max_roles == 0
    service.update(snapshot, payload)

    assert admin.account_updates == [("RGW000000000000001", expected)]


def test_account_limit_omission_is_unchanged():
    admin = _FakeAdmin(account={"max_buckets": 7})
    service = S3AccountLimitsService(_AccountRgwContext(admin))
    account = SimpleNamespace(storage_endpoint_id=1, rgw_account_id="RGW000000000000001")
    payload = S3AccountUpdate()

    assert service.requested(payload) is False
    service.update(service.capture(account), payload)
    assert admin.account_updates == []


def test_account_limit_update_requires_accounts_write():
    admin = _FakeAdmin(caps="accounts=read", account={"max_buckets": 7})
    service = S3AccountLimitsService(_AccountRgwContext(admin))
    account = SimpleNamespace(storage_endpoint_id=1, rgw_account_id="RGW000000000000001")

    with pytest.raises(ValueError, match="accounts_write"):
        service.capture(account)


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (S3UserUpdate(max_buckets=12), 12),
        (S3UserUpdate(max_buckets=0), 0),
        (S3UserUpdate(max_buckets=None), 0),
    ],
)
def test_user_limit_updates_preserve_field_presence(payload: S3UserUpdate, expected: int):
    admin = _FakeAdmin(user={"max_buckets": 7})
    service = S3UserLimitsService(_UserRgwContext(admin))
    context = SimpleNamespace(rgw_user_uid="alice")

    snapshot = service.capture(context)
    service.update(snapshot, payload)

    assert admin.user_updates == [("alice", "team-a", expected)]


def test_user_limit_omission_is_unchanged():
    admin = _FakeAdmin(user={"max_buckets": 7})
    service = S3UserLimitsService(_UserRgwContext(admin))
    context = SimpleNamespace(rgw_user_uid="alice")
    payload = S3UserUpdate()

    assert service.requested(payload) is False
    service.update(service.capture(context), payload)
    assert admin.user_updates == []


def test_user_limit_update_requires_users_write():
    admin = _FakeAdmin(caps="users=read", user={"max_buckets": 7})
    service = S3UserLimitsService(_UserRgwContext(admin))

    with pytest.raises(ValueError, match="users_write"):
        service.capture(SimpleNamespace(rgw_user_uid="alice"))


def test_user_limit_capture_rejects_mismatched_uid_and_tenant():
    admin = _FakeAdmin(user={"uid": "bob", "tenant": "team-b", "max_buckets": 7})
    service = S3UserLimitsService(_UserRgwContext(admin, tenant="team-a"))

    with pytest.raises(ValueError, match="different user identity|another tenant"):
        service.capture(SimpleNamespace(rgw_user_uid="alice"))
