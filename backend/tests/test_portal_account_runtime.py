# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from types import SimpleNamespace

import pytest

from app.db import PortalStorageSpaceMetadata
from app.services.portal import account_runtime as account_runtime_module
from app.services.portal_service import PortalService
from app.services.rgw_admin import RGWAdminError
from tests.s3_account_factory import make_s3_account


class _AccountLimitsAdmin:
    def __init__(self) -> None:
        self.account_calls = 0

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ) -> dict:
        self.account_calls += 1
        return {
            "id": account_id,
            "quota": {"enabled": True, "max_size": 1, "max_objects": 1},
            "limits": {"max_buckets": 1},
            "account": {
                "id": account_id,
                "quota": {"enabled": True, "max_size": 4096, "max_objects": 10},
                "limits": {"max_buckets": 5},
            },
        }

    def get_account_quota(self, account_id: str) -> tuple[int, int]:
        pytest.fail(f"account payload must not be loaded twice for {account_id}")


def _runtime_account():
    identity = SimpleNamespace(
        status="ready",
        access_key="runtime-access",
        secret_key="runtime-secret",
    )
    endpoint = SimpleNamespace(service_identity=lambda kind: identity if kind == "runtime" else None)
    return SimpleNamespace(storage_endpoint=endpoint)


@pytest.mark.parametrize("error", [RGWAdminError("invalid runtime client"), ValueError("invalid runtime identity")])
def test_runtime_for_account_treats_expected_client_configuration_errors_as_unavailable(monkeypatch, error) -> None:
    service = PortalService(SimpleNamespace())
    account = _runtime_account()
    monkeypatch.setattr(account_runtime_module, "resolve_rgw_admin_api_endpoint", lambda _endpoint: "https://rgw.test")
    monkeypatch.setattr(account_runtime_module, "get_endpoint_runtime_rgw_client", lambda _endpoint: (_ for _ in ()).throw(error))

    assert service._runtime_for_account(account) is None


def test_runtime_for_account_does_not_hide_unexpected_client_factory_errors(monkeypatch) -> None:
    service = PortalService(SimpleNamespace())
    account = _runtime_account()
    monkeypatch.setattr(account_runtime_module, "resolve_rgw_admin_api_endpoint", lambda _endpoint: "https://rgw.test")
    monkeypatch.setattr(
        account_runtime_module,
        "get_endpoint_runtime_rgw_client",
        lambda _endpoint: (_ for _ in ()).throw(TypeError("unexpected factory bug")),
    )

    with pytest.raises(TypeError, match="unexpected factory bug"):
        service._runtime_for_account(account)


def test_account_limits_do_not_repeat_lookup_without_embedded_quota(db_session, monkeypatch) -> None:
    account = make_s3_account(db_session, name="portal-limits")
    service = PortalService(db_session)
    admin = _AccountLimitsAdmin()
    monkeypatch.setattr(service, "_runtime_for_account", lambda _account: admin)

    assert service._account_limits(account) == (4096, 10, 5)
    assert admin.account_calls == 1


def test_admin_bucket_info_skips_admin_outside_portal_account_scope(db_session, monkeypatch) -> None:
    account = make_s3_account(db_session, name="portal-bucket-scope")
    db_session.add(account)
    db_session.commit()
    service = PortalService(db_session)
    monkeypatch.setattr(
        service,
        "_runtime_read_for_account",
        lambda *_args: pytest.fail("Admin Ops must not be initialized for an out-of-scope Portal bucket"),
    )

    assert service._admin_bucket_info(account, "foreign-bucket") is None


def test_admin_bucket_info_uses_single_uid_scoped_lookup(db_session, monkeypatch) -> None:
    account = make_s3_account(db_session, name="portal-bucket-scoped-lookup")
    db_session.add(account)
    db_session.flush()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="portal-bucket",
            visibility="shared",
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    calls: list[tuple[str, dict]] = []

    class FakeAdmin:
        def get_bucket_info(self, bucket_name, **kwargs):  # noqa: ANN001
            calls.append((bucket_name, kwargs))
            return None

    monkeypatch.setattr(service, "_runtime_read_for_account", lambda *_args: FakeAdmin())

    assert service._admin_bucket_info(account, "portal-bucket") is None
    assert calls == [
        (
            "portal-bucket",
            {
                "allow_not_found": True,
                "uid": account.rgw_user_uid,
            },
        )
    ]
