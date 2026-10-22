# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime, timezone

import pytest

from app.models.portal_storage_spaces import PortalStorageSpaceSummary
from app.services.portal.server_access_log_records import parse_standard_access_log_line


LOG_OBJECT_KEY = "portal-server-access/research-data/2026-07-08-10-30-00.log"
SPACE = PortalStorageSpaceSummary(id="space-1", name="Research Data", role="Manager")
SPACE_BY_BUCKET = {"research-data": SPACE}


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
