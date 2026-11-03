# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.storage_endpoint_features import parse_features_config
from datetime import UTC, date, datetime
from typing import Optional

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.core.domain_errors import S3AccountNotFoundError
from app.services import s3_account_deletion_service as s3_account_deletion_service_module
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.s3_account_provisioning_service import S3AccountProvisioningService
from app.services.s3_accounts_service import S3AccountsService
from app.db import (
    CostStorageDaily,
    CostUsageDaily,
    BrowserFavorite,
    BucketMigration,
    BucketUsageStatsSnapshot,
    QuotaAlertState,
    QuotaUsageDaily,
    QuotaUsageHourly,
    S3Account,
    S3AccountDeletion,
    S3AccountImportIntent,
    StorageEndpoint,
    User,
    UserS3Account,
)
from app.core.domain_enums import StorageProvider, UserRole
from app.models.s3_account import S3AccountCreate, S3AccountImport, S3AccountUpdate
from app.services.app_settings_service import load_app_settings_for_db


def _seed_ceph_endpoint(
    db_session,
    *,
    name: str = "ceph-accounts-test",
    account_enabled: bool = True,
    metrics_enabled: bool = False,
    is_default: bool = True,
) -> StorageEndpoint:
    metrics_config = (
        "  metrics:\n"
        "    enabled: true\n"
        if metrics_enabled
        else ""
    )
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        features=parse_features_config("features:\n"
            "  admin:\n"
            "    enabled: true\n"
            "  account:\n"
            f"    enabled: {'true' if account_enabled else 'false'}\n"
            f"{metrics_config}"),
        is_default=is_default,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _build_service(db_session, monkeypatch, fake_admin) -> S3AccountsService:
    monkeypatch.setattr(
        "app.services.s3_account_rgw_context_service.get_endpoint_admin_rgw_client",
        lambda _endpoint: fake_admin,
    )
    monkeypatch.setattr(
        "app.services.s3_account_metrics_service.get_endpoint_runtime_rgw_client",
        lambda endpoint: fake_admin,
    )
    monkeypatch.setattr("app.services.rgw_endpoint_clients.get_endpoint_admin_rgw_client", lambda endpoint: fake_admin)
    return S3AccountsService(db_session)


def test_get_account_detail_uses_typed_not_found_error(db_session):
    service = S3AccountsService(db_session)

    with pytest.raises(S3AccountNotFoundError, match="S3Account not found"):
        service.get_account_detail(999_999)


@pytest.mark.parametrize("result", [
    {"conflict": True}, {"id": "RGW-FOREIGN"},
    {"id": "RGW-EXPECTED", "account": {"account_id": "RGW-FOREIGN"}}, {},
])
def test_account_provisioning_rejects_conflicts_and_unverified_id(result):
    with pytest.raises(ValueError, match="RGW account creation failed|RGW did not confirm"):
        S3AccountProvisioningService._ensure_account_creation_succeeded(
            result,
            "RGW-EXPECTED",
        )


def test_import_root_lookup_rejects_conflicting_nested_account_id():
    class Admin:
        def get_user(self, *args, **kwargs):
            return {"account_id": "RGW1", "user": {"uid": "root", "account_id": "RGW2"}}

    with pytest.raises(ValueError, match="belongs to another account"):
        RgwAccountRootService.load_existing_root_user(Admin(), "root", "RGW1")


def test_import_root_resolution_rejects_multiple_account_roots():
    account_id = "RGW12345678901234567"

    class Admin:
        def list_user_ids(self):
            return ["research$root-a", "research$root-b"]

        def get_user(self, uid, tenant=None, allow_not_found=False):
            return {
                "uid": f"{tenant}${uid}",
                "tenant": tenant,
                "account_id": account_id,
                "account_root": True,
            }

    with pytest.raises(ValueError, match="Multiple RGW account roots"):
        RgwAccountRootService().resolve_import_identity(
            Admin(),
            {"account": {"id": account_id, "tenant": "research"}},
            account_id,
            None,
        )


def test_import_root_resolution_uses_account_tenant_for_unqualified_account_user():
    account_id = "RGW12345678901234567"
    calls: list[tuple[str, str | None]] = []

    class Admin:
        def get_user(self, uid, tenant=None, allow_not_found=False):
            calls.append((uid, tenant))
            return {
                "uid": f"{tenant}${uid}",
                "tenant": tenant,
                "account_id": account_id,
                "account_root": True,
            }

    resolved = RgwAccountRootService().resolve_import_identity(
        Admin(),
        {
            "account": {
                "id": account_id,
                "tenant": "research",
                "user_list": ["custom-root"],
            }
        },
        account_id,
        None,
    )

    assert resolved == ("custom-root", "research")
    assert calls == [("custom-root", "research"), ("custom-root", "research")]


def test_import_root_resolution_uses_canonical_dict_user_identity():
    account_id = "RGW12345678901234567"
    calls: list[tuple[str, str | None]] = []

    class Admin:
        def get_user(self, uid, tenant=None, allow_not_found=False):
            calls.append((uid, tenant))
            return {
                "uid": f"{tenant}${uid}",
                "tenant": tenant,
                "account_id": account_id,
                "account_root": True,
            }

    resolved = RgwAccountRootService().resolve_import_identity(
        Admin(),
        {
            "account": {
                "id": account_id,
                "tenant": "research",
                "user_list": [{"user_id": "custom-root", "tenant": "research"}],
            }
        },
        account_id,
        None,
    )

    assert resolved == ("custom-root", "research")
    assert calls == [("custom-root", "research"), ("custom-root", "research")]


def test_import_root_resolution_rejects_conflicting_candidate_identity():
    account_id = "RGW12345678901234567"

    class Admin:
        def get_user(self, *args, **kwargs):
            raise AssertionError("conflicting identity must fail before user lookup")

    with pytest.raises(ValueError, match="conflicting user identity"):
        RgwAccountRootService().resolve_import_identity(
            Admin(),
            {
                "account": {
                    "id": account_id,
                    "tenant": "research",
                    "user_list": [{"uid": "root-a", "user_id": "root-b"}],
                }
            },
            account_id,
            None,
        )


def test_import_root_resolution_rejects_malformed_account_user_list():
    account_id = "RGW12345678901234567"

    class Admin:
        def list_user_ids(self):
            raise AssertionError("malformed embedded inventory must not fall back to endpoint scan")

    with pytest.raises(ValueError, match="account user list is malformed"):
        RgwAccountRootService().resolve_import_identity(
            Admin(),
            {"account": {"id": account_id, "tenant": "research", "user_list": {"uid": "root"}}},
            account_id,
            None,
        )


class FakeRGWAdmin:
    def get_user_by_access_key(self, access_key, **kwargs):
        return {"caps": "users=read,write;accounts=read,write"}

    def __init__(self, account_payload: Optional[dict[str, object]] = None):
        self.created_accounts: list[tuple[str, str]] = []
        self.created_account_tenants: list[Optional[str]] = []
        self.created_users: list[str] = []
        self.created_user_tenants: list[Optional[str]] = []
        self.deleted_users: list[tuple[str, Optional[str]]] = []
        self.deleted_accounts: list[str] = []
        self.created_root_display_names: list[str] = []
        self.quota_calls: list[dict[str, object]] = []
        self.account_payload = account_payload
        self.account_api_supported: bool | None = None

    def create_account(
        self,
        account_id: str,
        account_name: str,
        tenant: Optional[str] = None,
    ):
        self.created_accounts.append((account_id, account_name))
        self.created_account_tenants.append(tenant)
        return {"id": account_id, "name": account_name, "tenant": tenant or ""}

    def create_user_with_account_id(
        self,
        uid: str,
        account_id: str,
        display_name: str,
        account_root: bool = True,
        tenant: Optional[str] = None,
    ):
        self.created_users.append(uid)
        self.created_user_tenants.append(tenant)
        self.created_root_display_names.append(display_name)
        return {
            "user_id": uid,
            "tenant": tenant or "",
            "account_id": account_id,
            "keys": [{"access_key": "AKIA", "secret_key": "SECRET"}],
        }

    def delete_user(self, uid: str, tenant: Optional[str] = None):
        self.deleted_users.append((uid, tenant))

    def delete_account(self, account_id: str):
        self.deleted_accounts.append(account_id)
        return {"ok": True}

    def extract_keys(self, data):
        return data.get("keys", [])

    def set_user_caps(self, uid: str, cap: str, tenant: Optional[str] = None):
        return {"uid": uid, "cap": cap, "tenant": tenant}

    def set_account_quota(
        self,
        account_id: str,
        max_size_bytes: Optional[int] = None,
        max_size_gb: Optional[int] = None,
        max_objects: Optional[int] = None,
        quota_type: str = "account",
        enabled: bool = True,
    ):
        self.quota_calls.append(
            {
                "account_id": account_id,
                "max_size_bytes": max_size_bytes,
                "max_size_gb": max_size_gb,
                "max_objects": max_objects,
                "quota_type": quota_type,
                "enabled": enabled,
            }
        )
        return {"ok": True}

    def get_account_quota(self, account_id: str):
        return None, None

    def list_topics(self, account_id: Optional[str] = None):
        return []

    def list_users(self):
        return []

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        if self.account_payload is not None:
            return self.account_payload
        return {"id": account_id, "user_list": []}


def test_get_account_usage_uses_runtime_without_monitoring_feature(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, metrics_enabled=False)
    account = S3Account(
        name="Usage Account",
        rgw_account_id="RGW00000000000000009",
        rgw_user_uid="usage-account-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    admin_calls: list[dict[str, object]] = []

    class FakeAdmin(FakeRGWAdmin):
        def get_all_buckets(self, account_id=None, uid=None, with_stats=False):  # noqa: ANN001
            admin_calls.append(
                {"account_id": account_id, "uid": uid, "with_stats": with_stats}
            )
            return {
                "buckets": [
                    {"name": "alpha", "usage": {"total_bytes": 32, "total_objects": 2}},
                    {"name": "beta", "usage": {"total_bytes": 64, "total_objects": 3}},
                ]
            }

    service = _build_service(db_session, monkeypatch, FakeAdmin())

    assert service.get_account_usage(account) == (96, 5, 2)
    assert admin_calls == [
        {"account_id": None, "uid": "usage-account-admin", "with_stats": True}
    ]


def test_get_account_usage_uses_root_bucket_count_for_explicit_tenant(
    db_session,
    monkeypatch,
):
    endpoint = _seed_ceph_endpoint(db_session, metrics_enabled=False)
    account = S3Account(
        name="Tenant Usage Account",
        rgw_account_id="RGW00000000000000010",
        rgw_user_uid="tenant-root",
        rgw_tenant="customer10",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()

    class FakeAdmin(FakeRGWAdmin):
        def get_all_buckets(self, account_id=None, uid=None, with_stats=False, tenant=None):  # noqa: ANN001
            assert uid == account.rgw_user_uid
            assert tenant == account.rgw_tenant
            return {
                "buckets": [
                    {
                        "name": "tenant-log-bucket",
                        "usage": {"total_bytes": 128, "total_objects": 4},
                    }
                ]
            }

    service = _build_service(db_session, monkeypatch, FakeAdmin())

    assert service.get_account_usage(account) == (128, 4, 1)

def test_create_account_with_root(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    payload = S3AccountCreate(
        name="TestS3Account",
        email=None,
        quota_max_size_gb=None,
        quota_max_objects=None,
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    acc = svc.create_account_with_manager(payload)

    # S3Account persisted
    db_account = db_session.scalar(
        select(S3Account).where(S3Account.name == "TestS3Account")
    )
    assert db_account is not None
    assert db_account.rgw_access_key == "AKIA"
    assert db_account.rgw_account_id is not None

    # No interface user is created; only RGW root keys stored on account
    root_user = db_session.scalar(select(User).where(User.email.like("%-admin")))
    assert root_user is None


def test_create_account_commit_failure_compensates_remote_account(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW90000000000000001"
    monkeypatch.setattr(svc.provisioning, "_generate_account_id", lambda: account_id)

    def fail_commit():
        raise RuntimeError("simulated account create commit failure")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="simulated account create commit failure"):
        svc.create_account_with_manager(
            S3AccountCreate(
                name="Rollback remote account",
                rgw_tenant="",
                storage_endpoint_id=endpoint.id,
            )
        )

    assert fake_admin.deleted_users == [(f"{account_id}-admin", None)]
    assert fake_admin.deleted_accounts == [account_id]
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ) is None


def test_create_account_local_failure_compensates_remote_account(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW90000000000000002"
    monkeypatch.setattr(svc.provisioning, "_generate_account_id", lambda: account_id)
    monkeypatch.setattr(
        svc.provisioning.tags,
        "replace_account_tags",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("simulated local tag failure")
        ),
    )

    with pytest.raises(RuntimeError, match="simulated local tag failure"):
        svc.create_account_with_manager(
            S3AccountCreate(
                name="Rollback local failure",
                rgw_tenant="",
                storage_endpoint_id=endpoint.id,
            )
        )

    assert fake_admin.deleted_users == [(f"{account_id}-admin", None)]
    assert fake_admin.deleted_accounts == [account_id]
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ) is None


def test_create_account_reports_remote_compensation_failure(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW90000000000000003"
    monkeypatch.setattr(svc.provisioning, "_generate_account_id", lambda: account_id)

    def fail_commit():
        raise RuntimeError("simulated account create commit failure")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    monkeypatch.setattr(
        fake_admin,
        "delete_account",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RGWAdminError("simulated account cleanup failure")
        ),
    )

    with pytest.raises(
        RuntimeError,
        match="Local or RGW rollback also failed",
    ) as raised:
        svc.create_account_with_manager(
            S3AccountCreate(
                name="Cleanup failure",
                rgw_tenant="",
                storage_endpoint_id=endpoint.id,
            )
        )

    assert isinstance(raised.value.__cause__, RuntimeError)
    assert str(raised.value.__cause__) == "simulated account create commit failure"
    assert fake_admin.deleted_users == [(f"{account_id}-admin", None)]



def test_create_managed_account_rejects_explicit_tenant_when_disabled(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    with pytest.raises(ValueError, match="Managed RGW tenant creation is disabled"):
        svc.create_account_with_manager(
            S3AccountCreate(
                name="Tenant blocked",
                rgw_tenant="team_a",
                storage_endpoint_id=endpoint.id,
            )
        )

    assert fake_admin.created_accounts == []


def test_create_managed_account_provisions_root_in_same_tenant_when_enabled(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_provisioning_service.load_app_settings_for_db",
        lambda _db: settings,
    )

    created = svc.create_account_with_manager(
        S3AccountCreate(
            name="Tenant account",
            rgw_tenant="team_a",
            storage_endpoint_id=endpoint.id,
        )
    )

    assert created.rgw_tenant == "team_a"
    assert fake_admin.created_account_tenants == ["team_a"]
    assert fake_admin.created_user_tenants == ["team_a"]
    persisted = db_session.scalars(
        select(S3Account).where(S3Account.id == created.id)
    ).one()
    assert persisted.rgw_tenant == "team_a"


def test_create_account_allows_same_name_in_different_tenants(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_provisioning_service.load_app_settings_for_db",
        lambda _db: settings,
    )
    account_ids = iter(["RGW10000000000000001", "RGW10000000000000002"])
    monkeypatch.setattr(svc.provisioning, "_generate_account_id", lambda: next(account_ids))

    first = svc.create_account_with_manager(
        S3AccountCreate(
            name="Shared account",
            rgw_tenant="team_a",
            storage_endpoint_id=endpoint.id,
        )
    )
    second = svc.create_account_with_manager(
        S3AccountCreate(
            name="Shared account",
            rgw_tenant="team_b",
            storage_endpoint_id=endpoint.id,
        )
    )

    assert (first.rgw_tenant, second.rgw_tenant) == ("team_a", "team_b")
    assert db_session.scalar(
        select(func.count())
        .select_from(S3Account)
        .where(S3Account.name == "Shared account")
    ) == 2


def test_create_account_rejects_same_name_in_same_endpoint_and_tenant(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_provisioning_service.load_app_settings_for_db",
        lambda _db: settings,
    )
    monkeypatch.setattr(
        svc.provisioning,
        "_generate_account_id",
        lambda: "RGW10000000000000003",
    )
    svc.create_account_with_manager(
        S3AccountCreate(
            name="Scoped duplicate",
            rgw_tenant="team_a",
            storage_endpoint_id=endpoint.id,
        )
    )

    with pytest.raises(ValueError, match="S3Account already exists"):
        svc.create_account_with_manager(
            S3AccountCreate(
                name="Scoped duplicate",
                rgw_tenant="team_a",
                storage_endpoint_id=endpoint.id,
            )
        )

    assert len(fake_admin.created_accounts) == 1


def test_create_account_allows_same_name_on_different_endpoints(db_session, monkeypatch):
    first_endpoint = _seed_ceph_endpoint(
        db_session,
        name="ceph-accounts-a",
        account_enabled=True,
        is_default=True,
    )
    second_endpoint = _seed_ceph_endpoint(
        db_session,
        name="ceph-accounts-b",
        account_enabled=True,
        is_default=False,
    )
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_ids = iter(["RGW10000000000000004", "RGW10000000000000005"])
    monkeypatch.setattr(svc.provisioning, "_generate_account_id", lambda: next(account_ids))

    first = svc.create_account_with_manager(
        S3AccountCreate(name="Shared endpoint name", rgw_tenant="", storage_endpoint_id=first_endpoint.id)
    )
    second = svc.create_account_with_manager(
        S3AccountCreate(name="Shared endpoint name", rgw_tenant="", storage_endpoint_id=second_endpoint.id)
    )

    assert first.storage_endpoint_id == first_endpoint.id
    assert second.storage_endpoint_id == second_endpoint.id


def test_create_account_normalizes_root_display_name_without_restricting_account_name(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    account_name = "account ****with``symbols"
    created = svc.create_account_with_manager(
        S3AccountCreate(name=account_name, rgw_tenant="", storage_endpoint_id=endpoint.id)
    )

    assert created.name == account_name
    assert fake_admin.created_accounts[0][1] == account_name
    assert fake_admin.created_root_display_names == ["account-with-symbols"]


def test_create_account_uses_configured_rgw_account_id_prefix(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.rgw_account_id_prefix = "123"
    monkeypatch.setattr(
        "app.services.s3_account_provisioning_service.load_app_settings_for_db",
        lambda _db: settings,
    )
    monkeypatch.setattr("app.utils.rgw_identifiers.secrets.randbelow", lambda _limit: 42)

    created = svc.create_account_with_manager(
        S3AccountCreate(name="Prefixed", rgw_tenant="", storage_endpoint_id=endpoint.id)
    )

    assert created.rgw_account_id == "RGW12300000000000042"
    assert fake_admin.created_accounts == [
        ("RGW12300000000000042", "Prefixed")
    ]


class FakeRGWAdminProvisioning(FakeRGWAdmin):
    def __init__(
        self,
        *,
        account_exists: bool = False,
        root_exists: bool = False,
        account_conflict: bool = False,
        account_tenant: str = "",
    ):
        super().__init__()
        self.account_exists = account_exists
        self.root_exists = root_exists
        self.account_conflict = account_conflict
        self.account_tenant = account_tenant
        self.calls: list[tuple[str, object]] = []

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        self.calls.append(("get_account", account_id))
        if not self.account_exists:
            return {"not_found": True}
        return {
            "id": account_id,
            "name": "BucketReef sample",
            "tenant": self.account_tenant,
            "user_list": [],
        }

    def create_account(
        self,
        account_id: str,
        account_name: str,
        tenant: Optional[str] = None,
    ):
        self.calls.append(("create_account", account_id))
        if self.account_conflict:
            return {
                "conflict": True,
                "status_code": 409,
                "error_code": "AccountAlreadyExists",
            }
        self.account_exists = True
        self.account_tenant = tenant or ""
        return super().create_account(account_id, account_name, tenant=tenant)

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        self.calls.append(("get_user", tenant))
        if not self.root_exists:
            return None
        return {
            "user_id": uid,
            "tenant": tenant or "",
            "account_id": "RGW42177749789247960",
            "keys": [{"access_key": "RESUMED", "secret_key": "RESUMED-SECRET"}],
        }

    def create_user_with_account_id(
        self,
        uid: str,
        account_id: str,
        display_name: str,
        account_root: bool = True,
        tenant: Optional[str] = None,
    ):
        self.calls.append(("create_root", account_id))
        self.root_exists = True
        return {
            "user_id": uid,
            "tenant": tenant or "",
            "account_id": account_id,
            "keys": [{"access_key": "NEWROOT", "secret_key": "NEWSECRET"}],
        }

    def create_access_key(
        self,
        uid: str,
        tenant: Optional[str] = None,
    ):
        self.calls.append(("create_access_key", tenant))
        return {"keys": [{"access_key": "RECOVERED", "secret_key": "RECOVERED-SECRET"}]}


def test_ensure_provisioned_account_keeps_fresh_account_and_root_on_same_client(
    db_session, monkeypatch
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminProvisioning()
    factory_calls = 0

    def build_client(_endpoint):
        nonlocal factory_calls
        factory_calls += 1
        return fake_admin

    monkeypatch.setattr(
        "app.services.s3_account_rgw_context_service.get_endpoint_admin_rgw_client",
        build_client,
    )
    svc = S3AccountsService(db_session)
    account_id = "RGW42177749789247960"

    created = svc.ensure_provisioned_account(
        S3AccountCreate(name="BucketReef sample", rgw_tenant="", storage_endpoint_id=endpoint.id),
        account_id,
    )

    assert created.rgw_account_id == account_id
    # One client performs account + root provisioning; get_account_detail()
    # creates a second client only after the local account has been persisted.
    assert factory_calls == 2
    assert fake_admin.calls[:3] == [
        ("get_account", account_id),
        ("create_account", account_id),
        ("create_root", account_id),
    ]
    assert not any(call[0] == "get_user" for call in fake_admin.calls)


def test_ensure_provisioned_account_commit_failure_keeps_remote_for_retry(
    db_session,
    monkeypatch,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminProvisioning()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW42177749789247960"
    payload = S3AccountCreate(
        name="BucketReef sample",
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    real_commit = db_session.commit

    def fail_commit():
        raise RuntimeError("simulated resumable account commit failure")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="simulated resumable account commit failure"):
        svc.ensure_provisioned_account(payload, account_id)

    assert fake_admin.account_exists is True
    assert fake_admin.root_exists is True
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ) is None

    monkeypatch.setattr(db_session, "commit", real_commit)
    retried = svc.ensure_provisioned_account(payload, account_id)

    assert retried.rgw_account_id == account_id
    assert [call for call in fake_admin.calls if call[0] == "create_account"] == [
        ("create_account", account_id)
    ]
    assert [call for call in fake_admin.calls if call[0] == "create_root"] == [
        ("create_root", account_id)
    ]


def test_ensure_provisioned_account_stops_when_remote_name_is_already_used(
    db_session, monkeypatch
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminProvisioning(account_conflict=True)
    svc = _build_service(db_session, monkeypatch, fake_admin)

    with pytest.raises(ValueError, match="another account already uses this name or email"):
        svc.ensure_provisioned_account(
            S3AccountCreate(
                name="BucketReef sample",
                rgw_tenant="",
                storage_endpoint_id=endpoint.id,
            ),
            "RGW42177749789247960",
        )

    assert not any(call[0] == "create_root" for call in fake_admin.calls)
    assert db_session.scalar(select(func.count()).select_from(S3Account)) == 0


def test_ensure_provisioned_account_resumes_orphaned_account_without_recreating_it(
    db_session, monkeypatch
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminProvisioning(account_exists=True, root_exists=False)
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW42177749789247960"

    created = svc.ensure_provisioned_account(
        S3AccountCreate(name="BucketReef sample", rgw_tenant="", storage_endpoint_id=endpoint.id),
        account_id,
    )

    assert created.rgw_account_id == account_id
    assert not fake_admin.created_accounts
    assert ("create_root", account_id) in fake_admin.calls
    db_account = db_session.scalars(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ).one()
    assert db_account.rgw_access_key == "NEWROOT"
    assert db_account.rgw_secret_key == "NEWSECRET"


def test_ensure_provisioned_account_reuses_existing_root_credentials(
    db_session, monkeypatch
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminProvisioning(account_exists=True, root_exists=True)
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW42177749789247960"

    created = svc.ensure_provisioned_account(
        S3AccountCreate(name="BucketReef sample", rgw_tenant="", storage_endpoint_id=endpoint.id),
        account_id,
    )

    assert created.rgw_account_id == account_id
    assert not fake_admin.created_accounts
    assert not any(call[0] == "create_root" for call in fake_admin.calls)
    db_account = db_session.scalars(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ).one()
    assert db_account.rgw_access_key == "RESUMED"
    assert db_account.rgw_secret_key == "RESUMED-SECRET"


def test_ensure_provisioned_account_resumes_root_in_account_tenant(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminProvisioning(
        account_exists=True,
        root_exists=True,
        account_tenant="team_a",
    )
    svc = _build_service(db_session, monkeypatch, fake_admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_provisioning_service.load_app_settings_for_db",
        lambda _db: settings,
    )

    created = svc.ensure_provisioned_account(
        S3AccountCreate(
            name="BucketReef sample",
            rgw_tenant="team_a",
            storage_endpoint_id=endpoint.id,
        ),
        "RGW42177749789247960",
    )

    assert created.rgw_tenant == "team_a"
    assert ("get_user", "team_a") in fake_admin.calls
    assert not any(call[0] == "create_root" for call in fake_admin.calls)


def test_create_account_requires_account_api_feature(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=False, is_default=False)
    svc = _build_service(db_session, monkeypatch, FakeRGWAdmin())
    payload = S3AccountCreate(
        name="BlockedByFeature",
        email=None,
        quota_max_size_gb=None,
        quota_max_objects=None,
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )

    with pytest.raises(ValueError, match="does not support RGW account API"):
        svc.create_account_with_manager(payload)


def test_get_account_limits_returns_quota_and_entity_limits(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="LimitedAccount",
        rgw_account_id="RGW-LIMITED",
        rgw_user_uid="rgw-limited-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    fake_admin = FakeRGWAdmin(
        {
            "id": "RGW-LIMITED",
            "quota": {"enabled": True, "max_size": 1, "max_objects": 1},
            "limits": {"max_buckets": 1, "max_users": 1, "max_roles": 1, "max_groups": 1},
            "account": {
                "id": "RGW-LIMITED",
                "quota": {
                    "enabled": True,
                    "max_size": 10 * 1024 ** 3,
                    "max_objects": 2_000,
                },
                "limits": {
                    "max_buckets": "8",
                    "max_users": "20",
                    "max_roles": 12,
                    "max_groups": 6,
                },
            },
        }
    )
    svc = _build_service(db_session, monkeypatch, fake_admin)

    assert svc.get_account_limits(account) == (10, 2_000, 8, 20, 12, 6)


def test_get_account_limits_does_not_repeat_lookup_without_embedded_quota(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="LimitsWithoutQuota",
        rgw_account_id="RGW-LIMITS-NO-QUOTA",
        rgw_user_uid="rgw-limits-no-quota-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    fake_admin = FakeRGWAdmin(
        {
            "id": "RGW-LIMITS-NO-QUOTA",
            "limits": {"max_buckets": 5},
        }
    )
    fake_admin.get_account_quota = lambda _account_id: pytest.fail("account payload must not be loaded twice")
    svc = _build_service(db_session, monkeypatch, fake_admin)

    assert svc.get_account_limits(account) == (None, None, 5, None, None, None)


class FakeRGWAdminImport:
    def __init__(self):
        self.calls: list[tuple[str, Optional[str]]] = []

    def create_account(self, *args, **kwargs):
        pytest.fail("pre-provisioned import must not create the RGW account")

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        self.calls.append(("get_account", account_id))
        return {"id": account_id, "name": "LegacyS3Account", "user_list": []}

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        self.calls.append(("get_user", tenant))
        if tenant == "RGW12345678901234567" or tenant is None:
            return {
                "uid": uid,
                "account_id": "RGW12345678901234567",
                "keys": [{"access_key": "IMPORTED", "secret_key": "SECRET"}],
            }
        return None

    def create_user_with_account_id(self, *args, **kwargs):
        pytest.fail("pre-provisioned import must not create the RGW root user")

    def create_access_key(self, *args, **kwargs):
        pytest.fail("pre-provisioned import must not create an RGW access key")

    def extract_keys(self, data):
        return data.get("keys", [])


class FakeRGWAdminImportTenanted(FakeRGWAdminImport):
    def __init__(self, account_id: str, tenant: str = "research"):
        super().__init__()
        self.account_id = account_id
        self.tenant = tenant

    def get_account(self, account_id, **kwargs):
        return {"account": {"id": account_id, "name": "Tenanted account", "tenant": self.tenant}}

    def list_user_ids(self):
        return [f"{self.tenant}$custom-root", "unrelated$root"]

    def get_user(self, uid, tenant=None, allow_not_found=False):
        self.calls.append(("get_user", tenant))
        if uid != "custom-root" or tenant != self.tenant:
            return None
        return {
            "uid": f"{self.tenant}$custom-root",
            "account_id": self.account_id,
            "type": "root",
            "keys": [{"access_key": "EXISTING", "secret_key": "SECRET"}],
        }


def test_import_account_reuses_existing_root_user_keys(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImport()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    imports = [S3AccountImport(rgw_account_id="RGW12345678901234567", name=None, email=None, storage_endpoint_id=endpoint.id)]
    created = svc.import_accounts(imports)

    assert len(created) == 1
    db_account = db_session.scalar(
        select(S3Account).where(
            S3Account.rgw_account_id == "RGW12345678901234567"
        )
    )
    assert db_account is not None
    assert db_account.rgw_access_key == "IMPORTED"
    assert db_account.rgw_secret_key == "SECRET"
    assert db_account.rgw_user_uid == "RGW12345678901234567-admin"
    assert fake_admin.calls == [
        ("get_account", "RGW12345678901234567"),
        ("get_user", None),
        ("get_user", None),
    ]


def test_import_account_discovers_custom_tenant_root(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    account_id = "RGW12345678901234567"
    admin = FakeRGWAdminImportTenanted(account_id)
    service = _build_service(db_session, monkeypatch, admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_import_service.load_app_settings_for_db",
        lambda _db: settings,
    )
    created = service.import_accounts(
        [S3AccountImport(rgw_account_id=account_id, rgw_tenant="research", storage_endpoint_id=endpoint.id)]
    )

    assert created[0].rgw_tenant == "research"
    row = db_session.scalars(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ).one()
    assert (row.rgw_user_uid, row.rgw_tenant, row.rgw_access_key) == ("custom-root", "research", "EXISTING")
    assert admin.calls == [("get_user", "research")] * 4


def test_import_account_allows_same_name_in_different_tenant(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    db_session.add(
        S3Account(
            name="Tenanted account",
            rgw_account_id="RGW20000000000000001",
            rgw_user_uid="existing-root",
            rgw_tenant="other",
            storage_endpoint_id=endpoint.id,
        )
    )
    db_session.commit()
    account_id = "RGW20000000000000002"
    admin = FakeRGWAdminImportTenanted(account_id)
    service = _build_service(db_session, monkeypatch, admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_import_service.load_app_settings_for_db",
        lambda _db: settings,
    )

    created = service.import_accounts(
        [
            S3AccountImport(
                rgw_account_id=account_id,
                rgw_tenant="research",
                storage_endpoint_id=endpoint.id,
            )
        ]
    )

    assert created[0].name == "Tenanted account"
    assert created[0].rgw_tenant == "research"
    assert db_session.scalar(
        select(func.count())
        .select_from(S3Account)
        .where(S3Account.name == "Tenanted account")
    ) == 2


def test_import_tenanted_account_rejects_when_managed_tenant_creation_disabled(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    account_id = "RGW12345678901234567"
    admin = FakeRGWAdminImportTenanted(account_id)
    service = _build_service(db_session, monkeypatch, admin)

    with pytest.raises(ValueError, match="Managed RGW tenant creation is disabled"):
        service.import_accounts(
            [S3AccountImport(rgw_account_id=account_id, storage_endpoint_id=endpoint.id)]
        )

    assert db_session.scalar(select(func.count()).select_from(S3Account)) == 0


def test_import_tenanted_account_rejects_mismatched_tenant_assertion(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    account_id = "RGW12345678901234567"
    admin = FakeRGWAdminImportTenanted(account_id)
    service = _build_service(db_session, monkeypatch, admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_import_service.load_app_settings_for_db",
        lambda _db: settings,
    )

    with pytest.raises(ValueError, match="does not match the account tenant"):
        service.import_accounts(
            [S3AccountImport(rgw_account_id=account_id, rgw_tenant="other", storage_endpoint_id=endpoint.id)]
        )

    assert db_session.scalar(select(func.count()).select_from(S3Account)) == 0


def test_import_account_rejects_other_tenant_root_response(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)

    class WrongTenantRoot(FakeRGWAdminImport):
        def get_user(self, uid, tenant=None, allow_not_found=False):
            return {"uid": f"other${uid}", "account_id": "RGW12345678901234567",
                    "keys": [{"access_key": "FOREIGN", "secret_key": "SECRET"}]}

    admin = WrongTenantRoot()
    service = _build_service(db_session, monkeypatch, admin)
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_import_service.load_app_settings_for_db",
        lambda _db: settings,
    )
    with pytest.raises(ValueError, match="another tenant"):
        service.import_accounts([S3AccountImport(
            rgw_account_id="RGW12345678901234567", root_uid="research$custom-root",
            storage_endpoint_id=endpoint.id,
        )])
    assert db_session.scalar(select(func.count()).select_from(S3Account)) == 0


class FakeRGWAdminImportCreatesRoot:
    def __init__(self, account_name: str = "MissingRootS3Account"):
        self.created_users: list[tuple[str, Optional[str]]] = []
        self.deleted_users: list[tuple[str, Optional[str]]] = []
        self.deleted_access_keys: list[tuple[str, str, Optional[str]]] = []
        self.created_access_keys: list[tuple[str, Optional[str], str]] = []
        self.account_name = account_name
        self.roots: dict[tuple[str, str], dict[str, object]] = {}

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        return {"id": account_id, "name": self.account_name, "user_list": []}

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        return self.roots.get((tenant or "", uid))

    def create_user_with_account_id(self, *args, **kwargs):
        uid = kwargs.get("uid")
        account_id = kwargs.get("account_id")
        self.created_users.append((uid, account_id))
        tenant = kwargs.get("tenant") or ""
        access_key = kwargs.get("access_key")
        secret_key = kwargs.get("secret_key")
        keys = []
        if access_key and secret_key:
            keys.append({"access_key": access_key, "secret_key": secret_key})
        elif kwargs.get("generate_key", True):
            keys.append({"access_key": "NEWROOT", "secret_key": "NEWSECRET"})
        root = {
            "uid": uid,
            "tenant": tenant,
            "account_id": account_id,
            "account_root": True,
            "keys": keys,
        }
        self.roots[(tenant, uid)] = root
        return root

    def create_access_key(
        self,
        uid: str,
        tenant: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
    ):
        root = self.roots[(tenant or "", uid)]
        key = {
            "access_key": access_key or "NEWROOT",
            "secret_key": secret_key or "NEWSECRET",
        }
        root["keys"].append(key)
        self.created_access_keys.append((uid, tenant, key["access_key"]))
        return {"keys": [key]}

    def delete_user(self, uid: str, tenant: Optional[str] = None):
        self.deleted_users.append((uid, tenant))
        self.roots.pop((tenant or "", uid), None)

    def delete_access_key(
        self,
        uid: str,
        access_key: str,
        tenant: Optional[str] = None,
    ):
        self.deleted_access_keys.append((uid, access_key, tenant))
        root = self.roots.get((tenant or "", uid))
        if root is not None:
            root["keys"] = [
                key
                for key in root["keys"]
                if key.get("access_key") != access_key
            ]

    def extract_keys(self, data):
        return data.get("keys", [])


class FakeRGWAdminImportCreatesTenantedRoot(FakeRGWAdminImportCreatesRoot):
    def __init__(self, tenant: str = "research"):
        super().__init__(account_name="Tenanted durable import")
        self.tenant = tenant

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        return {
            "account": {
                "id": account_id,
                "name": self.account_name,
                "tenant": self.tenant,
                "user_list": [],
            }
        }


def test_import_account_creates_root_user_when_missing(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportCreatesRoot()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    account_id = "RGW98765432109876543"
    imports = [S3AccountImport(rgw_account_id=account_id, name="Legacy", email="legacy@example.com", storage_endpoint_id=endpoint.id)]
    created = svc.import_accounts(imports)

    assert len(created) == 1
    db_account = db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    )
    assert db_account is not None
    assert len(db_account.rgw_access_key) == 20
    assert db_account.rgw_access_key == db_account.rgw_access_key.upper()
    assert db_account.rgw_secret_key
    assert fake_admin.created_users == [("RGW98765432109876543-admin", account_id)]
    assert db_account.rgw_user_uid == "RGW98765432109876543-admin"


@pytest.mark.parametrize(
    ("failure_call", "expected_phase"),
    [(3, "creating"), (4, "remote_created")],
)
def test_import_account_recovers_after_commit_failure_without_recreating_root(
    db_session,
    monkeypatch,
    failure_call,
    expected_phase,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportCreatesRoot()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW98765432109876544"
    real_commit = db_session.commit
    commit_calls = 0

    def fail_commit():
        nonlocal commit_calls
        commit_calls += 1
        if commit_calls == failure_call:
            raise RuntimeError("simulated account import commit failure")
        return real_commit()

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="simulated account import commit failure"):
        svc.import_accounts(
            [
                S3AccountImport(
                    rgw_account_id=account_id,
                    storage_endpoint_id=endpoint.id,
                )
            ]
        )

    intent = db_session.scalar(
        select(S3AccountImportIntent).where(
            S3AccountImportIntent.rgw_account_id == account_id
        )
    )
    assert intent is not None
    assert intent.phase == expected_phase
    intent_access_key = intent.access_key_id
    assert fake_admin.created_users == [(f"{account_id}-admin", account_id)]
    assert fake_admin.deleted_users == []
    assert fake_admin.deleted_access_keys == []
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ) is None

    monkeypatch.setattr(db_session, "commit", real_commit)
    imported = svc.import_accounts(
        [
            S3AccountImport(
                rgw_account_id=account_id,
                storage_endpoint_id=endpoint.id,
            )
        ]
    )

    assert len(imported) == 1
    stored = db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    )
    assert stored is not None
    assert stored.rgw_access_key == intent_access_key
    assert fake_admin.created_users == [(f"{account_id}-admin", account_id)]
    assert db_session.scalar(
        select(func.count()).select_from(S3AccountImportIntent)
    ) == 0


def test_import_account_rejects_pending_access_key_secret_collision(
    db_session,
    monkeypatch,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportCreatesRoot()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW98765432109876547"
    root_uid = f"{account_id}-admin"
    fake_admin.roots[("", root_uid)] = {
        "uid": root_uid,
        "tenant": "",
        "account_id": account_id,
        "account_root": True,
        "keys": [
            {
                "access_key": "COLLIDING-ACCOUNT-KEY",
                "secret_key": "REMOTE-SECRET",
            }
        ],
    }
    db_session.add(
        S3AccountImportIntent(
            storage_endpoint_id=endpoint.id,
            rgw_account_id=account_id,
            rgw_tenant="",
            root_uid=root_uid,
            account_name="Durable import collision",
            requested_name=None,
            requested_email=None,
            credential_action="create_root",
            access_key_id="COLLIDING-ACCOUNT-KEY",
            secret_access_key="PERSISTED-SECRET",
            phase="creating",
        )
    )
    db_session.commit()

    with pytest.raises(
        ValueError,
        match="collides with the pending import credential",
    ):
        svc.import_accounts(
            [
                S3AccountImport(
                    rgw_account_id=account_id,
                    storage_endpoint_id=endpoint.id,
                )
            ]
        )

    assert fake_admin.created_users == []
    assert fake_admin.created_access_keys == []
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ) is None


def test_import_account_does_not_recreate_missing_reused_credential(
    db_session,
    monkeypatch,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportCreatesRoot()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW98765432109876548"
    root_uid = f"{account_id}-admin"
    fake_admin.roots[("", root_uid)] = {
        "uid": root_uid,
        "tenant": "",
        "account_id": account_id,
        "account_root": True,
        "keys": [],
    }
    db_session.add(
        S3AccountImportIntent(
            storage_endpoint_id=endpoint.id,
            rgw_account_id=account_id,
            rgw_tenant="",
            root_uid=root_uid,
            account_name="Durable reused credential",
            requested_name=None,
            requested_email=None,
            credential_action="reuse",
            access_key_id="REUSED-ACCOUNT-KEY",
            secret_access_key="REUSED-SECRET",
            phase="remote_created",
        )
    )
    db_session.commit()

    with pytest.raises(
        ValueError,
        match="RGW account root credentials changed during import",
    ):
        svc.import_accounts(
            [
                S3AccountImport(
                    rgw_account_id=account_id,
                    storage_endpoint_id=endpoint.id,
                )
            ]
        )

    assert fake_admin.created_users == []
    assert fake_admin.created_access_keys == []
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ) is None


def test_pending_tenanted_account_import_finishes_after_tenant_creation_is_disabled(
    db_session,
    monkeypatch,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportCreatesTenantedRoot()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW98765432109876546"
    settings = load_app_settings_for_db(db_session)
    settings.general.allow_managed_rgw_tenant_creation = True
    monkeypatch.setattr(
        "app.services.s3_account_import_service.load_app_settings_for_db",
        lambda _db: settings,
    )
    real_commit = db_session.commit
    commit_calls = 0

    def fail_remote_checkpoint_commit():
        nonlocal commit_calls
        commit_calls += 1
        if commit_calls == 3:
            raise RuntimeError("simulated account remote checkpoint failure")
        return real_commit()

    monkeypatch.setattr(db_session, "commit", fail_remote_checkpoint_commit)
    payload = S3AccountImport(
        rgw_account_id=account_id,
        rgw_tenant="research",
        storage_endpoint_id=endpoint.id,
    )

    with pytest.raises(RuntimeError, match="simulated account remote checkpoint failure"):
        svc.import_accounts([payload])

    intent = db_session.scalar(
        select(S3AccountImportIntent).where(
            S3AccountImportIntent.rgw_account_id == account_id
        )
    )
    assert intent is not None
    assert intent.phase == "creating"
    intent_access_key = intent.access_key_id
    assert fake_admin.created_users == [(f"{account_id}-admin", account_id)]

    settings.general.allow_managed_rgw_tenant_creation = False
    monkeypatch.setattr(db_session, "commit", real_commit)
    imported = svc.import_accounts([payload])

    assert len(imported) == 1
    stored = db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    )
    assert stored is not None
    assert stored.rgw_tenant == "research"
    assert stored.rgw_access_key == intent_access_key
    assert fake_admin.created_users == [(f"{account_id}-admin", account_id)]
    assert db_session.scalar(
        select(func.count()).select_from(S3AccountImportIntent)
    ) == 0


def test_import_account_identifier_is_normalized_and_strictly_validated():
    normalized = S3AccountImport(
        rgw_account_id=" rgw12345678901234567 ",
        storage_endpoint_id=1,
    )

    assert normalized.rgw_account_id == "RGW12345678901234567"
    with pytest.raises(ValidationError, match="RGW followed by 17 digits"):
        S3AccountImport(rgw_account_id="RGW123", storage_endpoint_id=1)


class FakeRGWAdminImportSplitKeys(FakeRGWAdminImportCreatesRoot):
    def __init__(self):
        super().__init__(account_name="SplitKeysAccount")
        self.created_keys: list[tuple[str, Optional[str], str, str]] = []
        self.explicit_keys: list[dict[str, str]] = []

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        return {
            "uid": uid,
            "account_id": "RGW11111111111111111",
            "keys": [
                {"access_key": "ACCESS-ONLY"},
                {"secret_key": "SECRET-ONLY"},
                *self.explicit_keys,
            ],
        }

    def create_access_key(
        self,
        uid: str,
        tenant: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
    ):
        key = {
            "access_key": access_key or "MATCHED-ACCESS",
            "secret_key": secret_key or "MATCHED-SECRET",
        }
        self.explicit_keys.append(key)
        self.created_keys.append((uid, tenant, key["access_key"], key["secret_key"]))
        return {"keys": [key]}


def test_import_account_never_combines_credentials_from_different_keys(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportSplitKeys()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    account_id = "RGW11111111111111111"
    created = svc.import_accounts(
        [S3AccountImport(rgw_account_id=account_id, storage_endpoint_id=endpoint.id)]
    )

    assert len(created) == 1
    db_account = db_session.scalars(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ).one()
    assert db_account.rgw_access_key not in {"ACCESS-ONLY", "MATCHED-ACCESS"}
    assert len(db_account.rgw_access_key) == 20
    assert db_account.rgw_secret_key not in {"SECRET-ONLY", "MATCHED-SECRET"}
    assert fake_admin.created_keys == [
        (
            f"{account_id}-admin",
            None,
            db_account.rgw_access_key,
            db_account.rgw_secret_key,
        )
    ]


@pytest.mark.parametrize(
    ("failure_call", "expected_phase"),
    [(3, "creating"), (4, "remote_created")],
)
def test_import_account_key_creation_recovers_after_commit_failure(
    db_session,
    monkeypatch,
    failure_call,
    expected_phase,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportSplitKeys()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    account_id = "RGW11111111111111111"

    real_commit = db_session.commit
    commit_calls = 0

    def fail_commit():
        nonlocal commit_calls
        commit_calls += 1
        if commit_calls == failure_call:
            raise RuntimeError("simulated account import commit failure")
        return real_commit()

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="simulated account import commit failure"):
        svc.import_accounts(
            [S3AccountImport(rgw_account_id=account_id, storage_endpoint_id=endpoint.id)]
        )

    assert fake_admin.deleted_users == []
    assert fake_admin.deleted_access_keys == []
    intent = db_session.scalar(
        select(S3AccountImportIntent).where(
            S3AccountImportIntent.rgw_account_id == account_id
        )
    )
    assert intent is not None
    assert intent.phase == expected_phase
    created_keys = list(fake_admin.created_keys)
    assert len(created_keys) == 1
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == account_id)
    ) is None

    monkeypatch.setattr(db_session, "commit", real_commit)
    imported = svc.import_accounts(
        [S3AccountImport(rgw_account_id=account_id, storage_endpoint_id=endpoint.id)]
    )

    assert len(imported) == 1
    assert fake_admin.created_keys == created_keys
    assert db_session.scalar(
        select(func.count()).select_from(S3AccountImportIntent)
    ) == 0


class FakeRGWAdminImportBatch(FakeRGWAdminImportCreatesRoot):
    def __init__(self, missing_account_id: str):
        super().__init__(account_name="PreparedAccount")
        self.missing_account_id = missing_account_id

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        if account_id == self.missing_account_id:
            return {"not_found": True}
        return {"id": account_id, "name": f"Account-{account_id}", "user_list": []}


class FakeRGWAdminImportSecondRootFails(FakeRGWAdminImportCreatesRoot):
    def __init__(self, failing_account_id: str):
        super().__init__()
        self.failing_account_id = failing_account_id

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        return {"id": account_id, "name": f"Account-{account_id}", "user_list": []}

    def create_user_with_account_id(self, *args, **kwargs):
        if kwargs.get("account_id") == self.failing_account_id:
            raise RuntimeError("simulated second root creation failure")
        return super().create_user_with_account_id(*args, **kwargs)


def test_import_accounts_validates_entire_batch_before_mutating_rgw(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    missing_account_id = "RGW22222222222222222"
    fake_admin = FakeRGWAdminImportBatch(missing_account_id)
    svc = _build_service(db_session, monkeypatch, fake_admin)
    first_account_id = "RGW33333333333333333"

    with pytest.raises(ValueError, match=f"S3Account {missing_account_id} not found in RGW"):
        svc.import_accounts(
            [
                S3AccountImport(rgw_account_id=first_account_id, storage_endpoint_id=endpoint.id),
                S3AccountImport(rgw_account_id=missing_account_id, storage_endpoint_id=endpoint.id),
            ]
        )

    assert fake_admin.created_users == []
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id == first_account_id)
    ) is None


def test_import_accounts_mid_batch_failure_preserves_durable_intents_for_retry(
    db_session,
    monkeypatch,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    first_account_id = "RGW33333333333333333"
    second_account_id = "RGW33333333333333334"
    fake_admin = FakeRGWAdminImportSecondRootFails(second_account_id)
    svc = _build_service(db_session, monkeypatch, fake_admin)

    with pytest.raises(RuntimeError, match="simulated second root creation failure"):
        svc.import_accounts(
            [
                S3AccountImport(
                    rgw_account_id=first_account_id,
                    storage_endpoint_id=endpoint.id,
                ),
                S3AccountImport(
                    rgw_account_id=second_account_id,
                    storage_endpoint_id=endpoint.id,
                ),
            ]
        )

    intents = db_session.scalars(
        select(S3AccountImportIntent).order_by(S3AccountImportIntent.rgw_account_id)
    ).all()
    assert [intent.rgw_account_id for intent in intents] == [
        first_account_id,
        second_account_id,
    ]
    assert [intent.phase for intent in intents] == ["remote_created", "creating"]
    assert fake_admin.created_users == [(f"{first_account_id}-admin", first_account_id)]
    assert fake_admin.deleted_users == []
    assert db_session.scalar(
        select(S3Account).where(S3Account.rgw_account_id.in_([first_account_id, second_account_id]))
    ) is None
    fake_admin.failing_account_id = ""
    imported = svc.import_accounts(
        [
            S3AccountImport(
                rgw_account_id=first_account_id,
                storage_endpoint_id=endpoint.id,
            ),
            S3AccountImport(
                rgw_account_id=second_account_id,
                storage_endpoint_id=endpoint.id,
            ),
        ]
    )

    assert len(imported) == 2
    assert fake_admin.created_users == [
        (f"{first_account_id}-admin", first_account_id),
        (f"{second_account_id}-admin", second_account_id),
    ]
    assert db_session.scalar(
        select(func.count()).select_from(S3AccountImportIntent)
    ) == 0


def test_import_accounts_rejects_name_collisions_before_mutating_rgw(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    existing = S3Account(
        name="Existing account",
        rgw_account_id="RGW44444444444444444",
        rgw_user_uid="RGW44444444444444444-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(existing)
    db_session.commit()
    fake_admin = FakeRGWAdminImportCreatesRoot(account_name=existing.name)
    svc = _build_service(db_session, monkeypatch, fake_admin)

    with pytest.raises(ValueError, match="S3Account name already exists: Existing account"):
        svc.import_accounts(
            [
                S3AccountImport(
                    rgw_account_id="RGW55555555555555555",
                    storage_endpoint_id=endpoint.id,
                )
            ]
        )

    assert fake_admin.created_users == []


def test_import_accounts_rejects_batch_name_collision_in_same_scope(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportCreatesRoot(account_name="Batch duplicate")
    svc = _build_service(db_session, monkeypatch, fake_admin)

    with pytest.raises(ValueError, match="S3Account name already exists: Batch duplicate"):
        svc.import_accounts(
            [
                S3AccountImport(
                    rgw_account_id="RGW30000000000000001",
                    storage_endpoint_id=endpoint.id,
                ),
                S3AccountImport(
                    rgw_account_id="RGW30000000000000002",
                    storage_endpoint_id=endpoint.id,
                ),
            ]
        )

    assert fake_admin.created_users == []


class FakeRGWDeleteAdmin:
    def __init__(self):
        self.deleted: list[str] = []
        self.deleted_users: list[tuple[str, Optional[str]]] = []

    def delete_account(self, account_id: str):
        self.deleted.append(account_id)

    def delete_user(self, uid: str, tenant: Optional[str] = None):
        self.deleted_users.append((uid, tenant))

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        return {
            "uid": uid,
            "account_id": "RGW00000000000000002",
            "account_root": True,
            "keys": [],
        }

    def set_user_caps(self, uid: str, cap: str, tenant: Optional[str] = None):
        return {"uid": uid, "cap": cap, "tenant": tenant}

    def list_topics(self, account_id: Optional[str] = None):
        return []

    def list_users(self):
        return []

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        return {"id": account_id, "user_list": []}


class RetryableRGWDeleteAdmin(FakeRGWDeleteAdmin):
    def __init__(self, *, account_id: str, root_uid: str) -> None:
        super().__init__()
        self.account_id = account_id
        self.root_uid = root_uid
        self.account_exists = True
        self.root_exists = True

    def delete_account(self, account_id: str):
        assert account_id == self.account_id
        assert self.account_exists
        self.deleted.append(account_id)
        self.account_exists = False
        return {}

    def delete_user(self, uid: str, tenant: Optional[str] = None):
        assert uid == self.root_uid
        assert self.root_exists
        self.deleted_users.append((uid, tenant))
        self.root_exists = False

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        assert uid == self.root_uid
        if self.root_exists:
            return {
                "uid": uid,
                "account_id": self.account_id,
                "account_root": True,
                "keys": [],
            }
        if allow_not_found:
            return None
        raise RGWAdminError("missing", status_code=404, error_code="NoSuchUser")

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        assert account_id == self.account_id
        if self.account_exists:
            return {"id": account_id, "user_list": []}
        if allow_not_found:
            return None
        raise RGWAdminError("missing", status_code=404, error_code="NoSuchAccount")

    def list_accounts(self, include_details: bool = True):
        if not self.account_exists:
            return []
        return [{"id": self.account_id}]



def _seed_account_derived_rows(db_session, *, endpoint: StorageEndpoint, account: S3Account) -> None:
    db_session.add_all(
        [
            CostUsageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                source="rgw_admin_usage",
            ),
            CostStorageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                source="rgw_admin_bucket_stats",
            ),
            QuotaUsageHourly(
                hour_ts=datetime(2026, 1, 1, 8, 0, 0, tzinfo=UTC),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                used_bytes=1,
                used_objects=1,
            ),
            QuotaUsageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=1,
                last_used_objects=1,
            ),
            QuotaAlertState(
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
            ),
            BucketUsageStatsSnapshot(
                scope_kind="manager",
                scope_id=str(account.id),
                scope_name=account.name,
                bucket_name="account-bucket",
                data_type_distribution=[],
                storage_class_distribution=[],
                size_distribution=[],
                age_distribution=[],
                current_noncurrent_distribution=[],
            ),
        ]
    )
    db_session.commit()


def test_delete_account_skips_rgw_when_flag_false(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="DeleteMe",
        rgw_account_id="RGW00000000000000001",
        rgw_user_uid="rgw00000000000000001-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()

    fake_admin = FakeRGWDeleteAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    svc.delete_account(account.id, delete_rgw=False)

    assert fake_admin.deleted == []
    assert fake_admin.deleted_users == []
    assert db_session.scalar(select(S3Account).where(S3Account.id == account.id)) is None


def test_delete_account_purges_derived_database_rows(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="DeleteDerived",
        rgw_account_id="RGW00000000000000004",
        rgw_user_uid="rgw00000000000000004-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    _seed_account_derived_rows(db_session, endpoint=endpoint, account=account)
    favorite_owner = User(
        email="account-delete-favorite@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add(favorite_owner)
    db_session.flush()
    db_session.add(
        BrowserFavorite(
            id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            user_id=favorite_owner.id,
            surface="browser",
            name="Account favorite",
            workspace="portal",
            context=str(account.id),
            bucket="bucket-a",
            prefix="",
            revision=1,
        )
    )
    db_session.commit()

    fake_admin = FakeRGWDeleteAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    svc.delete_account(account.id, delete_rgw=False)

    assert db_session.scalar(
        select(func.count())
        .select_from(CostUsageDaily)
        .where(CostUsageDaily.s3_account_id == account.id)
    ) == 0
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(CostStorageDaily)
            .where(CostStorageDaily.s3_account_id == account.id)
        )
        == 0
    )
    assert db_session.scalar(
        select(func.count())
        .select_from(QuotaUsageHourly)
        .where(QuotaUsageHourly.s3_account_id == account.id)
    ) == 0
    assert db_session.scalar(
        select(func.count())
        .select_from(QuotaUsageDaily)
        .where(QuotaUsageDaily.s3_account_id == account.id)
    ) == 0
    assert db_session.scalar(
        select(func.count())
        .select_from(QuotaAlertState)
        .where(QuotaAlertState.s3_account_id == account.id)
    ) == 0
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(BucketUsageStatsSnapshot)
            .where(
                BucketUsageStatsSnapshot.scope_kind == "manager",
                BucketUsageStatsSnapshot.scope_id == str(account.id),
            )
        )
        == 0
    )
    assert db_session.scalar(
        select(func.count())
        .select_from(BrowserFavorite)
        .where(BrowserFavorite.context == str(account.id))
    ) == 0


def test_delete_account_rolls_back_partial_local_cleanup_on_failure(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    owner = User(
        email="account-delete-rollback@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    account = S3Account(
        name="DeleteRollback",
        rgw_account_id="RGW00000000000000006",
        rgw_user_uid="rgw00000000000000006-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add_all([owner, account])
    db_session.flush()
    db_session.add(
        UserS3Account(
            user_id=owner.id,
            account_id=account.id,
            manager_role="account_administrator",
        )
    )
    db_session.commit()

    svc = _build_service(db_session, monkeypatch, FakeRGWDeleteAdmin())
    monkeypatch.setattr(
        svc.deletion.tags,
        "cleanup_orphan_definitions",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("tag cleanup failed")),
    )

    with pytest.raises(RuntimeError, match="tag cleanup failed"):
        svc.delete_account(account.id, delete_rgw=False)

    db_session.expire_all()
    assert db_session.get(S3Account, account.id) is not None
    assert db_session.scalar(
        select(UserS3Account).where(UserS3Account.account_id == account.id)
    ) is not None


def test_delete_account_rejects_active_bucket_migration_before_remote_delete(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="MigrationSource",
        rgw_account_id="RGW00000000000000005",
        rgw_user_uid="rgw00000000000000005-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()
    migration = BucketMigration(
        source_context_id=str(account.id),
        target_context_id="conn-999",
        status="running",
    )
    db_session.add(migration)
    db_session.commit()

    fake_admin = FakeRGWDeleteAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    with pytest.raises(ValueError, match=rf"bucket migration {migration.id}"):
        svc.delete_account(account.id, delete_rgw=True)

    assert fake_admin.deleted == []
    assert fake_admin.deleted_users == []
    assert db_session.scalars(select(S3Account).where(S3Account.id == account.id)).one()


def test_delete_account_calls_rgw_when_flag_true(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="DeleteRGW",
        rgw_account_id="RGW00000000000000002",
        rgw_user_uid="rgw00000000000000002-admin",
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()

    fake_admin = FakeRGWDeleteAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    svc.deletion.metrics.get_usage = lambda acc: (0, 0, 0)  # type: ignore[method-assign]
    svc.rgw_users.resolve = lambda account_id, tenant, admin, **kwargs: (0, [])  # type: ignore[method-assign]
    svc.account_topics.resolve = lambda account_id, admin, endpoint_id: (0, [])  # type: ignore[method-assign]

    svc.delete_account(account.id, delete_rgw=True)

    assert fake_admin.deleted == ["RGW00000000000000002"]
    assert fake_admin.deleted_users == [("rgw00000000000000002-admin", None)]
    assert db_session.scalar(select(S3Account).where(S3Account.id == account.id)) is None


@pytest.mark.parametrize(
    ("failure_call", "root_checkpoint", "account_checkpoint", "account_deleted_before_retry"),
    [
        (3, False, False, False),
        (4, True, False, True),
        (5, True, True, True),
    ],
)
def test_delete_account_recovers_after_commit_failure_without_remote_replay(
    db_session,
    monkeypatch,
    failure_call,
    root_checkpoint,
    account_checkpoint,
    account_deleted_before_retry,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account_id = f"RGW000000000000000{failure_call}"
    root_uid = f"rgw000000000000000{failure_call}-admin"
    account = S3Account(
        name=f"RetryDelete{failure_call}",
        rgw_account_id=account_id,
        rgw_user_uid=root_uid,
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()

    fake_admin = RetryableRGWDeleteAdmin(account_id=account_id, root_uid=root_uid)
    svc = _build_service(db_session, monkeypatch, fake_admin)
    svc.deletion.metrics.get_usage = lambda _account: (0, 0, 0)  # type: ignore[method-assign]
    svc.rgw_users.resolve = lambda *_args, **_kwargs: (0, [])  # type: ignore[method-assign]
    svc.account_topics.resolve = lambda *_args, **_kwargs: (0, [])  # type: ignore[method-assign]
    original_commit = s3_account_deletion_service_module.commit_or_rollback
    commit_calls = 0

    def fail_selected_commit(db):
        nonlocal commit_calls
        commit_calls += 1
        if commit_calls == failure_call:
            db.rollback()
            raise RuntimeError("simulated account deletion commit failure")
        original_commit(db)

    monkeypatch.setattr(
        s3_account_deletion_service_module,
        "commit_or_rollback",
        fail_selected_commit,
    )

    with pytest.raises(RuntimeError, match="simulated account deletion commit failure"):
        svc.delete_account(account.id, delete_rgw=True)

    db_session.expire_all()
    deletion = db_session.scalar(
        select(S3AccountDeletion).where(S3AccountDeletion.account_id == account.id)
    )
    assert db_session.get(S3Account, account.id) is not None
    assert deletion is not None
    assert deletion.iam_cleanup_completed is True
    assert deletion.root_user_deleted is root_checkpoint
    assert deletion.remote_account_deleted is account_checkpoint
    assert fake_admin.deleted_users == [(root_uid, None)]
    assert fake_admin.deleted == ([account_id] if account_deleted_before_retry else [])

    with pytest.raises(ValueError, match="deletion is pending"):
        svc.update_account(account.id, S3AccountUpdate(name="Must not mutate"))
    with pytest.raises(ValueError, match="deletion is pending"):
        svc.delete_account(account.id, delete_rgw=False)

    monkeypatch.setattr(
        s3_account_deletion_service_module,
        "commit_or_rollback",
        original_commit,
    )
    svc.delete_account(account.id, delete_rgw=True)

    assert fake_admin.deleted_users == [(root_uid, None)]
    assert fake_admin.deleted == [account_id]
    assert db_session.get(S3Account, account.id) is None
    assert db_session.scalar(
        select(S3AccountDeletion).where(S3AccountDeletion.account_id == account.id)
    ) is None


def test_delete_account_keeps_local_state_when_detail_absence_is_ambiguous(
    db_session,
    monkeypatch,
):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="AmbiguousRemoteAccount",
        rgw_account_id="RGW00000000000000091",
        rgw_user_uid="rgw00000000000000091-admin",
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()

    fake_admin = RetryableRGWDeleteAdmin(
        account_id=account.rgw_account_id,
        root_uid=account.rgw_user_uid,
    )
    monkeypatch.setattr(
        fake_admin,
        "get_account",
        lambda *_args, **_kwargs: None,
    )
    svc = _build_service(db_session, monkeypatch, fake_admin)

    with pytest.raises(
        ValueError,
        match="still exists but its detail could not be verified",
    ):
        svc.delete_account(account.id, delete_rgw=True)

    assert db_session.get(S3Account, account.id) is not None
    assert db_session.scalar(
        select(S3AccountDeletion).where(S3AccountDeletion.account_id == account.id)
    ) is None
    assert fake_admin.deleted_users == []
    assert fake_admin.deleted == []
