# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from botocore.parsers import ResponseParserError

from app.services import s3_deletion


@pytest.mark.parametrize("delete", [s3_deletion.delete_objects, s3_deletion.delete_objects_count])
def test_delete_helpers_raise_with_exact_partial_failures(delete):
    items = [
        {"Key": "report.txt"},
        {"Key": " report.txt "},
        {"Key": " ", "VersionId": "version"},
        {"Key": " ", "VersionId": " version "},
        {"Key": "café.txt"},
        {"Key": "cafe\u0301.txt"},
    ]
    client = Mock()
    client.delete_objects.return_value = {"Errors": [
        {**items[3], "Code": "AccessDenied", "Message": "version denied"},
        {**items[1], "Code": "AccessDenied", "Message": "object denied"},
        {**items[3], "Code": "AccessDenied"},
        {**items[5], "Code": "AccessDenied"},
    ]}

    with pytest.raises(s3_deletion.DeleteObjectsError) as caught:
        delete(client, "target", iter(items))

    assert caught.value.deleted_count == 3
    assert [(failure.key, failure.version_id) for failure in caught.value.failures] == [
        (" report.txt ", None), (" ", " version "), ("cafe\u0301.txt", None),
    ]
    assert caught.value.failures[1].message == "AccessDenied: version denied"
    client.delete_objects.assert_called_once_with(Bucket="target", Delete={"Objects": items})
    client.delete_object.assert_not_called()


def test_delete_count_keeps_prior_successes_and_stops_at_first_partial_batch():
    items = [{"Key": f" key-{index} "} for index in range(2001)]
    client = Mock()
    client.delete_objects.side_effect = [{}, {"Errors": [
        {**items[1002], "Code": "AccessDenied"}, {**items[1002], "Code": "AccessDenied"},
    ]}]

    with pytest.raises(s3_deletion.DeleteObjectsError) as caught:
        s3_deletion.delete_objects_count(client, "target", iter(items))

    assert caught.value.deleted_count == 1999
    assert [failure.key for failure in caught.value.failures] == [items[1002]["Key"]]
    assert [call.kwargs["Delete"]["Objects"] for call in client.delete_objects.call_args_list] == [
        items[:1000], items[1000:2000],
    ]


def test_duplicate_requests_never_inflate_success_or_count_repeated_errors_twice():
    client = Mock()
    client.delete_objects.return_value = {"Errors": [{"Key": "failed"}] * 3}

    with pytest.raises(s3_deletion.DeleteObjectsError) as caught:
        s3_deletion.delete_objects_count(client, "target", [
            {"Key": "ok"}, {"Key": "failed"}, {"Key": "failed"},
        ])

    assert caught.value.deleted_count == 1
    assert [failure.key for failure in caught.value.failures] == ["failed", "failed"]


@pytest.mark.parametrize("response", [{}, {"Errors": []}, {"Deleted": [{"Key": " key "}]}])
def test_successful_response_counts_requests_even_without_a_deleted_list(response):
    client = Mock()
    client.delete_objects.return_value = response

    assert s3_deletion.delete_objects_count(client, "target", [{"Key": " key "}]) == 1


def test_empty_requests_do_not_contact_storage():
    client = Mock()

    assert s3_deletion.delete_objects_count(client, "target", iter([])) == 0
    assert s3_deletion.delete_objects(client, "target", []) is None
    assert client.mock_calls == []


@pytest.mark.parametrize("response", [
    None, [], "ok", {"Errors": None}, {"Errors": {}}, {"Errors": "failed"},
    {"Errors": [None]}, {"Errors": [{}]}, {"Errors": [{"Key": None}]},
    {"Errors": [{"Key": 42}]}, {"Errors": [{"Key": [" key "]}]},
    {"Errors": [{"Key": "key"}]},
    {"Errors": [{"Key": " key ", "VersionId": "unrequested"}]},
    {"Errors": [{"Key": " key ", "VersionId": 42}]},
    {"Errors": [{"Key": " key ", "VersionId": []}]},
    {"Errors": [{"Key": " key "}, {"Key": "unrequested"}]},
])
def test_malformed_or_unattributable_responses_fail_without_retrying_deletions(response):
    client = Mock()
    client.delete_objects.return_value = response

    with pytest.raises(RuntimeError, match="Invalid DeleteObjects response"):
        s3_deletion.delete_objects_count(client, "target", [{"Key": " key "}])

    assert client.delete_objects.call_count == 1
    client.delete_object.assert_not_called()


@pytest.mark.parametrize("items", [
    [{"Key": "same", "VersionId": "1"}, {"Key": "same", "VersionId": "2"}],
    [{"Key": "same"}, {"Key": "same", "VersionId": "1"}],
])
def test_missing_error_version_is_rejected_when_a_key_has_multiple_targets(items):
    client = Mock()
    client.delete_objects.return_value = {"Errors": [{"Key": "same", "Code": "AccessDenied"}]}

    with pytest.raises(RuntimeError, match="Invalid DeleteObjects response"):
        s3_deletion.delete_objects_count(client, "target", items)


def test_missing_error_version_resolves_only_to_a_unique_requested_target():
    client = Mock()
    client.delete_objects.return_value = {"Errors": [{"Key": "same", "Code": "AccessDenied"}]}

    with pytest.raises(s3_deletion.DeleteObjectsError) as caught:
        s3_deletion.delete_objects_count(client, "target", [
            {"Key": "same", "VersionId": " v "}, {"Key": "other", "VersionId": "v"},
        ])

    assert caught.value.deleted_count == 1
    assert [(failure.key, failure.version_id) for failure in caught.value.failures] == [("same", " v ")]


@pytest.mark.parametrize("version_id", ["v", "unrequested", 42, []])
def test_error_versions_must_match_the_exact_requested_version(version_id):
    client = Mock()
    client.delete_objects.return_value = {"Errors": [{"Key": "same", "VersionId": version_id}]}

    with pytest.raises(RuntimeError, match="Invalid DeleteObjects response"):
        s3_deletion.delete_objects_count(client, "target", [{"Key": "same", "VersionId": " v "}])


def test_purge_preserves_partial_counts_and_identifies_each_failed_object_or_version():
    client = Mock()
    client.list_objects_v2.return_value = {"Contents": [
        {"Key": "report.txt"}, {"Key": " report.txt "}, {"Key": "other.txt"},
    ]}
    client.list_object_versions.return_value = {
        "Versions": [{"Key": "same", "VersionId": "v"}, {"Key": "same", "VersionId": " v "}],
        "DeleteMarkers": [{"Key": "same", "VersionId": "marker"}],
    }
    client.delete_objects.side_effect = [
        {"Errors": [{"Key": " report.txt ", "Code": "AccessDenied", "Message": "object denied"}] * 2},
        {"Errors": [
            {"Key": "same", "VersionId": "marker", "Code": "AccessDenied", "Message": "marker denied"},
            {"Key": "same", "VersionId": " v ", "Code": "AccessDenied", "Message": "version denied"},
        ]},
    ]
    progress = []

    result = s3_deletion.purge_bucket_contents(client, "target", progress_callback=progress.append)

    assert (result.listed_objects, result.deleted_objects) == (3, 2)
    assert (result.listed_versions, result.deleted_versions) == (3, 1)
    assert result.failed_count == 3
    assert [(failure.stage, failure.key, failure.version_id, failure.count) for failure in result.failures_sample] == [
        ("objects", " report.txt ", None, 1), ("versions", "same", " v ", 1), ("versions", "same", "marker", 1),
    ]
    assert [failure.message for failure in result.failures_sample] == [
        "AccessDenied: object denied", "AccessDenied: version denied", "AccessDenied: marker denied",
    ]
    assert progress[-1].stage == "completed"
    assert (progress[-1].deleted_objects, progress[-1].deleted_versions, progress[-1].failed_count) == (2, 1, 3)


@pytest.mark.parametrize("response", [None, {"Errors": [{"Key": "unrequested"}]}])
def test_purge_reports_unknown_batch_outcomes_as_failures(response):
    client = Mock()
    client.list_objects_v2.return_value = {"Contents": [{"Key": "first"}, {"Key": "second"}]}
    client.delete_objects.return_value = response

    result = s3_deletion.purge_bucket_contents(client, "target", include_versions=False)

    assert (result.deleted_objects, result.failed_count) == (0, 2)
    assert result.failures_sample[0].count == 2
    assert "Invalid DeleteObjects response" in result.failures_sample[0].message
    client.delete_object.assert_not_called()


def test_purge_does_not_turn_a_transport_error_into_a_partial_success():
    client = Mock()
    client.list_objects_v2.return_value = {"Contents": [{"Key": "first"}, {"Key": "second"}]}
    client.delete_objects.side_effect = EndpointConnectionError(endpoint_url="https://storage.invalid")

    result = s3_deletion.purge_bucket_contents(client, "target", include_versions=False)

    assert (result.deleted_objects, result.failed_count) == (0, 2)
    assert result.failures_sample[0].count == 2
    client.delete_object.assert_not_called()


@pytest.mark.parametrize("individual_deletes", [False, True])
@pytest.mark.parametrize("missing_code", ["NoSuchKey", "NoSuchVersion", "NotFound"])
def test_individual_and_xml_fallback_purges_keep_exact_versions_and_partial_results(individual_deletes, missing_code):
    client = Mock()
    items = [
        {"Key": " ", "VersionId": " v "},
        {"Key": " ", "VersionId": " "},
        {"Key": " ", "VersionId": "null"},
    ]
    client.list_objects_v2.return_value = {}
    client.list_object_versions.return_value = {"Versions": items}
    client.delete_objects.side_effect = ResponseParserError("Unable to parse response, invalid XML received")

    def delete_object(**kwargs):
        version = kwargs["VersionId"]
        if version in {" ", "null"}:
            code = "AccessDenied" if version == " " else missing_code
            raise ClientError({"Error": {"Code": code, "Message": "denied or already gone"}}, "DeleteObject")
        return {}

    client.delete_object.side_effect = delete_object

    result = s3_deletion.purge_bucket_contents(client, "target", individual_deletes=individual_deletes)

    assert (result.deleted_versions, result.failed_count) == (2, 1)
    assert [(failure.key, failure.version_id, failure.count) for failure in result.failures_sample] == [(" ", " ", 1)]
    assert sorted(call.kwargs["VersionId"] for call in client.delete_object.call_args_list) == [" ", " v ", "null"]
    assert all(call.kwargs["Key"] == " " for call in client.delete_object.call_args_list)
    assert client.delete_objects.call_count == int(not individual_deletes)


def test_partial_purge_totals_span_batches_and_failure_samples_stay_bounded():
    items = [{"Key": f" key-{index} "} for index in range(2003)]
    client = Mock()
    client.list_objects_v2.return_value = {"Contents": items}

    def delete_objects(**kwargs):
        batch = kwargs["Delete"]["Objects"]
        return {"Errors": [{**item, "Code": "AccessDenied"} for item in batch[1:]] * 2}

    client.delete_objects.side_effect = delete_objects

    result = s3_deletion.purge_bucket_contents(client, "target", include_versions=False)

    assert result.listed_objects == 2003
    assert result.deleted_objects == 3
    assert result.failed_count == 2000
    assert len(result.failures_sample) == 500
    successful_keys = {items[index]["Key"] for index in (0, 1000, 2000)}
    assert all(failure.key not in successful_keys and failure.count == 1 for failure in result.failures_sample)
    assert sorted(len(call.kwargs["Delete"]["Objects"]) for call in client.delete_objects.call_args_list) == [3, 1000, 1000]


def test_provider_error_messages_remain_sanitized_in_partial_failure_samples():
    client = Mock()
    client.list_objects_v2.return_value = {"Contents": [{"Key": "failed"}]}
    client.delete_objects.return_value = {"Errors": [
        {"Key": "failed", "Code": "AccessDenied", "Message": "secret_access_key=sample-private-value"},
    ]}

    result = s3_deletion.purge_bucket_contents(client, "target", include_versions=False)

    assert result.failed_count == 1
    assert "sample-private-value" not in result.failures_sample[0].message
    assert "<redacted>" in result.failures_sample[0].message
