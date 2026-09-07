# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from itertools import product
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError

from app.db import S3Account, S3Connection, StorageEndpoint
from app.models.portal_access_logs import PortalServerAccessLogEntry
from app.models.storage_endpoint import StorageEndpointCreate
from app.services import connection_identity_service, healthcheck_service
from app.services.connection_identity_service import ConnectionIdentityService, reset_connection_identity_cache_for_tests
from app.services.endpoint_read_credentials import resolve_endpoint_read_credentials
from app.services.healthcheck_service import HealthCheckService
from app.services.portal import server_access_log_queries
from app.services.portal.server_access_log_queries import PortalServerAccessLogQueriesMixin
from app.services.portal_service import PortalService
from app.services.rgw_admin import RGWAdminError
from app.services.storage_endpoint_normalization import normalize_storage_endpoint_state
from app.utils.time import utcnow
from tests.s3_account_factory import make_s3_account


@pytest.fixture(autouse=True)
def clean_identity_cache():
    reset_connection_identity_cache_for_tests()
    yield
    reset_connection_identity_cache_for_tests()


def _endpoint(present):
    supervision_access, supervision_secret, admin_access, admin_secret = present
    return StorageEndpoint(
        id=17,
        name="credential-pair-endpoint",
        endpoint_url="https://s3.example.test",
        provider="ceph",
        region="test-region",
        verify_tls=False,
        force_path_style=True,
        features_config="features:\n  admin:\n    enabled: true\n",
        supervision_access_key="SUPERVISION-AK" if supervision_access else None,
        supervision_secret_key="SUPERVISION-SK" if supervision_secret else None,
        admin_access_key="ADMIN-AK" if admin_access else None,
        admin_secret_key="ADMIN-SK" if admin_secret else None,
    )


def _connection(endpoint):
    return S3Connection(
        id=42,
        name="lookup-connection",
        created_by_user_id=1,
        access_key_id="CONNECTION-AK",
        secret_access_key="CONNECTION-SK",
        storage_endpoint_id=endpoint.id,
        storage_endpoint=endpoint,
    )


@pytest.mark.parametrize("consumer", ["identity", "healthcheck", "portal"])
@pytest.mark.parametrize("present", list(product([False, True], repeat=4)))
def test_readers_select_one_complete_credential_pair(monkeypatch, consumer, present):
    endpoint = _endpoint(present)
    calls = []

    def client(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            get_user_by_access_key=lambda *args, **kwargs: {"uid": "lookup-user"},
            list_buckets=lambda: {"ResponseMetadata": {"HTTPStatusCode": 200}},
        )

    if consumer == "identity":
        monkeypatch.setattr(connection_identity_service, "get_rgw_admin_client", client)
        result = ConnectionIdentityService().resolve_rgw_identity(_connection(endpoint))
        available = result.eligible
    elif consumer == "healthcheck":
        monkeypatch.setattr(healthcheck_service, "get_s3_client", client)
        monkeypatch.setattr(healthcheck_service.settings, "healthcheck_verify_ssl", True)
        target = HealthCheckService._to_check_target(endpoint)
        result = HealthCheckService(db=None)._s3_probe(target, endpoint.endpoint_url)
        available = result == (200, None)
    else:
        monkeypatch.setattr(server_access_log_queries, "get_rgw_admin_client", client)
        account = S3Account(name="portal-account", storage_endpoint=endpoint)
        result = PortalServerAccessLogQueriesMixin()._portal_server_access_rgw_admin_client(account)
        available = result is not None

    if present[0] and present[1]:
        expected = ("SUPERVISION-AK", "SUPERVISION-SK")
    elif present[2] and present[3]:
        expected = ("ADMIN-AK", "ADMIN-SK")
    else:
        expected = None
    assert available is (expected is not None)
    if expected is None:
        assert calls == []
    else:
        assert len(calls) == 1
        assert (calls[0]["access_key"], calls[0]["secret_key"]) == expected
        assert calls[0]["endpoint"] == endpoint.endpoint_url
        assert calls[0]["region"] == endpoint.region
        assert calls[0]["verify_tls"] is False
        if consumer == "healthcheck":
            assert calls[0]["force_path_style"] is True


@pytest.mark.parametrize("consumer", ["identity", "healthcheck", "portal"])
@pytest.mark.parametrize("failure_stage", ["client", "request"])
def test_readers_do_not_retry_with_admin_after_supervision_denial(
    monkeypatch, db_session, consumer, failure_stage,
):
    endpoint = _endpoint((True, True, True, True))
    calls = []
    requests = []
    denial = (
        ClientError(
            {"Error": {"Code": "AccessDenied"}, "ResponseMetadata": {"HTTPStatusCode": 403}},
            "ListBuckets",
        )
        if consumer == "healthcheck"
        else RGWAdminError("AccessDenied")
    )

    def denied_request(*args, **kwargs):
        requests.append((args, kwargs))
        raise denial

    def client(**kwargs):
        calls.append(kwargs)
        if failure_stage == "client":
            raise denial
        return SimpleNamespace(
            get_user_by_access_key=denied_request,
            get_user=denied_request,
            list_buckets=denied_request,
        )

    if consumer == "identity":
        monkeypatch.setattr(connection_identity_service, "get_rgw_admin_client", client)
        result = ConnectionIdentityService().resolve_rgw_identity(_connection(endpoint))
        assert not result.eligible
        assert "AccessDenied" in result.reason
    elif consumer == "healthcheck":
        monkeypatch.setattr(healthcheck_service, "get_s3_client", client)
        target = HealthCheckService._to_check_target(endpoint)
        assert HealthCheckService(db_session)._s3_probe(target, endpoint.endpoint_url) == (403, None)
    else:
        monkeypatch.setattr(server_access_log_queries, "get_rgw_admin_client", client)
        account = make_s3_account(db_session, name="portal-read-denial", storage_endpoint=endpoint)
        db_session.add(account)
        db_session.flush()
        entry = PortalServerAccessLogEntry(
            id="log-entry",
            timestamp=utcnow(),
            bucket_name="team-space",
            operation="REST.GET.OBJECT",
            operation_category="download",
            requester="unknown-requester",
            log_object_key="access-log",
        )
        PortalService(db_session)._resolve_portal_server_access_requester_identities(account, [entry])
        assert entry.requester_identity.kind == "unknown"
        assert entry.requester_identity.resolved is False

    assert len(calls) == 1
    assert (calls[0]["access_key"], calls[0]["secret_key"]) == ("SUPERVISION-AK", "SUPERVISION-SK")
    assert len(requests) == (1 if failure_stage == "request" else 0)


@pytest.mark.parametrize("supervision", [(False, False), (True, False), (False, True)])
def test_metrics_still_require_complete_supervision_credentials(monkeypatch, supervision):
    endpoint = _endpoint((*supervision, True, True))
    endpoint.features_config = "features:\n  metrics:\n    enabled: true\n"

    def unexpected_client(**kwargs):
        pytest.fail("Metrics must not use administrator credentials")

    monkeypatch.setattr(connection_identity_service, "get_rgw_admin_client", unexpected_client)
    result = ConnectionIdentityService().resolve_metrics_identity(_connection(endpoint))

    assert result.metrics_enabled is True
    assert not result.eligible
    assert "supervision credentials are not configured" in result.reason


@pytest.mark.parametrize("supervision", [(True, False), (False, True)])
def test_accepted_endpoint_config_with_partial_supervision_uses_complete_admin_pair(supervision):
    endpoint = _endpoint((*supervision, True, True))
    config = normalize_storage_endpoint_state(StorageEndpointCreate(
        name=endpoint.name,
        endpoint_url=endpoint.endpoint_url,
        provider=endpoint.provider,
        admin_access_key=endpoint.admin_access_key,
        admin_secret_key=endpoint.admin_secret_key,
        supervision_access_key=endpoint.supervision_access_key,
        supervision_secret_key=endpoint.supervision_secret_key,
        features_config=endpoint.features_config,
    ))

    assert config.supervision_access_key == endpoint.supervision_access_key
    assert config.supervision_secret_key == endpoint.supervision_secret_key
    assert resolve_endpoint_read_credentials(config) == ("ADMIN-AK", "ADMIN-SK")


@pytest.mark.parametrize("access_key", ["", "  ", " SUPERVISION-AK "])
def test_read_credentials_normalize_access_key_without_altering_secret(access_key):
    endpoint = _endpoint((True, True, True, True))
    endpoint.supervision_access_key = access_key
    endpoint.supervision_secret_key = " secret with spaces "

    expected = ("SUPERVISION-AK", " secret with spaces ") if access_key.strip() else ("ADMIN-AK", "ADMIN-SK")
    assert resolve_endpoint_read_credentials(endpoint) == expected
