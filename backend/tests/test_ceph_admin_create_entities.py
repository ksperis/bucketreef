# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.ceph_admin import (
    CephAdminRgwAccountCreate,
    CephAdminRgwAccountConfigUpdate,
    CephAdminRgwUserCapsUpdate,
    CephAdminRgwUserCreate,
    CephAdminRgwUserConfigUpdate,
)
from app.routers.ceph_admin import account_profiles as account_profiles_router
from app.routers.ceph_admin import accounts as accounts_router
from app.routers.ceph_admin import buckets as buckets_router
from app.routers.ceph_admin import user_profiles as user_profiles_router
from app.routers.ceph_admin import user_keys as user_keys_router
from app.services import ceph_admin_bucket_listing_cache
from app.services.ceph_admin_identity_listing_cache import (
    invalidate_accounts_listing_cache,
    invalidate_users_listing_cache,
)


@pytest.fixture(autouse=True)
def clear_ceph_admin_caches():
    invalidate_accounts_listing_cache()
    invalidate_users_listing_cache()
    ceph_admin_bucket_listing_cache.reset_ceph_admin_bucket_listing_caches_for_tests()
    yield
    invalidate_accounts_listing_cache()
    invalidate_users_listing_cache()
    ceph_admin_bucket_listing_cache.reset_ceph_admin_bucket_listing_caches_for_tests()


class FakeAccountsAdmin:
    def __init__(self):
        self.create_account_calls: list[dict] = []
        self.set_account_quota_calls: list[dict] = []
        self.account_tenants: dict[str, str] = {}

    def create_account(
        self,
        account_id: str | None = None,
        account_name: str | None = None,
        tenant: str | None = None,
        email: str | None = None,
        max_users: int | None = None,
        max_buckets: int | None = None,
        max_roles: int | None = None,
        max_groups: int | None = None,
        max_access_keys: int | None = None,
        extra_params: dict | None = None,
    ):
        resolved_account_id = account_id or "RGW99999999999999990"
        self.account_tenants[resolved_account_id] = tenant or ""
        self.create_account_calls.append(
            {
                "account_id": resolved_account_id,
                "account_name": account_name,
                "tenant": tenant,
                "email": email,
                "max_users": max_users,
                "max_buckets": max_buckets,
                "max_roles": max_roles,
                "max_groups": max_groups,
                "max_access_keys": max_access_keys,
                "extra_params": extra_params,
            }
        )
        return {
            "id": resolved_account_id,
            "name": account_name or resolved_account_id,
            "tenant": tenant or "",
        }

    def set_account_quota(
        self,
        account_id: str,
        max_size_bytes: int | None,
        max_objects: int | None,
        enabled: bool,
        quota_type: str = "account",
    ):
        self.set_account_quota_calls.append(
            {
                "account_id": account_id,
                "max_size_bytes": max_size_bytes,
                "max_objects": max_objects,
                "enabled": enabled,
                "quota_type": quota_type,
            }
        )
        return {}

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = True,
        allow_not_implemented: bool = False,
    ):
        return {
            "id": account_id,
            "tenant": self.account_tenants.get(account_id, ""),
            "name": f"Account-{account_id}",
            "max_users": 8,
            "max_buckets": 20,
            "quota": {
                "enabled": True,
                "max_size": 2048,
                "max_objects": 200,
            },
        }


def _ctx(endpoint_id: int, rgw_admin: object) -> SimpleNamespace:
    return SimpleNamespace(
        endpoint=SimpleNamespace(id=endpoint_id),
        rgw_admin=rgw_admin,
        actor=None,
        audit_service=None,
    )


def test_create_rgw_account_supports_quota():
    fake_rgw = FakeAccountsAdmin()
    ctx = _ctx(901, fake_rgw)
    payload = CephAdminRgwAccountCreate(
        account_id="RGW12345678901234567",
        account_name="Primary Account",
        email="owner@example.test",
        max_users=12,
        max_buckets=40,
        quota_enabled=True,
        quota_max_size_bytes=4096,
        quota_max_objects=400,
    )

    response = account_profiles_router.create_rgw_account(payload=payload, ctx=ctx)

    assert response.account.account_id == "RGW12345678901234567"

    assert len(fake_rgw.create_account_calls) == 1
    assert fake_rgw.create_account_calls[0]["account_id"] == "RGW12345678901234567"
    assert len(fake_rgw.set_account_quota_calls) == 1
    assert fake_rgw.set_account_quota_calls[0]["enabled"] is True


def test_create_rgw_account_supports_explicit_tenant_independently():
    fake_rgw = FakeAccountsAdmin()
    response = account_profiles_router.create_rgw_account(
        payload=CephAdminRgwAccountCreate(
            account_id="RGW12345678901234567",
            account_name="Tenant Account",
            tenant="team_a",
        ),
        ctx=_ctx(901, fake_rgw),
    )

    assert fake_rgw.create_account_calls[0]["tenant"] == "team_a"
    assert response.account.tenant == "team_a"


def test_create_rgw_account_generates_configured_id_when_omitted(monkeypatch):
    fake_rgw = FakeAccountsAdmin()
    ctx = _ctx(901, fake_rgw)
    monkeypatch.setattr(
        account_profiles_router,
        "load_app_settings",
        lambda: SimpleNamespace(
            general=SimpleNamespace(rgw_account_id_prefix="80")
        ),
    )
    monkeypatch.setattr("app.utils.rgw_identifiers.secrets.randbelow", lambda _limit: 42)

    response = account_profiles_router.create_rgw_account(
        payload=CephAdminRgwAccountCreate(account_name="Generated"),
        ctx=ctx,
    )

    assert response.account.account_id == "RGW80000000000000042"
    assert fake_rgw.create_account_calls[0]["account_id"] == "RGW80000000000000042"


@pytest.mark.parametrize("model,fields", [
    (CephAdminRgwAccountCreate, {"account_name": "A"}),
    (CephAdminRgwAccountConfigUpdate, {}),
])
@pytest.mark.parametrize("key", ["id", "account_id", "NAME", "email", "format", "max_users", "tenant"])
def test_account_model_rejects_extra_params_overriding_dedicated_fields(model, fields, key):
    with pytest.raises(ValidationError, match="cannot be overridden"):
        model(**fields, extra_params={key: "foreign"})


def test_create_rgw_account_conflict_never_updates_existing_quotas():
    class ConflictingAdmin(FakeAccountsAdmin):
        def create_account(self, **kwargs):
            self.create_account_calls.append(kwargs)
            return {"conflict": True, "status_code": 409}

    admin = ConflictingAdmin()
    with pytest.raises(HTTPException) as raised:
        account_profiles_router.create_rgw_account(
            CephAdminRgwAccountCreate(account_id="RGW12345678901234567", account_name="Duplicate",
                                      quota_enabled=True, quota_max_objects=200),
            ctx=_ctx(901, admin),
        )
    assert raised.value.status_code == 409
    assert admin.set_account_quota_calls == []


@pytest.mark.parametrize("returned", [
    {"id": "RGW99999999999999999"},
    {"id": "RGW12345678901234567", "account": {"id": "RGW99999999999999999"}},
    {},
])
def test_create_rgw_account_requires_confirmed_identity_before_quotas(returned):
    class WrongAdmin(FakeAccountsAdmin):
        def create_account(self, **kwargs):
            return returned

    admin = WrongAdmin()
    with pytest.raises(HTTPException) as raised:
        account_profiles_router.create_rgw_account(
            CephAdminRgwAccountCreate(account_id="RGW12345678901234567", account_name="A",
                                      quota_enabled=True), ctx=_ctx(901, admin),
        )
    assert raised.value.status_code == 502
    assert admin.set_account_quota_calls == []


def test_update_rgw_account_conflict_blocks_followup_quotas():
    class ConflictingAdmin(FakeAccountsAdmin):
        def update_account(self, *args, **kwargs):
            return {"conflict": True, "status_code": 409}

    admin = ConflictingAdmin()
    with pytest.raises(HTTPException) as raised:
        account_profiles_router.update_rgw_account_config(
            "RGW12345678901234567",
            CephAdminRgwAccountConfigUpdate(account_name="Other", quota_max_objects=100),
            ctx=_ctx(901, admin),
        )
    assert raised.value.status_code == 409
    assert admin.set_account_quota_calls == []


def test_update_rgw_account_rejects_wrong_identity_before_quotas():
    class WrongAdmin(FakeAccountsAdmin):
        def update_account(self, *args, **kwargs):
            return {"id": "RGW99999999999999999"}

    admin = WrongAdmin()
    with pytest.raises(HTTPException) as raised:
        account_profiles_router.update_rgw_account_config(
            "RGW12345678901234567",
            CephAdminRgwAccountConfigUpdate(email="owner@example.test", quota_enabled=True),
            ctx=_ctx(901, admin),
        )
    assert raised.value.status_code == 502
    assert admin.set_account_quota_calls == []


@pytest.mark.parametrize("account_name", ["invalid:name", "invalid$name", "   ", "invalid\ud800"])
def test_create_rgw_account_model_rejects_invalid_name(account_name: str):
    with pytest.raises(ValidationError):
        CephAdminRgwAccountCreate(account_name=account_name)


def test_update_rgw_account_quota_omits_unset_object_limit():
    fake_rgw = FakeAccountsAdmin()
    ctx = _ctx(901, fake_rgw)

    account_profiles_router.update_rgw_account_config(
        "RGW12345678901234567",
        CephAdminRgwAccountConfigUpdate(
            quota_enabled=True,
            quota_max_size_bytes=4096,
        ),
        ctx=ctx,
    )

    assert fake_rgw.set_account_quota_calls[-1] == {
        "account_id": "RGW12345678901234567",
        "max_size_bytes": 4096,
        "max_objects": None,
        "enabled": True,
        "quota_type": "account",
    }


def test_update_rgw_account_quota_clears_object_limit_with_explicit_null():
    fake_rgw = FakeAccountsAdmin()
    ctx = _ctx(901, fake_rgw)

    account_profiles_router.update_rgw_account_config(
        "RGW12345678901234567",
        CephAdminRgwAccountConfigUpdate(quota_max_objects=None),
        ctx=ctx,
    )

    assert fake_rgw.set_account_quota_calls[-1] == {
        "account_id": "RGW12345678901234567",
        "max_size_bytes": None,
        "max_objects": 0,
        "enabled": True,
        "quota_type": "account",
    }


def test_update_rgw_bucket_quota_omits_unset_object_limit():
    fake_rgw = FakeAccountsAdmin()
    ctx = _ctx(901, fake_rgw)

    account_profiles_router.update_rgw_account_config(
        "RGW12345678901234567",
        CephAdminRgwAccountConfigUpdate(
            bucket_quota_enabled=True,
            bucket_quota_max_size_bytes=8192,
        ),
        ctx=ctx,
    )

    assert fake_rgw.set_account_quota_calls[-1] == {
        "account_id": "RGW12345678901234567",
        "max_size_bytes": 8192,
        "max_objects": None,
        "enabled": True,
        "quota_type": "bucket",
    }


def test_update_rgw_bucket_quota_clears_object_limit_with_explicit_null():
    fake_rgw = FakeAccountsAdmin()
    ctx = _ctx(901, fake_rgw)

    account_profiles_router.update_rgw_account_config(
        "RGW12345678901234567",
        CephAdminRgwAccountConfigUpdate(bucket_quota_max_objects=None),
        ctx=ctx,
    )

    assert fake_rgw.set_account_quota_calls[-1] == {
        "account_id": "RGW12345678901234567",
        "max_size_bytes": None,
        "max_objects": 0,
        "enabled": True,
        "quota_type": "bucket",
    }


class FakeUsersAdmin:
    def __init__(self):
        self.create_user_calls: list[dict] = []
        self.create_user_with_account_id_calls: list[dict] = []
        self.update_user_calls: list[dict] = []
        self.set_user_caps_calls: list[dict] = []
        self.set_user_quota_calls: list[dict] = []
        self.get_account_calls = 0
        self.account_tenants: dict[str, str] = {}
        self.existing_users: dict[tuple[str, str | None], str | None] = {
            ("cost-user", None): "RGW99999999999999999",
            ("cost-user", "tenant-a"): None,
        }

    def extract_keys(self, raw):
        if not isinstance(raw, dict):
            return []
        entries = raw.get("keys")
        return entries if isinstance(entries, list) else []

    def create_user(
        self,
        uid: str,
        display_name: str | None = None,
        email: str | None = None,
        tenant: str | None = None,
        generate_key: bool = True,
        extra_params: dict | None = None,
    ):
        self.create_user_calls.append(
            {
                "uid": uid,
                "display_name": display_name,
                "email": email,
                "tenant": tenant,
                "generate_key": generate_key,
                "extra_params": extra_params,
            }
        )
        self.existing_users[(uid, tenant)] = None
        return {"keys": [{"access_key": "AKIA-USER", "secret_key": "SECRET-USER"}]}

    def create_user_with_account_id(
        self,
        uid: str,
        account_id: str,
        display_name: str | None = None,
        account_root: bool = True,
        email: str | None = None,
        generate_key: bool = True,
        extra_params: dict | None = None,
        tenant: str | None = None,
    ):
        self.create_user_with_account_id_calls.append(
            {
                "uid": uid,
                "account_id": account_id,
                "display_name": display_name,
                "account_root": account_root,
                "email": email,
                "generate_key": generate_key,
                "extra_params": extra_params,
                "tenant": tenant,
            }
        )
        self.existing_users[(uid, tenant)] = account_id
        return {"keys": [{"access_key": "AKIA-ACCOUNT", "secret_key": "SECRET-ACCOUNT"}]}

    def update_user(self, uid: str, **kwargs):
        self.update_user_calls.append({"uid": uid, **kwargs})
        return {}

    def set_user_caps(self, uid: str, caps: list[str], tenant: str | None = None, op: str = "add"):
        self.set_user_caps_calls.append({"uid": uid, "caps": caps, "tenant": tenant, "op": op})
        return {}

    def set_user_quota(self, uid: str, tenant: str | None = None, max_size_bytes: int | None = None, max_objects: int | None = None, enabled: bool = True):
        self.set_user_quota_calls.append(
            {
                "uid": uid,
                "tenant": tenant,
                "max_size_bytes": max_size_bytes,
                "max_objects": max_objects,
                "enabled": enabled,
            }
        )
        return {}

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
        if (uid, tenant) not in self.existing_users:
            return None
        return {
            "user": {
                "uid": uid,
                "tenant": tenant,
                "display_name": "Account User",
                "email": "account-user@example.test",
                "max_buckets": 10,
            },
            "account_id": self.existing_users[(uid, tenant)],
            "caps": ["users=read"],
            "user_quota": {"enabled": True, "max_size": 512, "max_objects": 10},
        }

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = True,
        allow_not_implemented: bool = False,
    ):
        self.get_account_calls += 1
        return {
            "id": account_id,
            "tenant": self.account_tenants.get(account_id, ""),
            "name": f"Account-{account_id}",
        }

    def list_user_keys(self, uid: str, tenant: str | None = None):
        return [{"access_key": "AKIA-LISTED", "secret_key": "SECRET-LISTED", "status": "enabled"}]


def test_create_rgw_user_with_account_scope_returns_generated_key():
    fake_rgw = FakeUsersAdmin()
    fake_rgw.existing_users.clear()
    ctx = _ctx(902, fake_rgw)
    payload = CephAdminRgwUserCreate(
        uid="cost-user",
        account_id="RGW99999999999999999",
        display_name="Cost user",
        email="cost@example.test",
        account_root=True,
        system=False,
        suspended=False,
        max_buckets=15,
        generate_key=True,
        caps=CephAdminRgwUserCapsUpdate(mode="add", values=["usage=read"]),
        quota_enabled=True,
        quota_max_size_bytes=1024,
        quota_max_objects=100,
    )

    response = user_profiles_router.create_rgw_user(payload=payload, ctx=ctx)

    assert response.detail.uid == "cost-user"
    assert response.detail.account_id == "RGW99999999999999999"
    assert response.detail.account_name == "Account-RGW99999999999999999"
    assert response.generated_key is not None
    assert response.generated_key.access_key == "AKIA-ACCOUNT"
    assert response.generated_key.secret_key == "SECRET-ACCOUNT"

    assert len(fake_rgw.create_user_with_account_id_calls) == 1
    assert fake_rgw.create_user_with_account_id_calls[0]["account_root"] is True
    assert len(fake_rgw.update_user_calls) == 1
    assert fake_rgw.update_user_calls[0] == {
        "uid": "cost-user",
        "tenant": None,
        "display_name": "Cost user",
        "email": "cost@example.test",
        "suspended": False,
        "max_buckets": 15,
        "op_mask": None,
        "system": False,
        "account_root": True,
    }
    assert len(fake_rgw.set_user_caps_calls) == 1
    assert fake_rgw.set_user_caps_calls[0]["caps"] == ["usage=read"]
    assert len(fake_rgw.set_user_quota_calls) == 1


def test_create_rgw_user_inherits_selected_account_tenant():
    fake_rgw = FakeUsersAdmin()
    fake_rgw.existing_users.clear()
    fake_rgw.account_tenants["RGW99999999999999999"] = "team_a"

    response = user_profiles_router.create_rgw_user(
        payload=CephAdminRgwUserCreate(
            uid="cost-user",
            account_id="RGW99999999999999999",
            display_name="Cost user",
            generate_key=True,
        ),
        ctx=_ctx(902, fake_rgw),
    )

    assert fake_rgw.create_user_with_account_id_calls[0]["tenant"] == "team_a"
    assert response.detail.tenant == "team_a"
    assert response.detail.account_id == "RGW99999999999999999"


def test_create_rgw_user_rejects_tenant_conflicting_with_selected_account():
    fake_rgw = FakeUsersAdmin()
    fake_rgw.existing_users.clear()
    fake_rgw.account_tenants["RGW99999999999999999"] = "team_a"

    with pytest.raises(HTTPException) as raised:
        user_profiles_router.create_rgw_user(
            payload=CephAdminRgwUserCreate(
                uid="cost-user",
                account_id="RGW99999999999999999",
                tenant="team_b",
            ),
            ctx=_ctx(902, fake_rgw),
        )

    assert raised.value.status_code == 400
    assert fake_rgw.create_user_with_account_id_calls == []


@pytest.mark.parametrize("existing_account", ["RGW88888888888888888", "RGW99999999999999999"])
def test_create_rgw_user_rejects_existing_uid_without_touching_any_account(existing_account):
    admin = FakeUsersAdmin()
    admin.existing_users[("cost-user", None)] = existing_account
    ctx = _ctx(902, admin)

    with pytest.raises(HTTPException) as raised:
        user_profiles_router.create_rgw_user(
            CephAdminRgwUserCreate(
                uid="cost-user", account_id="RGW99999999999999999",
                generate_key=True, caps=CephAdminRgwUserCapsUpdate(values=["users=*"], mode="add"),
                quota_enabled=True, quota_max_objects=100,
            ),
            ctx=ctx,
        )

    assert raised.value.status_code == 409
    assert not admin.create_user_with_account_id_calls
    assert not admin.update_user_calls
    assert not admin.set_user_caps_calls
    assert not admin.set_user_quota_calls


def test_create_rgw_user_rejects_rgw_conflict_even_if_user_appears_afterwards():
    class ConflictAdmin(FakeUsersAdmin):
        def create_user_with_account_id(self, **kwargs):
            self.existing_users[(kwargs["uid"], None)] = "RGW88888888888888888"
            return {"conflict": True, "status_code": 409}

    admin = ConflictAdmin()
    admin.existing_users.clear()
    with pytest.raises(HTTPException) as raised:
        user_profiles_router.create_rgw_user(
            CephAdminRgwUserCreate(uid="cost-user", account_id="RGW99999999999999999", generate_key=True),
            ctx=_ctx(902, admin),
        )

    assert raised.value.status_code == 409
    assert not admin.update_user_calls
    assert not admin.set_user_caps_calls
    assert not admin.set_user_quota_calls


def test_create_rgw_user_rejects_foreign_identity_even_after_apparent_create_success():
    class WrongAccountAdmin(FakeUsersAdmin):
        def create_user_with_account_id(self, **kwargs):
            response = super().create_user_with_account_id(**kwargs)
            self.existing_users[(kwargs["uid"], None)] = "RGW88888888888888888"
            return response

    admin = WrongAccountAdmin()
    admin.existing_users.clear()
    with pytest.raises(HTTPException) as raised:
        user_profiles_router.create_rgw_user(
            CephAdminRgwUserCreate(
                uid="cost-user", account_id="RGW99999999999999999", display_name="Modified",
                caps=CephAdminRgwUserCapsUpdate(values=["users=*"], mode="add"),
                quota_enabled=True, quota_max_objects=100,
            ),
            ctx=_ctx(902, admin),
        )

    assert raised.value.status_code == 409
    assert not admin.update_user_calls
    assert not admin.set_user_caps_calls
    assert not admin.set_user_quota_calls


@pytest.mark.parametrize("expected_account_id", [None, "RGW88888888888888888"])
def test_user_configuration_rejects_missing_or_wrong_account_scope(expected_account_id):
    admin = FakeUsersAdmin()
    with pytest.raises(HTTPException) as raised:
        user_profiles_router.update_rgw_user_config(
            "cost-user",
            CephAdminRgwUserConfigUpdate(
                display_name="Foreign edit", quota_max_objects=12,
                caps=CephAdminRgwUserCapsUpdate(mode="add", values=["users=*"]),
            ),
            expected_account_id=expected_account_id,
            ctx=_ctx(902, admin),
        )

    assert raised.value.status_code == 409
    assert not admin.update_user_calls
    assert not admin.set_user_caps_calls
    assert not admin.set_user_quota_calls


def test_detail_read_checks_account_before_fetching_keys():
    class GuardedAdmin(FakeUsersAdmin):
        def list_user_keys(self, uid, tenant=None):
            pytest.fail("Foreign user keys must not be fetched")

    with pytest.raises(HTTPException) as raised:
        user_profiles_router.get_rgw_user_detail(
            "cost-user", expected_account_id="RGW88888888888888888",
            ctx=_ctx(902, GuardedAdmin()),
        )
    assert raised.value.status_code == 409


def test_key_creation_checks_account_before_mutating_rgw(db_session):
    class GuardedAdmin(FakeUsersAdmin):
        def create_access_key(self, uid, tenant=None):
            pytest.fail("A foreign user key must not be created")

    with pytest.raises(HTTPException) as raised:
        user_keys_router.create_rgw_user_key(
            "cost-user", expected_account_id="RGW88888888888888888",
            ctx=_ctx(902, GuardedAdmin()), db=db_session,
        )
    assert raised.value.status_code == 409


@pytest.mark.parametrize("model,fields", [
    (CephAdminRgwUserCreate, {"uid": "new-user"}),
    (CephAdminRgwUserConfigUpdate, {}),
])
@pytest.mark.parametrize("override", ["uid", "account_id", "account-root", "secret_key", "tenant", "generate-key"])
def test_user_extra_params_cannot_override_identity_or_credentials(model, fields, override):
    with pytest.raises(ValidationError):
        model(**fields, extra_params={override: "arbitrary"})


def test_update_rgw_user_quota_omits_unset_object_limit():
    fake_rgw = FakeUsersAdmin()
    ctx = _ctx(902, fake_rgw)

    user_profiles_router.update_rgw_user_config(
        "cost-user",
        CephAdminRgwUserConfigUpdate(
            quota_enabled=True,
            quota_max_size_bytes=2048,
        ),
        expected_account_id="RGW99999999999999999",
        ctx=ctx,
    )

    assert fake_rgw.set_user_quota_calls[-1] == {
        "uid": "cost-user",
        "tenant": None,
        "max_size_bytes": 2048,
        "max_objects": None,
        "enabled": True,
    }


def test_update_rgw_user_config_preserves_null_clearing_semantics():
    fake_rgw = FakeUsersAdmin()
    ctx = _ctx(902, fake_rgw)

    user_profiles_router.update_rgw_user_config(
        "cost-user",
        CephAdminRgwUserConfigUpdate(
            display_name=None,
            email=None,
            max_buckets=None,
            op_mask=None,
        ),
        tenant="tenant-a",
        ctx=ctx,
    )

    assert fake_rgw.update_user_calls[-1] == {
        "uid": "cost-user",
        "tenant": "tenant-a",
        "display_name": "",
        "email": "",
        "suspended": None,
        "max_buckets": 0,
        "op_mask": "",
        "system": None,
        "account_root": None,
        "extra_params": None,
    }


@pytest.mark.parametrize("model,fields", [
    (CephAdminRgwUserCreate, {"uid": "new-user", "admin": True}),
    (CephAdminRgwUserConfigUpdate, {"admin": True}),
])
def test_user_mutation_rejects_unsupported_admin_flag(model, fields):
    with pytest.raises(ValidationError):
        model(**fields)


def test_update_rgw_user_quota_clears_object_limit_with_explicit_null():
    fake_rgw = FakeUsersAdmin()
    ctx = _ctx(902, fake_rgw)

    user_profiles_router.update_rgw_user_config(
        "cost-user",
        CephAdminRgwUserConfigUpdate(quota_max_objects=None),
        expected_account_id="RGW99999999999999999",
        ctx=ctx,
    )

    assert fake_rgw.set_user_quota_calls[-1] == {
        "uid": "cost-user",
        "tenant": None,
        "max_size_bytes": None,
        "max_objects": 0,
        "enabled": True,
    }
