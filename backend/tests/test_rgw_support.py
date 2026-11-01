# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.storage_endpoint_features import parse_features_config
import pytest

from app.db import StorageEndpoint, StorageProvider
from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client
from app.services.rgw_supervision import get_supervision_rgw_client
from tests.service_identity_helpers import service_identity
from app.utils.rgw_identifiers import (
    is_rgw_account_id,
    resolve_account_scope,
    validate_rgw_account_name,
)
from app.utils.rgw_payloads import (
    extract_rgw_account_id,
    extract_rgw_account_ids,
    extract_rgw_account_name,
    extract_rgw_account_payload,
    extract_rgw_account_tenant_optional,
    extract_rgw_user_account_id,
    extract_rgw_user_account_ids,
    extract_rgw_user_account_aliases,
    extract_rgw_user_caps,
    extract_rgw_user_bool,
    extract_rgw_user_identity,
    extract_rgw_user_int,
    extract_rgw_user_listing_identity,
    extract_rgw_user_payload,
    extract_rgw_user_scalar,
    rgw_qualified_uid,
)


def test_extract_rgw_account_ids_preserves_alias_conflicts():
    assert extract_rgw_account_ids(
        {"id": " RGW001 ", "account_id": "RGW001"},
        {"account_id": "RGW002"},
        None,
    ) == {"RGW001", "RGW002"}


def test_extract_rgw_account_ids_ignores_empty_values_and_normalizes_scalars():
    assert extract_rgw_account_ids(
        {"id": " ", "account_id": 42},
        {"id": None},
        "RGW999",
    ) == {"42"}


def test_extract_rgw_account_ids_reads_nested_account_payloads_and_preserves_conflicts():
    assert extract_rgw_account_ids(
        {"id": "RGW001", "account": {"account_id": "RGW002"}}
    ) == {"RGW001", "RGW002"}


def test_extract_rgw_account_id_prefers_account_id_alias():
    assert extract_rgw_account_id(
        {"account_id": " RGW002 ", "id": "RGW001"}
    ) == "RGW002"


def test_extract_rgw_account_id_prefers_nested_account_payload():
    assert extract_rgw_account_id(
        {"id": "RGW001", "account": {"account_id": " RGW002 "}}
    ) == "RGW002"


def test_extract_rgw_account_payload_prefers_nested_account_envelope():
    nested = {"id": "RGW002", "user_list": ["alice"]}
    assert extract_rgw_account_payload({"id": "RGW001", "account": nested}) is nested
    assert extract_rgw_account_payload({"id": "RGW001"}) == {"id": "RGW001"}
    assert extract_rgw_account_payload(None) == {}


def test_extract_rgw_account_name_normalizes_supported_aliases():
    assert extract_rgw_account_name({"account_name": " Account "}) == "Account"
    assert extract_rgw_account_name({"name": " Name "}) == "Name"
    assert extract_rgw_account_name({"display_name": " Display "}) == "Display"
    assert extract_rgw_account_name(
        {"name": "Wrapper", "account": {"name": " Nested "}}
    ) == "Nested"


def test_extract_rgw_account_tenant_optional_preserves_presence_and_nested_payload():
    assert extract_rgw_account_tenant_optional({"id": "RGW001"}) is None
    assert extract_rgw_account_tenant_optional({"tenant": None}) == ""
    assert extract_rgw_account_tenant_optional(
        {"account": {"id": "RGW001", "tenant": " research "}}
    ) == "research"

    with pytest.raises(ValueError, match="conflicting account tenant identity"):
        extract_rgw_account_tenant_optional(
            {
                "tenant": "wrapper",
                "account": {"id": "RGW001", "tenant": "nested"},
            }
        )


def test_resolve_account_scope_with_account_id():
    account_id = "RGW12345678901234567"
    resolved_account_id, tenant = resolve_account_scope(account_id)
    assert resolved_account_id == account_id
    assert tenant is None
    assert is_rgw_account_id(account_id)


def test_resolve_account_scope_with_tenant_name():
    identifier = "env-admin"
    resolved_account_id, tenant = resolve_account_scope(identifier)
    assert resolved_account_id is None
    assert tenant == identifier
    assert not is_rgw_account_id(identifier)


@pytest.mark.parametrize("name", ["Research Account", "Équipe données", " account with spaces "])
def test_validate_rgw_account_name_accepts_ceph_supported_names(name):
    assert validate_rgw_account_name(name) == name


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("   ", "Account name is required"),
        ("tenant$account", r"must not contain '\$'"),
        ("tenant:account", "must not contain ':'"),
        ("invalid\ud800", "must be valid UTF-8"),
    ],
)
def test_validate_rgw_account_name_rejects_names_refused_by_ceph(name, message):
    with pytest.raises(ValueError, match=message):
        validate_rgw_account_name(name)


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"uid": " user ", "tenant": " tenant "}, ("user", "tenant")),
        ({"user": {"uid": "tenant$user"}}, ("user", "tenant")),
        ({"tenant": "", "user_id": "tenant$user"}, ("user", "tenant")),
        ({"user": {"uid": 12}, "uid": "fallback"}, ("fallback", None)),
        (None, (None, None)),
    ],
)
def test_extract_rgw_user_identity(payload, expected):
    assert extract_rgw_user_identity(payload) == expected


def test_extract_rgw_user_identity_rejects_empty_embedded_tenant():
    with pytest.raises(ValueError, match="invalid tenant-qualified"):
        extract_rgw_user_identity({"user_id": "$user"})


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {"uid": "alice", "user": {"uid": "bob"}},
            "conflicting user identity",
        ),
        (
            {"tenant": "tenant-a", "user": {"uid": "tenant-b$alice"}},
            "conflicting tenant identity",
        ),
    ],
)
def test_extract_rgw_user_identity_rejects_conflicting_fields(payload, message):
    with pytest.raises(ValueError, match=message):
        extract_rgw_user_identity(payload)


@pytest.mark.parametrize(
    ("entry", "expected"),
    [
        ("tenant-a$alice", ("alice", "tenant-a")),
        ({"user": "tenant-b$bob"}, ("bob", "tenant-b")),
        ({"uid": "carol", "tenant": "tenant-c"}, ("carol", "tenant-c")),
        ({"id": "legacy-id"}, (None, None)),
        (42, (None, None)),
    ],
)
def test_extract_rgw_user_listing_identity_uses_canonical_fields(entry, expected):
    assert extract_rgw_user_listing_identity(entry) == expected


def test_extract_rgw_user_listing_identity_rejects_conflicting_fields():
    with pytest.raises(ValueError, match="conflicting user identity"):
        extract_rgw_user_listing_identity({"user": "alice", "uid": "bob"})


def test_rgw_qualified_uid_rejects_conflicting_explicit_tenant():
    with pytest.raises(ValueError, match="tenant conflicts"):
        rgw_qualified_uid("tenant-a$user", "tenant-b")


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"user": {"uid": "nested"}, "uid": "root"}, {"uid": "nested"}),
        ({"uid": "root"}, {"uid": "root"}),
        ({"user": "invalid", "uid": "root"}, {"user": "invalid", "uid": "root"}),
        (None, {}),
    ],
)
def test_extract_rgw_user_payload(payload, expected):
    assert extract_rgw_user_payload(payload) == expected


def test_extract_rgw_user_values_preserve_nested_false_and_zero():
    payload = {
        "display_name": "top-level",
        "suspended": True,
        "max_buckets": 99,
        "user": {
            "display_name": "nested",
            "suspended": False,
            "max_buckets": 0,
        },
    }

    assert extract_rgw_user_scalar(payload, "display_name") == "nested"
    assert extract_rgw_user_bool(payload, "suspended") is False
    assert extract_rgw_user_int(payload, "max_buckets") == 0


def test_extract_rgw_user_account_ids_preserves_conflicting_sources():
    assert extract_rgw_user_account_ids(
        {"account_id": " acc-top ", "user": {"account_id": "acc-nested"}}
    ) == {"acc-top", "acc-nested"}


def test_extract_rgw_user_account_aliases_collects_external_account_aliases():
    assert extract_rgw_user_account_aliases(
        {
            "account": " RGW00000000000000001 ",
            "user": {"account_id": "RGW00000000000000002"},
        }
    ) == {"RGW00000000000000001", "RGW00000000000000002"}


def test_extract_rgw_user_account_id_accepts_aliases_and_rejects_conflicts():
    assert extract_rgw_user_account_id(
        {"user": {"account": " RGW00000000000000001 "}}
    ) == "RGW00000000000000001"

    with pytest.raises(ValueError, match="conflicting user account identity"):
        extract_rgw_user_account_id(
            {
                "account_id": "RGW00000000000000001",
                "user": {"account": "RGW00000000000000002"},
            }
        )


def test_extract_rgw_user_caps_prefers_explicit_top_level_and_falls_back_to_nested():
    assert extract_rgw_user_caps({"caps": "", "user": {"caps": "users=read"}}) == ""
    assert extract_rgw_user_caps({"caps": None, "user": {"caps": ["users=read"]}}) == [
        "users=read"
    ]


def test_get_supervision_rgw_client_uses_endpoint_url_when_admin_feature_disabled(monkeypatch):
    captured: dict[str, object] = {}

    def fake_get_rgw_admin_client(access_key=None, secret_key=None, endpoint=None, region=None, verify_tls=True):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["endpoint"] = endpoint
        captured["region"] = region
        captured["verify_tls"] = verify_tls
        return "client"

    monkeypatch.setattr("app.services.rgw_supervision.get_rgw_admin_client", fake_get_rgw_admin_client)
    endpoint = StorageEndpoint(
        name="ceph",
        endpoint_url="https://rgw.example.test",
        provider=StorageProvider.CEPH.value,
        verify_tls=False,
        service_identities=[service_identity("supervision", "SUP-AK", "SUP-SK")],
        features=parse_features_config("features:\n  admin:\n    enabled: false\n"),
    )

    client = get_supervision_rgw_client(endpoint)
    assert client == "client"
    assert captured["access_key"] == "SUP-AK"
    assert captured["secret_key"] == "SUP-SK"
    assert captured["endpoint"] == "https://rgw.example.test"
    assert captured["verify_tls"] is False


def test_get_endpoint_admin_rgw_client_uses_canonical_endpoint_fields(monkeypatch):
    captured: dict[str, object] = {}

    def fake_get_rgw_admin_client(**kwargs):
        captured.update(kwargs)
        return "client"

    monkeypatch.setattr(
        "app.services.rgw_endpoint_clients.get_rgw_admin_client",
        fake_get_rgw_admin_client,
    )
    endpoint = StorageEndpoint(
        name="ceph",
        endpoint_url="https://rgw.example.test",
        provider=StorageProvider.CEPH.value,
        region="eu-west-1",
        verify_tls=False,
        admin_access_key="ADMIN-AK",
        admin_secret_key="ADMIN-SK",
        features=parse_features_config("features:\n"
            "  admin:\n"
            "    enabled: true\n"
            "    endpoint: https://admin.example.test/\n"),
    )

    client = get_endpoint_admin_rgw_client(endpoint)

    assert client == "client"
    assert captured == {
        "access_key": "ADMIN-AK",
        "secret_key": "ADMIN-SK",
        "endpoint": "https://admin.example.test",
        "region": "eu-west-1",
        "verify_tls": False,
    }


def test_get_endpoint_admin_rgw_client_accepts_explicit_identity_credentials(monkeypatch):
    captured: dict[str, object] = {}

    def fake_get_rgw_admin_client(**kwargs):
        captured.update(kwargs)
        return "client"

    monkeypatch.setattr(
        "app.services.rgw_endpoint_clients.get_rgw_admin_client",
        fake_get_rgw_admin_client,
    )
    endpoint = StorageEndpoint(
        name="ceph",
        endpoint_url="https://rgw.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="ADMIN-AK",
        admin_secret_key="ADMIN-SK",
        features=parse_features_config("features:\n  admin:\n    enabled: true\n"),
    )

    client = get_endpoint_admin_rgw_client(
        endpoint,
        access_key="ROTATING-AK",
        secret_key="ROTATING-SK",
    )

    assert client == "client"
    assert captured["access_key"] == "ROTATING-AK"
    assert captured["secret_key"] == "ROTATING-SK"
