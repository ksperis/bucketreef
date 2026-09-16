# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import io
from unittest.mock import Mock
from urllib.parse import parse_qsl

from botocore.exceptions import ClientError
import pytest

from app.services.bucket_migration._shared import _ResolvedContext
from app.services.bucket_migration_service import BucketMigrationService
from tests.execution_context_factory import make_s3_execution_context


EXACT_KEYS = [" object.txt ", " ", "/docs//file ", "café/%2F+file"]
EXACT_TAGS = [
    {"Key": " stage ", "Value": " prod "},
    {"Key": "stage", "Value": "test"},
    {"Key": " ", "Value": ""},
    {"Key": "é+%/=", "Value": " +%/=é "},
]


@pytest.fixture
def storage(db_session, monkeypatch):
    service = BucketMigrationService(db_session)
    contexts = [
        _ResolvedContext(
            context_id=str(index),
            account=make_s3_execution_context(id=index, context_id=str(index)),
            endpoint="https://s3.example.test", region="us-east-1",
            force_path_style=True, verify_tls=True,
        )
        for index in (1, 2)
    ]
    source = Mock()
    target = Mock()
    source.head_object.return_value = {"ContentLength": 7, "Metadata": {}}
    source.get_object_tagging.return_value = {"TagSet": EXACT_TAGS}
    target.head_object.return_value = {"ContentLength": 7, "Metadata": {}}
    monkeypatch.setattr(service, "_context_client", lambda ctx: source if ctx is contexts[0] else target)
    return service, *contexts, source, target


@pytest.mark.parametrize("key", EXACT_KEYS)
@pytest.mark.parametrize("version_id", [" version +%2F ", "null"])
def test_scanned_version_identity_reaches_both_access_probes(storage, key, version_id):
    service, source_ctx, target_ctx, source, target = storage
    source.list_object_versions.return_value = {
        "Versions": [{"Key": key, "VersionId": version_id, "IsLatest": True}],
    }
    scan = service._inspector.scan_bucket_versions(source_ctx, "source")
    source_profile = {"version_scan": scan}
    body = Mock()
    body.read.return_value = b"p"
    source.get_object.return_value = {"Body": body}

    service._precheck_version_aware_source_access(source_ctx, "source", source_profile)
    result = service._precheck_same_endpoint_copy_source_access(
        source_ctx, target_ctx, "source", auto_grant=False,
        strategy="version_aware", source_profile=source_profile,
    )

    assert result == "validated"
    expected = {"Bucket": "source", "Key": key, "VersionId": version_id}
    source.head_object.assert_called_once_with(**expected)
    source.get_object.assert_called_once_with(**expected)
    source.get_object_tagging.assert_called_once_with(**expected)
    target.head_object.assert_called_once_with(**expected)
    source.list_objects_v2.assert_not_called()
    body.read.assert_called_once_with(1)
    body.close.assert_called_once_with()


def test_exact_version_denial_never_probes_a_trimmed_neighbor(storage):
    service, source_ctx, _target_ctx, source, _target = storage
    key, version_id = " secret.txt ", " version "
    denied = ClientError({"Error": {"Code": "AccessDenied", "Message": "Denied"}}, "HeadObject")

    def head_object(**kwargs):
        if kwargs["Key"] == key and kwargs["VersionId"] == version_id:
            raise denied
        return {}

    source.head_object.side_effect = head_object
    with pytest.raises(RuntimeError, match="Unable to read sample version"):
        service._precheck_version_aware_source_access(
            source_ctx, "source",
            {"version_scan": {"sample_version": {"key": key, "version_id": version_id}}},
        )
    source.head_object.assert_called_once_with(Bucket="source", Key=key, VersionId=version_id)
    source.get_object.assert_not_called()
    source.get_object_tagging.assert_not_called()


@pytest.mark.parametrize("sample", [
    None, {}, {"key": "", "version_id": "v"}, {"key": "key", "version_id": ""},
    {"key": 123, "version_id": "v"}, {"key": "key", "version_id": 123},
    {"key": ["key"], "version_id": "v"}, {"key": "key", "version_id": {"id": "v"}},
])
def test_invalid_sample_is_not_coerced_into_an_object_identity(storage, sample):
    service, source_ctx, _target_ctx, source, _target = storage
    service._precheck_version_aware_source_access(
        source_ctx, "source", {"version_scan": {"sample_version": sample}},
    )
    source.head_object.assert_not_called()
    source.get_object.assert_not_called()
    source.get_object_tagging.assert_not_called()


@pytest.mark.parametrize("same_endpoint", [False, True])
@pytest.mark.parametrize("version_id", [None, " version "])
def test_stream_copy_preserves_exact_tags_and_object_identity(storage, same_endpoint, version_id):
    service, source_ctx, target_ctx, source, target = storage
    key = " /docs//object.txt "
    body = io.BytesIO(b"payload")
    source.get_object.return_value = {"Body": body}
    target.copy_object.side_effect = ClientError(
        {"Error": {"Code": "AccessDenied", "Message": "Denied"}}, "CopyObject",
    )
    uploaded = []
    target.upload_fileobj.side_effect = lambda stream, *_args, **_kwargs: uploaded.append(stream.read())

    service._copy_object(
        source_ctx, target_ctx, source_bucket="source", target_bucket="target",
        key=key, version_id=version_id, same_endpoint=same_endpoint,
    )

    assert uploaded == [b"payload"]
    assert body.closed
    expected = {"Bucket": "source", "Key": key}
    if version_id is not None:
        expected["VersionId"] = version_id
    source.get_object.assert_called_once_with(**expected)
    source.get_object_tagging.assert_called_once_with(**expected)
    args, kwargs = target.upload_fileobj.call_args
    assert args[1:] == ("target", key)
    assert sorted(parse_qsl(kwargs["ExtraArgs"]["Tagging"], keep_blank_values=True)) == sorted(
        (entry["Key"], entry["Value"]) for entry in EXACT_TAGS
    )
    if same_endpoint:
        assert target.copy_object.call_args.kwargs["CopySource"] == expected
    else:
        target.copy_object.assert_not_called()


@pytest.mark.parametrize("source_tags,target_tags", [
    ([{"Key": " stage ", "Value": "prod"}], [{"Key": "stage", "Value": "prod"}]),
    ([{"Key": " ", "Value": ""}], []),
    ([{"Key": "stage", "Value": " prod "}], [{"Key": "stage", "Value": "prod"}]),
])
def test_version_comparison_detects_literal_tag_differences(storage, source_tags, target_tags):
    service, source_ctx, target_ctx, source, target = storage
    source.get_object_tagging.return_value = {"TagSet": source_tags}
    target.get_object_tagging.return_value = {"TagSet": target_tags}
    source.list_object_versions.return_value = {
        "Versions": [{"Key": " object ", "VersionId": " v1 ", "IsLatest": True}],
    }
    target.list_object_versions.return_value = {
        "Versions": [{"Key": " object ", "VersionId": " v2 ", "IsLatest": True}],
    }
    diff = service._compare_buckets_version_aware(
        source_ctx, target_ctx, source_bucket="source", target_bucket="target", control_check=lambda: "run",
    )
    assert diff.source_count == diff.target_count == diff.different_count == 1
    assert diff.matched_count == 0
    assert diff.sample["different_sample"][0]["key"] == " object "
    assert diff.sample["different_sample"][0]["reason"] == "tags_mismatch"
    source.get_object_tagging.assert_called_once_with(Bucket="source", Key=" object ", VersionId=" v1 ")
    target.get_object_tagging.assert_called_once_with(Bucket="target", Key=" object ", VersionId=" v2 ")


def test_version_comparison_ignores_tag_order_not_tag_identity(storage):
    service, _source_ctx, _target_ctx, source, target = storage
    target.get_object_tagging.return_value = {"TagSet": list(reversed(EXACT_TAGS))}
    source_details = service._versioned_object_details(source, "source", "object", version_id="v1")
    target_details = service._versioned_object_details(target, "target", "object", version_id="v2")
    assert service._compare_versioned_object_details(source_details, target_details) == (True, "size", None)


@pytest.mark.parametrize("response", [
    None, [], {}, {"TagSet": None}, {"TagSet": {}}, {"TagSet": "invalid"},
    {"TagSet": [None]}, {"TagSet": [{}]}, {"TagSet": [{"Key": "key"}]},
    {"TagSet": [{"Key": "", "Value": "value"}]},
    {"TagSet": [{"Key": 123, "Value": "value"}]},
    {"TagSet": [{"Key": "key", "Value": None}]},
    {"TagSet": [{"Key": "key", "Value": False}]},
    {"TagSet": [{"Key": "key", "Value": "a"}, {"Key": "key", "Value": "b"}]},
])
def test_malformed_source_tags_fail_before_any_destination_write(storage, response):
    service, source_ctx, target_ctx, source, target = storage
    source.get_object_tagging.return_value = response
    with pytest.raises(RuntimeError, match="Invalid object tags response"):
        service._stream_copy_object(
            source_ctx, target_ctx, source_bucket="source", target_bucket="target", key="object",
        )
    source.get_object.assert_not_called()
    target.upload_fileobj.assert_not_called()


def test_empty_tagset_remains_a_valid_untagged_copy(storage):
    service, source_ctx, target_ctx, source, target = storage
    source.get_object_tagging.return_value = {"TagSet": []}
    body = io.BytesIO(b"payload")
    source.get_object.return_value = {"Body": body}
    service._stream_copy_object(
        source_ctx, target_ctx, source_bucket="source", target_bucket="target", key="object",
    )
    target.upload_fileobj.assert_called_once_with(body, "target", "object")
    assert body.closed


@pytest.mark.parametrize("response", [None, {}, {"TagSet": [{"Key": "stage"}]}])
def test_malformed_destination_tags_cannot_pass_version_verification(storage, response):
    service, _source_ctx, _target_ctx, _source, target = storage
    target.get_object_tagging.return_value = response
    with pytest.raises(RuntimeError, match="Invalid object tags response"):
        service._versioned_object_details(target, "target", "object", version_id="v2")
