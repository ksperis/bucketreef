# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from io import BytesIO
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.manager_bucket_compare import ManagerBucketCompareActionRequest
from app.routers import dependencies
from app.routers.manager import buckets
from app.services.bucket_compare_remediation import remediate_bucket_content
from app.services.bucket_comparison_service import BucketComparisonService
from tests.execution_context_factory import make_s3_execution_context


EXACT_KEYS = [
    "report.txt", " report.txt ", " ", "\tline\n.txt", "café.txt", "cafe\u0301.txt",
    "dir/../report.txt", "dir//report.txt",
]


def _payload(keys, action="sync_source_only"):
    return {
        "target_context_id": "2", "source_bucket": "source-bucket",
        "target_bucket": "target-bucket", "action": action, "object_keys": keys,
    }


@pytest.mark.parametrize("action", ["sync_source_only", "sync_different", "delete_target_only"])
def test_remediation_request_preserves_exact_distinct_keys(action):
    request = ManagerBucketCompareActionRequest.model_validate(_payload(EXACT_KEYS, action))

    assert request.object_keys == EXACT_KEYS
    assert request.model_dump()["object_keys"] == EXACT_KEYS


@pytest.mark.parametrize("keys", [[], [""], ["one", "one"], [" ", " "], [None], [42]])
def test_remediation_request_rejects_empty_invalid_and_exact_duplicate_keys(keys):
    with pytest.raises(ValidationError):
        ManagerBucketCompareActionRequest.model_validate(_payload(keys))


@pytest.mark.parametrize("mode, action", [
    ("copy", "sync_source_only"), ("copy", "sync_different"),
    ("stream", "sync_source_only"), ("stream", "sync_different"),
    ("delete", "delete_target_only"),
])
@pytest.mark.parametrize("selected", [
    [" report.txt "],
    [" report.txt ", " ", "\tline\n.txt", "cafe\u0301.txt", "dir/../report.txt"],
], ids=["padded-key", "opaque-keys"])
def test_http_remediation_targets_only_selected_exact_keys(client, monkeypatch, mode, action, selected):
    source = make_s3_execution_context(context_id="1", can_manage_buckets=True)
    target = make_s3_execution_context(context_id="2", id=2, can_manage_buckets=True)
    unselected = {"report.txt": b"keep", "café.txt": b"keep composed", "line.txt": b"keep plain"}
    initial_target = {**unselected, **{key: b"old" for key in selected}}
    target_objects = dict(initial_target)
    source_objects = {**{key: b"unselected source" for key in unselected}, **{key: key.encode() for key in selected}}
    calls = []
    bodies = []

    class SourceClient:
        close = Mock()

        def get_object(self, *, Bucket, Key):
            assert Bucket == "source-bucket"
            calls.append(("get", Key))
            body = BytesIO(source_objects[Key])
            bodies.append(body)
            return {"Body": body}

    class TargetClient:
        close = Mock()

        def copy_object(self, *, Bucket, Key, CopySource):
            assert Bucket == "target-bucket"
            assert CopySource == {"Bucket": "source-bucket", "Key": Key}
            calls.append(("copy", Key))
            target_objects[Key] = source_objects[Key]

        def upload_fileobj(self, body, bucket_name, key):
            assert bucket_name == "target-bucket"
            calls.append(("upload", key))
            target_objects[key] = body.read()

        def delete_objects(self, *, Bucket, Delete):
            assert Bucket == "target-bucket"
            for item in Delete["Objects"]:
                calls.append(("delete", item["Key"]))
                target_objects.pop(item["Key"], None)
            return {"Deleted": Delete["Objects"]}

    source_client, target_client = SourceClient(), TargetClient()
    service = BucketComparisonService()
    monkeypatch.setattr(service, "_build_client", lambda account: source_client if account is source else target_client)
    monkeypatch.setattr(service, "_accounts_share_storage_endpoint", lambda *_args: mode != "stream")
    # Keep the HTTP model, action orchestration, and remediation real while
    # isolating authorization, remote storage, and audit persistence.
    app.dependency_overrides[dependencies.get_account_context] = lambda: source
    app.dependency_overrides[dependencies.require_manager_enabled] = lambda: None
    app.dependency_overrides[dependencies.require_bucket_compare_enabled] = lambda: None
    app.dependency_overrides[buckets.get_bucket_comparison_service] = lambda: service
    audit = Mock(spec=["record_action"])
    app.dependency_overrides[buckets.get_audit_service] = lambda: audit
    monkeypatch.setattr(buckets, "get_account_context", lambda **kwargs: target)

    response = client.post("/api/manager/buckets/compare/action", params={"account_id": "1"}, json=_payload(selected, action))

    assert response.status_code == 200, response.text
    assert response.json()["planned_count"] == len(selected)
    assert response.json()["succeeded_count"] == len(selected)
    assert response.json()["failed_count"] == 0
    expected_target = unselected if mode == "delete" else {**unselected, **{key: source_objects[key] for key in selected}}
    assert target_objects == expected_target
    assert {key for _operation, key in calls} == set(selected)
    assert all(body.closed for body in bodies)
    target_client.close.assert_called_once_with()
    assert source_client.close.call_count == int(mode != "delete")
    assert audit.record_action.call_args.kwargs["metadata"]["object_keys_sample"] == selected


@pytest.mark.parametrize("failed_key", EXACT_KEYS)
def test_delete_remediation_keeps_exact_failed_keys_and_counts(failed_key):
    client = Mock()
    client.delete_objects.return_value = {"Errors": [
        {"Key": failed_key, "Code": "AccessDenied"},
        {"Key": failed_key, "Code": "AccessDenied"},
    ]}

    result = remediate_bucket_content(
        source_client=None, target_client=client, source_bucket="source", target_bucket="target",
        action="delete_target_only", object_keys=EXACT_KEYS, same_endpoint=False,
    )

    assert result.succeeded_count == len(EXACT_KEYS) - 1
    assert result.failed_count == 1
    assert result.failed_keys_sample == [failed_key]
    client.delete_objects.assert_called_once_with(Bucket="target", Delete={"Objects": [{"Key": key} for key in EXACT_KEYS]})


@pytest.mark.parametrize("response", [
    None, [], {"Errors": None}, {"Errors": {}}, {"Errors": [None]},
    {"Errors": [{}]}, {"Errors": [{"Key": None}]}, {"Errors": [{"Key": 42}]},
    {"Errors": [{"Key": "report.txt"}]},
])
def test_delete_remediation_rejects_unattributable_error_responses(response):
    client = Mock()
    client.delete_objects.return_value = response

    with pytest.raises(RuntimeError, match="Invalid DeleteObjects response"):
        remediate_bucket_content(
            source_client=None, target_client=client, source_bucket="source", target_bucket="target",
            action="delete_target_only", object_keys=[" report.txt "], same_endpoint=False,
        )


def test_delete_remediation_counts_exact_failures_across_batches():
    keys = [f" key-{index} " for index in range(1003)]
    requested_batches = []
    expected_failures = []

    def delete_objects(*, Bucket, Delete):
        chunk = [item["Key"] for item in Delete["Objects"]]
        requested_batches.append(chunk)
        expected_failures.extend([chunk[0], chunk[-1]])
        return {"Errors": [{"Key": key, "Code": "AccessDenied"} for key in (chunk[0], chunk[-1], chunk[0])]}

    client = Mock()
    client.delete_objects.side_effect = delete_objects
    result = remediate_bucket_content(
        source_client=None, target_client=client, source_bucket="source", target_bucket="target",
        action="delete_target_only", object_keys=keys, same_endpoint=False,
    )

    assert requested_batches == [keys[:1000], keys[1000:]]
    assert result.succeeded_count == len(keys) - 4
    assert result.failed_count == 4
    assert result.failed_keys_sample == sorted(expected_failures)


@pytest.mark.parametrize("response", [{}, {"Errors": []}])
def test_delete_remediation_accepts_responses_without_errors(response):
    client = Mock()
    client.delete_objects.return_value = response
    result = remediate_bucket_content(
        source_client=None, target_client=client, source_bucket="source", target_bucket="target",
        action="delete_target_only", object_keys=EXACT_KEYS, same_endpoint=False,
    )
    assert result.succeeded_count == len(EXACT_KEYS)
    assert result.failed_count == 0
    assert result.failed_keys_sample == []
