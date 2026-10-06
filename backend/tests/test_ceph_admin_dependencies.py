# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.db import StorageProvider
from app.routers.ceph_admin import dependencies as deps
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_admin_identity import classify_rgw_credential_failure


def test_rgw_credential_failure_classification_uses_structured_error_metadata():
    assert (
        classify_rgw_credential_failure(
            RGWAdminError("neutral upstream failure", status_code=403)
        )
        == "denied"
    )
    assert (
        classify_rgw_credential_failure(
            RGWAdminError("neutral upstream failure", error_code="SignatureDoesNotMatch")
        )
        == "denied"
    )
    assert classify_rgw_credential_failure(RGWAdminError("403 AccessDenied")) == "unavailable"
    assert (
        classify_rgw_credential_failure(
            RGWAdminError(
                "redirect rejected",
                status_code=301,
                error_code="RedirectNotAllowed",
            )
        )
        == "misconfigured"
    )


def test_probe_ceph_admin_service_identity_classifies_unavailable(monkeypatch):
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings_for_db_readonly", lambda db: SimpleNamespace(general=SimpleNamespace(ceph_admin_enabled=True)))
    endpoint = SimpleNamespace(
        ceph_admin_allowed=True,
        service_identity=lambda kind: SimpleNamespace(
            mode="managed", status="ready", access_key="AKIA-ADMIN", secret_key="SECRET-ADMIN"
        ),
        id=1,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH,
        region=None,
        verify_tls=True,
        features_config="""
features:
  admin:
    enabled: true
    endpoint: https://rgw-admin.example.test
""",
        endpoint_url="https://s3.example.test",
    )

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
            raise RGWAdminError("connect timeout")

    monkeypatch.setattr(deps, "get_rgw_admin_client", lambda **kwargs: FakeRGWClient())

    probe = deps.probe_ceph_admin_service_identity(endpoint)

    assert probe.status == "unavailable"
    assert probe.warning is not None
    assert "did not respond" in probe.warning
    assert "connect timeout" not in probe.warning


def test_probe_ceph_admin_service_identity_classifies_denied(monkeypatch):
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings_for_db_readonly", lambda db: SimpleNamespace(general=SimpleNamespace(ceph_admin_enabled=True)))
    endpoint = SimpleNamespace(
        ceph_admin_allowed=True,
        service_identity=lambda kind: SimpleNamespace(
            mode="managed", status="ready", access_key="AKIA-ADMIN", secret_key="SECRET-ADMIN"
        ),
        id=2,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH,
        region=None,
        verify_tls=True,
        features_config="features:\n  admin:\n    endpoint: https://rgw-admin.example.test\n",
        endpoint_url="https://s3.example.test",
    )

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
            raise RGWAdminError(
                "RGW admin request was denied",
                status_code=403,
                error_code="AccessDenied",
            )

    monkeypatch.setattr(deps, "get_rgw_admin_client", lambda **kwargs: FakeRGWClient())

    probe = deps.probe_ceph_admin_service_identity(endpoint)

    assert probe.status == "denied"
    assert probe.warning == "Ceph Admin credentials were denied for endpoint 'Ceph endpoint'."


def test_probe_ceph_admin_service_identity_classifies_redirect_as_misconfigured(monkeypatch):
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings_for_db_readonly", lambda db: SimpleNamespace(general=SimpleNamespace(ceph_admin_enabled=True)))
    endpoint = SimpleNamespace(
        ceph_admin_allowed=True,
        service_identity=lambda kind: SimpleNamespace(
            mode="managed", status="ready", access_key="AKIA-ADMIN", secret_key="SECRET-ADMIN"
        ),
        id=3,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH,
        region=None,
        verify_tls=True,
        features_config="features:\n  admin:\n    endpoint: http://rgw-admin.example.test\n",
        endpoint_url="http://s3.example.test",
    )
    message = (
        "RGW Admin Ops endpoint redirects from HTTP to HTTPS. Configure the HTTPS "
        "endpoint directly; signed Admin Ops requests cannot use redirects."
    )

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
            raise RGWAdminError(
                message,
                status_code=301,
                error_code="RedirectNotAllowed",
            )

    monkeypatch.setattr(deps, "get_rgw_admin_client", lambda **kwargs: FakeRGWClient())

    probe = deps.probe_ceph_admin_service_identity(endpoint)

    assert probe.status == "misconfigured"
    assert probe.warning == message


def test_validate_ceph_admin_service_identity_allows_admin_user_when_admin_feature_disabled(monkeypatch):
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings_for_db_readonly", lambda db: SimpleNamespace(general=SimpleNamespace(ceph_admin_enabled=True)))
    endpoint = SimpleNamespace(
        ceph_admin_allowed=True,
        service_identity=lambda kind: SimpleNamespace(
            mode="managed", status="ready", access_key="AKIA-ADMIN", secret_key="SECRET-ADMIN"
        ),
        id=2,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH,
        features_config="""
features:
  admin:
    enabled: false
""",
        endpoint_url="https://s3.example.test",
        region="us-east-1",
        verify_tls=True,
    )

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
            return {"admin": True}

    monkeypatch.setattr(deps, "get_rgw_admin_client", lambda **kwargs: FakeRGWClient())

    detail = deps.validate_ceph_admin_service_identity(endpoint)

    assert detail is None


class _FakeQuery:
    def __init__(self, endpoint):
        self._endpoint = endpoint

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._endpoint


class _FakeSession:
    def __init__(self, endpoint):
        self._endpoint = endpoint

    def query(self, _model):
        return _FakeQuery(self._endpoint)


def test_resolve_ceph_admin_workspace_endpoint_does_not_require_admin_feature_enabled(monkeypatch):
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings_for_db_readonly", lambda db: SimpleNamespace(general=SimpleNamespace(ceph_admin_enabled=True)))
    endpoint = SimpleNamespace(
        ceph_admin_allowed=True,
        service_identity=lambda kind: SimpleNamespace(
            mode="managed", status="ready", access_key="CEPH-AK", secret_key="CEPH-SK"
        ),
        id=9,
        name="Ceph",
        provider=StorageProvider.CEPH.value,
        features_config="""
features:
  admin:
    enabled: false
""",
    )

    resolved = deps._resolve_ceph_admin_workspace_endpoint(_FakeSession(endpoint), endpoint_id=9)
    assert resolved is endpoint


def test_get_ceph_admin_context_uses_rgw_admin_endpoint_when_admin_feature_disabled(monkeypatch):
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings_for_db_readonly", lambda db: SimpleNamespace(general=SimpleNamespace(ceph_admin_enabled=True)))
    endpoint = SimpleNamespace(
        ceph_admin_allowed=True,
        service_identity=lambda kind: SimpleNamespace(
            mode="managed", status="ready", access_key="AKIA-ADMIN", secret_key="SECRET-ADMIN"
        ),
        id=10,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH.value,
        features_config="""
features:
  admin:
    enabled: false
    endpoint: https://rgw-admin.example.test
""",
        endpoint_url="https://s3.example.test",
        region="us-east-1",
        verify_tls=True,
    )

    captured: list[str] = []

    class FakeRGWClient:
        def __init__(self, endpoint_url: str):
            self.endpoint = endpoint_url

        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
            return {"admin": True}

    def fake_get_rgw_admin_client(**kwargs):
        captured.append(kwargs["endpoint"])
        return FakeRGWClient(kwargs["endpoint"])

    monkeypatch.setattr(deps, "get_rgw_admin_client", fake_get_rgw_admin_client)

    ctx = deps.get_ceph_admin_context(endpoint_id=10, db=_FakeSession(endpoint), _=SimpleNamespace())

    assert ctx.endpoint is endpoint
    assert ctx.s3_endpoint == "https://s3.example.test"
    assert ctx.rgw_admin.endpoint == "https://rgw-admin.example.test"
    assert captured == ["https://rgw-admin.example.test"]


def test_build_ceph_admin_endpoint_payload_exposes_admin_endpoint_when_admin_feature_disabled(monkeypatch):
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings_for_db_readonly", lambda db: SimpleNamespace(general=SimpleNamespace(ceph_admin_enabled=True)))
    endpoint = SimpleNamespace(
        ceph_admin_allowed=True,
        service_identity=lambda kind: SimpleNamespace(mode="managed", status="ready"),
        id=11,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH.value,
        features_config="""
features:
  admin:
    enabled: false
    endpoint: https://rgw-admin.example.test
""",
        endpoint_url="https://s3.example.test",
        region="us-east-1",
        is_default=False,
    )

    payload = deps.build_ceph_admin_endpoint_payload(endpoint)

    assert payload["admin_endpoint"] == "https://rgw-admin.example.test"
