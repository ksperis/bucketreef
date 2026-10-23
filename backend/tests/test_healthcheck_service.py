# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import requests
from datetime import timedelta

from sqlalchemy import select

from app.db import (
    EndpointHealthCheck,
    EndpointHealthLatest,
    EndpointHealthRollup,
    EndpointHealthStatusSegment,
    HealthCheckStatus,
    StorageEndpoint,
    StorageProvider,
)
from app.services import healthcheck_persistence_service, healthcheck_query_service, healthcheck_service
from app.services.healthcheck_common import (
    DEFAULT_CHECK_TYPE,
    DEFAULT_ROLLUP_RESOLUTION_SECONDS,
    DEFAULT_SCOPE,
    EndpointCheckTarget,
    HealthCheckProfile,
    HealthWindow,
)
from app.services.healthcheck_persistence_service import HealthCheckPersistenceService
from app.services.healthcheck_query_service import HealthCheckQueryService
from app.services.healthcheck_service import HealthCheckService
from app.utils.time import utcnow


def _build_target(*, verify_tls: bool, force_path_style: bool = False) -> EndpointCheckTarget:
    return EndpointCheckTarget(
        endpoint_id=1,
        name="endpoint-1",
        endpoint_url="https://endpoint.example.test",
        force_path_style=force_path_style,
        verify_tls=verify_tls,
        region="us-east-1",
        supervision_access_key="AKIA-TEST",
        supervision_secret_key="SECRET-TEST",
        admin_access_key=None,
        admin_secret_key=None,
    )


def _seed_endpoint(db_session, *, name: str, endpoint_url: str, is_default: bool) -> None:
    db_session.add(
        StorageEndpoint(
            name=name,
            endpoint_url=endpoint_url,
            provider=StorageProvider.CEPH.value,
            is_default=is_default,
            is_editable=True,
        )
    )


def test_healthcheck_target_uses_canonical_persisted_endpoint_fields(db_session):
    _seed_endpoint(
        db_session,
        name="Canonical target",
        endpoint_url="https://canonical.example.test",
        is_default=True,
    )
    db_session.commit()
    endpoint = db_session.scalars(select(StorageEndpoint).where(StorageEndpoint.name == "Canonical target")).one()

    target = HealthCheckService._to_check_target(endpoint)

    assert target.endpoint_url == endpoint.endpoint_url
    assert target.force_path_style is endpoint.force_path_style
    assert target.verify_tls is endpoint.verify_tls


def test_http_healthcheck_honors_endpoint_insecure_tls(monkeypatch):
    service = HealthCheckService(db=None)
    target = _build_target(verify_tls=False)
    profile = HealthCheckProfile(mode="http", target_url="https://selfsigned.example.test")

    monkeypatch.setattr(healthcheck_service.settings, "healthcheck_verify_ssl", True)

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

    def fake_get(url: str, **kwargs):
        captured["verify"] = kwargs.get("verify")
        captured["allow_redirects"] = kwargs.get("allow_redirects")
        if kwargs.get("verify"):
            raise requests.exceptions.SSLError("SSLCertVerificationError")
        return FakeResponse()

    monkeypatch.setattr(healthcheck_service.requests, "get", fake_get)

    result = service._check_endpoint(target, profile=profile, baseline_latency_ms=None)

    assert captured["verify"] is False
    assert captured["allow_redirects"] is False
    assert result.status == HealthCheckStatus.UP
    assert result.error_message is None


def test_s3_healthcheck_honors_endpoint_insecure_tls(monkeypatch):
    service = HealthCheckService(db=None)
    target = _build_target(verify_tls=False)
    profile = HealthCheckProfile(mode="s3", target_url="https://selfsigned.example.test")

    monkeypatch.setattr(healthcheck_service.settings, "healthcheck_verify_ssl", True)

    captured: dict[str, object] = {}

    class FakeS3Client:
        @staticmethod
        def list_buckets():
            return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def fake_get_s3_client(**kwargs):
        captured["verify_tls"] = kwargs.get("verify_tls")
        return FakeS3Client()

    monkeypatch.setattr(healthcheck_service, "get_s3_client", fake_get_s3_client)

    result = service._check_endpoint(target, profile=profile, baseline_latency_ms=None)

    assert captured["verify_tls"] is False
    assert result.status == HealthCheckStatus.UP
    assert result.error_message is None


def test_s3_healthcheck_honors_endpoint_force_path_style(monkeypatch):
    service = HealthCheckService(db=None)
    target = _build_target(verify_tls=True, force_path_style=True)
    profile = HealthCheckProfile(mode="s3", target_url="https://path-style.example.test")

    captured: dict[str, object] = {}

    class FakeS3Client:
        @staticmethod
        def list_buckets():
            return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def fake_get_s3_client(**kwargs):
        captured["force_path_style"] = kwargs.get("force_path_style")
        return FakeS3Client()

    monkeypatch.setattr(healthcheck_service, "get_s3_client", fake_get_s3_client)

    result = service._check_endpoint(target, profile=profile, baseline_latency_ms=None)

    assert captured["force_path_style"] is True
    assert result.status == HealthCheckStatus.UP
    assert result.error_message is None


def test_healthcheck_endpoint_lists_are_sorted_by_name_case_insensitive(db_session):
    _seed_endpoint(db_session, name="Zulu", endpoint_url="https://zulu.example.test", is_default=True)
    _seed_endpoint(db_session, name="alpha", endpoint_url="https://alpha.example.test", is_default=False)
    _seed_endpoint(db_session, name="Beta", endpoint_url="https://beta.example.test", is_default=False)
    db_session.commit()

    service = HealthCheckQueryService(db_session)
    expected = ["alpha", "Beta", "Zulu"]

    summary_names = [entry["name"] for entry in service.build_summary()["endpoints"]]
    overview_names = [entry["name"] for entry in service.build_overview(HealthWindow.WEEK)["endpoints"]]
    latency_names = [entry["name"] for entry in service.build_latency_overview(HealthWindow.DAY)["endpoints"]]
    workspace_names = [entry["name"] for entry in service.build_workspace_health_overview()["endpoints"]]

    assert summary_names == expected
    assert overview_names == expected
    assert latency_names == expected
    assert workspace_names == expected


def test_workspace_health_overview_uses_requested_incident_window(db_session):
    service = HealthCheckQueryService(db_session)

    payload = service.build_workspace_health_overview(incident_highlight_minutes=7 * 24 * 60)

    assert payload["incident_highlight_minutes"] == 10080


def test_workspace_health_overview_uses_configured_interval_for_stale_counts(db_session, monkeypatch):
    _seed_endpoint(
        db_session,
        name="Stale endpoint",
        endpoint_url="https://stale.example.test",
        is_default=True,
    )
    db_session.flush()
    endpoint = db_session.scalars(select(StorageEndpoint).where(StorageEndpoint.name == "Stale endpoint")).one()
    db_session.add(
        EndpointHealthLatest(
            storage_endpoint_id=endpoint.id,
            checked_at=utcnow() - timedelta(seconds=61),
            check_mode="http",
            check_type="availability",
            scope="endpoint",
            status=HealthCheckStatus.UP.value,
        )
    )
    db_session.commit()
    monkeypatch.setattr(healthcheck_query_service.settings, "healthcheck_interval_seconds", 30)

    payload = HealthCheckQueryService(db_session).build_workspace_health_overview()

    assert payload["stale_after_seconds"] == 60
    assert payload["endpoints"][0]["is_stale"] is True
    assert payload["up_count"] == 0
    assert payload["unknown_count"] == 1


def test_workspace_health_overview_projects_ongoing_and_recent_incidents(db_session):
    _seed_endpoint(
        db_session,
        name="Incident endpoint",
        endpoint_url="https://incident.example.test",
        is_default=True,
    )
    db_session.flush()
    endpoint = db_session.scalars(
        select(StorageEndpoint).where(StorageEndpoint.name == "Incident endpoint")
    ).one()
    now = utcnow()
    db_session.add_all(
        [
            EndpointHealthStatusSegment(
                storage_endpoint_id=endpoint.id,
                check_mode="http",
                check_type="availability",
                scope="endpoint",
                status=HealthCheckStatus.DOWN.value,
                started_at=now - timedelta(minutes=10),
                ended_at=None,
            ),
            EndpointHealthStatusSegment(
                storage_endpoint_id=endpoint.id,
                check_mode="s3",
                check_type="availability",
                scope="endpoint",
                status=HealthCheckStatus.DEGRADED.value,
                started_at=now - timedelta(minutes=20),
                ended_at=now - timedelta(minutes=5),
            ),
        ]
    )
    db_session.commit()

    payload = HealthCheckQueryService(db_session).build_workspace_health_overview(
        incident_highlight_minutes=60
    )

    assert [incident["status"] for incident in payload["incidents"]] == [
        HealthCheckStatus.DOWN.value,
        HealthCheckStatus.DEGRADED.value,
    ]
    assert payload["incidents"][0]["ongoing"] is True
    assert payload["incidents"][0]["recent"] is False
    assert payload["incidents"][1]["ongoing"] is False
    assert payload["incidents"][1]["recent"] is True
    assert payload["incidents"][1]["duration_minutes"] == 15


def test_healthcheck_history_pruning_keeps_recent_and_active_rows(db_session, monkeypatch):
    _seed_endpoint(
        db_session,
        name="Retention endpoint",
        endpoint_url="https://retention.example.test",
        is_default=True,
    )
    db_session.flush()
    endpoint = db_session.scalars(
        select(StorageEndpoint).where(StorageEndpoint.name == "Retention endpoint")
    ).one()
    now = utcnow()
    old = now - timedelta(days=31)
    recent = now - timedelta(days=1)
    db_session.add_all(
        [
            EndpointHealthCheck(
                storage_endpoint_id=endpoint.id,
                checked_at=old,
                check_mode="http",
                status=HealthCheckStatus.UP.value,
            ),
            EndpointHealthCheck(
                storage_endpoint_id=endpoint.id,
                checked_at=recent,
                check_mode="http",
                status=HealthCheckStatus.UP.value,
            ),
            EndpointHealthRollup(
                storage_endpoint_id=endpoint.id,
                check_mode="http",
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
                resolution_seconds=DEFAULT_ROLLUP_RESOLUTION_SECONDS,
                bucket_start=old,
            ),
            EndpointHealthRollup(
                storage_endpoint_id=endpoint.id,
                check_mode="http",
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
                resolution_seconds=DEFAULT_ROLLUP_RESOLUTION_SECONDS,
                bucket_start=recent,
            ),
            EndpointHealthStatusSegment(
                storage_endpoint_id=endpoint.id,
                check_mode="http",
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
                status=HealthCheckStatus.UP.value,
                started_at=old - timedelta(hours=1),
                ended_at=old,
            ),
            EndpointHealthStatusSegment(
                storage_endpoint_id=endpoint.id,
                check_mode="http",
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
                status=HealthCheckStatus.UP.value,
                started_at=old,
                ended_at=None,
            ),
            EndpointHealthStatusSegment(
                storage_endpoint_id=endpoint.id,
                check_mode="http",
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
                status=HealthCheckStatus.UP.value,
                started_at=recent - timedelta(hours=1),
                ended_at=recent,
            ),
        ]
    )
    db_session.commit()
    monkeypatch.setattr(
        healthcheck_persistence_service.settings,
        "healthcheck_retention_days",
        30,
    )

    HealthCheckPersistenceService(db_session)._prune_history()

    raw_rows = db_session.scalars(select(EndpointHealthCheck)).all()
    rollup_rows = db_session.scalars(select(EndpointHealthRollup)).all()
    segment_rows = db_session.scalars(select(EndpointHealthStatusSegment)).all()
    assert [row.checked_at for row in raw_rows] == [recent]
    assert [row.bucket_start for row in rollup_rows] == [recent]
    assert sorted(row.ended_at for row in segment_rows if row.ended_at is not None) == [recent]
    assert sum(row.ended_at is None for row in segment_rows) == 1
