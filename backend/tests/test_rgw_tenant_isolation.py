# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.db import AccountIAMUser, PortalStorageSpaceMetadata, S3Account, S3User, User
from app.models.bucket import BucketQuotaUpdate
from app.services.admin_metrics_service import AdminMetricsService
from app.services.billing_collection_service import BillingCollector
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.buckets_service import BucketsService
from app.services.portal_service import PortalService
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.traffic_service import TrafficService, TrafficWindow
from app.utils.rgw_payloads import require_rgw_user_identity, rgw_user_account_root
from tests.s3_account_factory import make_s3_account


def _client(monkeypatch):
    client = RGWAdminClient(access_key="ADMIN", secret_key="SECRET", endpoint="https://rgw.invalid")
    calls = []

    def request(method, path, **kwargs):
        params = dict(kwargs.get("params") or {})
        calls.append((method, path, params))
        if method == "GET" and path == "/admin/bucket" and params.get("uid") and params.get("bucket"):
            # Ceph bucket_stats loads rgw_bucket(uid.tenant, bucket_name) verbatim.
            assert "/" not in params["bucket"]
        return {"uid": params.get("uid"), "keys": [], "usage": {"total_bytes": 25, "total_objects": 2}}

    monkeypatch.setattr(client, "_request", request)
    return client, calls


@pytest.mark.parametrize("tenant", ["", "customer01"])
def test_admin_ops_use_tenant_qualified_uid_for_every_user_operation(monkeypatch, tenant):
    client, calls = _client(monkeypatch)
    client.create_user("analyst", tenant=tenant)
    client.get_user("analyst", tenant=tenant)
    client.create_access_key("analyst", tenant=tenant)
    client.set_access_key_status("analyst", "KEY", enabled=False, tenant=tenant)
    client.delete_access_key("analyst", "KEY", tenant=tenant)
    client.update_user("analyst", tenant=tenant, email="user@example.test")
    client.set_user_quota("analyst", tenant=tenant, max_objects=10)
    client.set_user_caps("analyst", "users=read", tenant=tenant)
    client.delete_user("analyst", tenant=tenant)
    expected = f"{tenant}$analyst" if tenant else "analyst"
    assert len(calls) == 9
    assert all(params["uid"] == expected for _, _, params in calls)


def test_bucket_reads_and_quota_derive_the_same_tenant(monkeypatch):
    client, calls = _client(monkeypatch)
    client.get_bucket_info("same-name", uid="analyst", tenant="customer01")
    client.get_all_buckets(uid="analyst", tenant="customer01", with_stats=True)
    client.set_bucket_quota("same-name", uid="analyst", tenant="customer01", max_objects=10)
    client.get_usage(uid="analyst", tenant="customer01")
    assert [params["uid"] for _, _, params in calls] == ["customer01$analyst"] * 4
    assert calls[0][2]["bucket"] == "same-name"
    assert calls[2][2]["bucket"] == "same-name"
    client.get_usage(uid="RGW12345678901234567", tenant="customer01")
    assert calls[-1][2]["uid"] == "RGW12345678901234567"


def test_user_inventory_paginates_before_account_root_discovery(monkeypatch):
    client, calls = _client(monkeypatch)
    pages = iter([
        {"keys": ["customer01$first"], "truncated": True, "marker": "next"},
        {"keys": ["customer01$custom-root"], "truncated": False},
    ])
    def request(method, path, **kwargs):
        calls.append(kwargs["params"])
        return next(pages)
    monkeypatch.setattr(client, "_request", request)
    assert client.list_user_ids() == ["customer01$first", "customer01$custom-root"]
    assert calls[1]["marker"] == "next"


def test_account_user_inventory_excludes_actual_tenanted_root(db_session):
    from app.services.s3_accounts_service import S3AccountsService
    account_id = "RGW12345678901234567"
    admin = SimpleNamespace(
        account_api_supported=True,
        get_account=lambda *args, **kwargs: {
            "id": account_id,
            "tenant": "customer01",
            "user_list": ["customer01$custom-root", "customer01$member"],
        },
    )
    service = S3AccountsService(db_session)
    assert service._account_rgw_users(account_id, None, admin, root_uid="custom-root") == (1, ["customer01$member"])


def test_manager_bucket_stats_and_quota_preserve_explicit_tenant(monkeypatch):
    client, calls = _client(monkeypatch)
    context = S3ExecutionContext(context_id="s3u-1", context_kind="s3_user", name="Analyst",
        access_key="ACCESS", secret_key="SECRET", rgw_user_uid="analyst", rgw_tenant="customer01")
    service = BucketsService()
    monkeypatch.setattr(service, "_rgw_runtime_for_account", lambda _: client)
    monkeypatch.setattr("app.services.buckets_service.s3_client.list_buckets",
                        lambda **kwargs: [{"name": "same-name"}])
    summary = service.get_bucket_stats("same-name", context)
    assert summary.used_bytes == 25
    assert calls[0][2]["bucket"] == "same-name"
    configuration = BucketConfigurationService()
    configuration.set_bucket_quota("same-name", context, BucketQuotaUpdate(max_objects=10), rgw_admin=client)
    assert calls[-1][2]["uid"] == "customer01$analyst"


def test_portal_same_bucket_name_remains_scoped_to_each_account(db_session, monkeypatch):
    client, calls = _client(monkeypatch)
    accounts = [make_s3_account(db_session, name=tenant, rgw_tenant=tenant, rgw_user_uid="root")
                for tenant in ("customer01", "customer02")]
    db_session.add_all(accounts)
    db_session.flush()
    db_session.add_all([PortalStorageSpaceMetadata(account_id=account.id, bucket_name="same-name", visibility="shared")
                       for account in accounts])
    db_session.commit()
    service = PortalService(db_session)
    for account in accounts:
        service._admin_bucket_info(account, "same-name", admin=client)
    assert [params["bucket"] for _, _, params in calls] == ["same-name", "same-name"]
    assert [params["uid"] for _, _, params in calls] == ["customer01$root", "customer02$root"]
    assert service._admin_bucket_info(accounts[0], "foreign", admin=client) is None
    assert len(calls) == 2


def test_tenanted_portal_policy_never_exempts_foreign_same_name_principals(db_session):
    account_id = "RGW12345678901234567"
    account = make_s3_account(db_session, name="Scoped Portal", rgw_account_id=account_id, rgw_tenant="customer01")
    owner = User(email="owner@example.test", hashed_password="x", role="ui_user")
    db_session.add_all([account, owner])
    db_session.flush()
    db_session.add(AccountIAMUser(account_id=account.id, user_id=owner.id,
        iam_username="same-name", iam_user_id="arn:aws:iam:::user/same-name"))
    metadata = PortalStorageSpaceMetadata(account_id=account.id, bucket_name="same-bucket",
        visibility="private", owner_user_id=owner.id)
    db_session.add(metadata)
    db_session.commit()
    service = PortalService(db_session)
    policy = service._storage_space_bucket_policy(account, "same-bucket", metadata, None)
    principals = policy["Statement"][-1]["NotPrincipal"]["AWS"]
    assert f"arn:aws:iam::{account_id}:user/same-name" in principals
    assert "arn:aws:iam:::user/same-name" not in principals
    assert all(principal.startswith(f"arn:aws:iam::{account_id}:") for principal in principals)


def test_traffic_uses_qualified_user_without_widening_to_another_tenant(monkeypatch):
    client, calls = _client(monkeypatch)
    context = S3ExecutionContext(context_id="s3u-1", context_kind="s3_user", name="Analyst",
        access_key="ACCESS", secret_key="SECRET", rgw_user_uid="analyst", rgw_tenant="customer01")
    TrafficService(context, admin_client=client).get_traffic(TrafficWindow.DAY,
        now=datetime(2026, 10, 14, tzinfo=timezone.utc))
    assert calls[0][2]["uid"] == "customer01$analyst"


def test_metrics_do_not_merge_same_uid_across_tenants(monkeypatch):
    client, _ = _client(monkeypatch)
    service = AdminMetricsService(db=SimpleNamespace(), rgw_admin=client)
    users = [SimpleNamespace(id=index, name=tenant, rgw_user_uid="analyst", rgw_tenant=tenant)
             for index, tenant in enumerate(("customer01", "customer02"), 1)]
    buckets = [{"bucket": "same-name", "tenant": tenant, "owner": "analyst",
                "usage": {"total_bytes": size, "total_objects": 1}}
               for tenant, size in (("customer01", 10), ("customer02", 30))]
    snapshot = service._storage_snapshot_from_bucket_list({}, [], users, buckets)
    assert [item["used_bytes"] for item in snapshot["s3_user_usage"]] == [30, 10]
    assert service._filter_buckets(buckets, {"customer01$analyst"}) == [buckets[0]]
    assert service._filter_usage_entries([
        {"user": "customer01$analyst"}, {"user": "customer02$analyst"}, {"user": "analyst"}
    ], {"customer01$analyst"}) == [{"user": "customer01$analyst"}]


def test_billing_and_quota_collectors_preserve_tenants(db_session):
    account = make_s3_account(db_session, name="Tenant collector", rgw_tenant="customer01")
    db_session.add(account)
    db_session.flush()
    user = S3User(name="Tenant user", rgw_user_uid="analyst", rgw_tenant="customer02",
                  rgw_access_key="USER", rgw_secret_key="SECRET", storage_endpoint_id=account.storage_endpoint_id)
    db_session.add(user)
    db_session.commit()
    calls = []
    admin = SimpleNamespace(
        get_usage=lambda **kwargs: calls.append(("usage", kwargs["uid"])) or {},
        get_all_buckets=lambda **kwargs: calls.append(("storage", kwargs["uid"])) or {"buckets": []},
        get_user_quota=lambda uid: calls.append(("quota", uid)) or (10, 2),
    )
    collector = BillingCollector(db_session)
    assert collector._collect_usage_for_endpoint(admin, account.storage_endpoint, date(2026, 10, 14)) == (2, [])
    assert collector._collect_storage_for_endpoint(admin, account.storage_endpoint, date(2026, 10, 14)) == (2, [])
    assert ("usage", "customer02$analyst") in calls
    assert ("storage", f"customer01${account.rgw_user_uid}") in calls
    assert ("storage", "customer02$analyst") in calls
    monitor = QuotaMonitoringService(db_session)
    subjects = monitor._load_subjects(endpoint_map={account.storage_endpoint_id: account.storage_endpoint})
    user_subject = next(subject for subject in subjects if subject.subject_type == "s3_user")
    assert monitor._collect_quota(admin, user_subject) == (10, 2)
    assert calls[-1] == ("quota", "customer02$analyst")


def test_conflicting_tenant_fields_fail_closed():
    with pytest.raises(ValueError, match="conflicting tenant"):
        require_rgw_user_identity({"uid": "customer02$analyst", "tenant": "customer01"}, "analyst", "customer01")


def test_root_discovery_accepts_native_ceph_type_and_rejects_a_regular_account_user():
    assert rgw_user_account_root({"type": "root"}) is True
    assert rgw_user_account_root({"type": "rgw"}) is False
    admin = SimpleNamespace(get_user=lambda *args, **kwargs: {
        "user_id": "custom-root", "tenant": "customer01", "type": "rgw", "account_id": "RGW12345678901234567",
    })
    with pytest.raises(ValueError, match="not an account root"):
        RgwAccountRootService.load_existing_root_user(
            admin,
            "custom-root",
            "RGW12345678901234567",
            "customer01",
        )


def test_account_import_upstream_failure_is_actionable_and_secret_safe(client, monkeypatch):
    def fail_import(self, items):
        raise RGWAdminError("secret_key=DO-NOT-RETURN invalid root tenant", status_code=400, error_code="InvalidArgument")
    monkeypatch.setattr("app.services.s3_accounts_service.S3AccountsService.import_accounts", fail_import)
    response = client.post("/api/admin/accounts/import", json=[{
        "rgw_account_id": "RGW12345678901234567", "storage_endpoint_id": 1,
    }])
    assert response.status_code == 502
    assert "DO-NOT-RETURN" not in response.text
