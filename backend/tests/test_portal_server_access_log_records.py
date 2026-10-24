# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime, timezone

import pytest

from app.models.portal_access_logs import (
    PortalServerAccessLogEntry,
    PortalServerAccessLogFilterQuery,
    PortalServerAccessLogFilterRule,
    PortalServerAccessRequesterIdentity,
)
from app.services.portal.server_access_log_records import (
    apply_server_access_log_filter,
    parse_standard_access_log_line,
)
from tests.portal_storage_space_factory import portal_storage_space_summary


LOG_OBJECT_KEY = "portal-server-access/research-data/2026-07-08-10-30-00.log"
SPACE = portal_storage_space_summary(id="space-1", name="Research Data", role="Manager")
SPACE_BY_BUCKET = {"research-data": SPACE}


@pytest.mark.parametrize(
    "model",
    [PortalServerAccessRequesterIdentity, PortalServerAccessLogEntry],
)
def test_portal_server_access_read_models_require_complete_payloads(model):
    schema = model.model_json_schema()
    assert set(schema["required"]) == set(schema["properties"])


def test_parse_standard_access_log_line_extracts_record_fields():
    line = (
        'owner research-data [08/Jul/2026:10:30:00 +0000] '
        '10.0.0.5 external req-1 REST.PUT.OBJECT reports/external.csv '
        '"PUT /research-data/reports/external.csv HTTP/1.1" '
        '200 - 512 1024 - 3 - "aws-cli/2" - - SigV4 TLS_AES AuthHeader '
        's3.example TLSv1.3 - -'
    )

    entry = parse_standard_access_log_line(
        line,
        log_object_key=LOG_OBJECT_KEY,
        space_by_bucket=SPACE_BY_BUCKET,
    )

    assert entry is not None
    assert entry.timestamp == datetime(2026, 7, 8, 10, 30, tzinfo=timezone.utc)
    assert entry.storage_space_id == "space-1"
    assert entry.storage_space_name == "Research Data"
    assert entry.bucket_name == "research-data"
    assert entry.operation == "REST.PUT.OBJECT"
    assert entry.operation_category == "upload"
    assert entry.object_key == "reports/external.csv"
    assert entry.object_name == "external.csv"
    assert entry.direction == "Upload"
    assert entry.status_code == 200
    assert entry.error_code is None
    assert entry.bytes_sent == 512
    assert entry.object_size == 1024
    assert entry.requester == "external"
    assert entry.client_ip == "10.0.0.5"
    assert entry.auth_type == "AuthHeader"
    assert entry.request_id == "req-1"
    assert entry.request_uri == "PUT /research-data/reports/external.csv HTTP/1.1"
    assert entry.user_agent == "aws-cli/2"
    assert entry.log_object_key == LOG_OBJECT_KEY


def test_parse_standard_access_log_line_joins_and_decodes_object_tokens():
    line = (
        'owner research-data [08/Jul/2026:10:40:00 +0000] '
        '10.0.0.7 external req-3 REST.POST.OBJECT captures '
        'bucketreef%2Fmaquette%2Fmanager%20dashboard.png '
        '"POST /research-data HTTP/1.1" 204 - 1254754 1252241'
    )

    entry = parse_standard_access_log_line(
        line,
        log_object_key=LOG_OBJECT_KEY,
        space_by_bucket=SPACE_BY_BUCKET,
    )

    assert entry is not None
    assert entry.object_key == "captures/bucketreef/maquette/manager dashboard.png"
    assert entry.object_name == "manager dashboard.png"
    assert entry.status_code == 204
    assert entry.user_agent is None
    assert entry.auth_type is None


@pytest.mark.parametrize(
    "line",
    [
        'owner other-bucket [08/Jul/2026:10:30:00 +0000] 10.0.0.5 external req-1 REST.GET.OBJECT file.txt "GET /file.txt HTTP/1.1" 200',
        'owner research-data [invalid timestamp] 10.0.0.5 external req-1 REST.GET.OBJECT file.txt "GET /file.txt HTTP/1.1" 200',
        'owner research-data [08/Jul/2026:10:30:00 +0000] 10.0.0.5 external req-1 "unterminated',
        'owner research-data [08/Jul/2026:10:30:00 +0000] 10.0.0.5 external req-1 GET file.txt "GET /file.txt HTTP/1.1" 200',
    ],
)
def test_parse_standard_access_log_line_rejects_unusable_records(line):
    assert (
        parse_standard_access_log_line(
            line,
            log_object_key=LOG_OBJECT_KEY,
            space_by_bucket=SPACE_BY_BUCKET,
        )
        is None
    )


def _filter_entry() -> PortalServerAccessLogEntry:
    return PortalServerAccessLogEntry(
        id="server-log-test",
        source="server_access_logging",
        timestamp=datetime(2026, 7, 8, 10, 30, tzinfo=timezone.utc),
        storage_space_id="space-1",
        storage_space_name="Research Data",
        bucket_name="research-data",
        operation="REST.PUT.OBJECT",
        operation_category="upload",
        object_key="reports/external.csv",
        object_name="external.csv",
        direction="Upload",
        status_code=200,
        error_code=None,
        bytes_sent=None,
        object_size=None,
        requester="external",
        requester_identity=None,
        client_ip=None,
        auth_type=None,
        request_id=None,
        request_uri="PUT /research-data/reports/external.csv HTTP/1.1",
        user_agent=None,
        log_object_key=LOG_OBJECT_KEY,
    )


@pytest.mark.parametrize(
    ("field", "op", "value", "matched"),
    [
        ("path", "contains", "external", True),
        ("path", "starts_with", "reports", True),
        ("path", "ends_with", ".csv", True),
        ("action", "eq", "upload", True),
        ("action", "neq", "download", True),
        ("space", "in", ["other", "research data"], True),
        ("space", "not_in", ["other"], True),
        ("result", "eq", "success", True),
        ("path", "eq", "missing.txt", False),
        ("path", "neq", "reports/external.csv", False),
    ],
)
def test_apply_server_access_log_filter_supports_text_operators(
    field,
    op,
    value,
    matched,
):
    entry = _filter_entry()
    query = PortalServerAccessLogFilterQuery(
        rules=[PortalServerAccessLogFilterRule(field=field, op=op, value=value)]
    )

    assert apply_server_access_log_filter([entry], query) == ([entry] if matched else [])


@pytest.mark.parametrize(
    ("op", "matched"),
    [("is_null", True), ("not_null", False)],
)
def test_apply_server_access_log_filter_supports_null_identity_checks(op, matched):
    entry = _filter_entry()
    entry.requester = None
    query = PortalServerAccessLogFilterQuery(
        rules=[PortalServerAccessLogFilterRule(field="identity", op=op)]
    )

    assert apply_server_access_log_filter([entry], query) == ([entry] if matched else [])


@pytest.mark.parametrize(
    "value",
    [
        "Portal User",
        "portal_user",
        "Project member",
        "AKIAEXAMPLE",
        "portal-user-1",
        42,
        "user@example.com",
    ],
)
def test_apply_server_access_log_filter_matches_resolved_identity_fields(value):
    entry = _filter_entry()
    entry.requester = None
    entry.requester_identity = PortalServerAccessRequesterIdentity(
        label="Portal User",
        kind="portal_user",
        detail="Project member",
        access_key_id="AKIAEXAMPLE",
        iam_username="portal-user-1",
        user_id=42,
        email="user@example.com",
        resolved=True,
    )
    query = PortalServerAccessLogFilterQuery(
        rules=[PortalServerAccessLogFilterRule(field="identity", op="eq", value=value)]
    )

    assert apply_server_access_log_filter([entry], query) == [entry]


@pytest.mark.parametrize("value", ["failure", "AccessDenied", 403])
def test_apply_server_access_log_filter_matches_failure_result_fields(value):
    entry = _filter_entry()
    entry.status_code = 403
    entry.error_code = "AccessDenied"
    query = PortalServerAccessLogFilterQuery(
        rules=[PortalServerAccessLogFilterRule(field="result", op="eq", value=value)]
    )

    assert apply_server_access_log_filter([entry], query) == [entry]


def test_apply_server_access_log_filter_honors_any_and_all_rule_modes():
    entry = _filter_entry()
    rules = [
        PortalServerAccessLogFilterRule(field="action", op="eq", value="download"),
        PortalServerAccessLogFilterRule(field="space", op="contains", value="research"),
    ]

    assert apply_server_access_log_filter(
        [entry], PortalServerAccessLogFilterQuery(match="any", rules=rules)
    ) == [entry]
    assert apply_server_access_log_filter(
        [entry], PortalServerAccessLogFilterQuery(match="all", rules=rules)
    ) == []
