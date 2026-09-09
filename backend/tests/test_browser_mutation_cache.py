# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone
from io import BytesIO
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.models.browser import (
    CleanupObjectVersionsPayload,
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ObjectMetadataUpdate,
    ObjectRestoreRequest,
    ObjectTag,
)
from app.services.browser import _shared
from app.services.browser import buckets as browser_buckets
from app.services.browser import versions as browser_versions
from app.services.browser_service import BrowserService
from app.services.s3_deletion import DeleteObjectsError
from tests.execution_context_factory import make_s3_execution_context


OBJECT_CACHES = (
    _shared._OBJECT_LIST_CACHE,
    _shared._OBJECT_SORT_SNAPSHOT_CACHE,
    _shared._OBJECT_LAZY_HEAD_CACHE,
    _shared._OBJECT_LAZY_TAGS_CACHE,
)


@pytest.fixture(autouse=True)
def clear_caches():
    for cache in (*OBJECT_CACHES, _shared._BUCKET_LIST_CACHE):
        cache.invalidate_where(lambda _key: True)
    yield
    for cache in (*OBJECT_CACHES, _shared._BUCKET_LIST_CACHE):
        cache.invalidate_where(lambda _key: True)


@pytest.mark.parametrize("sort_by,sort_dir", [("name", "asc"), ("size", "desc")])
def test_partial_deletion_refreshes_real_object_listings(monkeypatch, sort_by, sort_dir):
    service = BrowserService()
    account = make_s3_execution_context()
    objects = {"gone": 10, "blocked": 20}
    client = Mock()
    client.list_objects_v2.side_effect = lambda **_kwargs: {
        "Contents": [{"Key": key, "Size": size} for key, size in objects.items()],
    }

    def delete_objects(**_kwargs):
        objects.pop("gone")
        return {"Errors": [{"Key": "blocked", "Code": "AccessDenied"}]}

    client.delete_objects.side_effect = delete_objects
    monkeypatch.setattr(service, "_client", lambda *_args, **_kwargs: client)
    before = service.list_objects("target", account, sort_by=sort_by, sort_dir=sort_dir)
    assert {item.key for item in before.objects} == {"gone", "blocked"}

    with pytest.raises(DeleteObjectsError):
        service.delete_objects("target", account, DeleteObjectsPayload(objects=[{"key": "gone"}, {"key": "blocked"}]))

    after = service.list_objects("target", account, sort_by=sort_by, sort_dir=sort_dir)
    assert [item.key for item in after.objects] == ["blocked"]
    assert client.list_objects_v2.call_count == 2


@pytest.mark.parametrize("tags", [[], [ObjectTag(key="new", value="value"), ObjectTag(key="another", value="value")]])
def test_tag_mutation_refreshes_real_lazy_columns(monkeypatch, tags):
    service = BrowserService()
    account = make_s3_execution_context()
    stored_tags = [{"Key": "old", "Value": "value"}]
    client = Mock()
    client.get_object_tagging.side_effect = lambda **_kwargs: {"TagSet": list(stored_tags)}

    def put_tags(**kwargs):
        stored_tags[:] = kwargs["Tagging"]["TagSet"]

    client.put_object_tagging.side_effect = put_tags
    client.delete_object_tagging.side_effect = lambda **_kwargs: stored_tags.clear()
    monkeypatch.setattr(service, "_client", lambda *_args, **_kwargs: client)
    before = service.get_object_columns("target", account, keys=["object"], columns={"tags_count"})
    assert before.items[0].tags_count == 1

    service.put_object_tags("target", account, "object", tags)

    after = service.get_object_columns("target", account, keys=["object"], columns={"tags_count"})
    assert after.items[0].tags_count == len(tags)
    assert client.get_object_tagging.call_count == 2


def _seed_scoped_caches(service, account):
    scopes = {
        "target": (account, "target"),
        "source": (account, "source"),
        "other_bucket": (account, "target-extra"),
        "other_context": (make_s3_execution_context(context_id="2", id=2), "target"),
    }
    entries = {}
    for label, (context, bucket_name) in scopes.items():
        key = (service._account_cache_key(context), bucket_name, "opaque cache parameters")
        entries[label] = []
        for cache in OBJECT_CACHES:
            value = Mock(spec=["close"])
            cache.set(key, value)
            entries[label].append((cache, key, value))
    return entries


def _assert_invalidated(entries, affected):
    for label, cached_entries in entries.items():
        for cache, key, value in cached_entries:
            assert cache.get(key) is (None if label in affected else value), label
            if cache is _shared._OBJECT_SORT_SNAPSHOT_CACHE:
                assert value.close.call_count == int(label in affected)


def _mutation_client(service, monkeypatch):
    client = Mock()
    client.delete_objects.return_value = {}
    client.copy_object.return_value = {"VersionId": "new-version"}
    client.head_object.return_value = {"ContentLength": 10, "ETag": '"same-etag"', "Metadata": {}}
    client.get_object_tagging.return_value = {"TagSet": [{"Key": "old", "Value": "value"}]}
    monkeypatch.setattr(service, "_client", lambda *_args, **_kwargs: client)
    return client


def _run_mutation(service, account, operation):
    calls = {
        "delete": lambda: service.delete_objects("target", account, DeleteObjectsPayload(objects=[{"key": "object"}])),
        "folder": lambda: service.create_folder("target", account, "folder"),
        "complete": lambda: service.complete_multipart_upload(
            "target", account, "object", "upload-id",
            CompleteMultipartUploadRequest(parts=[{"part_number": 1, "etag": "etag"}]),
        ),
        "abort": lambda: service.abort_multipart_upload("target", account, "object", "upload-id"),
        "upload": lambda: service.proxy_upload("target", account, "object", BytesIO(b"data"), "text/plain"),
        "tags": lambda: service.put_object_tags("target", account, "object", [ObjectTag(key="new", value="value")]),
        "clear_tags": lambda: service.put_object_tags("target", account, "object", []),
        "metadata": lambda: service.update_object_metadata("target", account, ObjectMetadataUpdate(key="object")),
        "restore": lambda: service.restore_object("target", account, ObjectRestoreRequest(key="object")),
    }
    return calls[operation]()


@pytest.mark.parametrize("operation,sdk_method", [
    ("delete", "delete_objects"), ("folder", "put_object"), ("complete", "complete_multipart_upload"),
    ("abort", "abort_multipart_upload"), ("upload", "upload_fileobj"), ("tags", "put_object_tagging"),
    ("clear_tags", "delete_object_tagging"), ("metadata", "copy_object"), ("restore", "restore_object"),
])
@pytest.mark.parametrize("outcome", ["success", "denied", "transport", "unexpected"])
def test_mutation_outcomes_expire_only_the_affected_object_caches(monkeypatch, operation, sdk_method, outcome):
    service = BrowserService()
    account = make_s3_execution_context()
    client = _mutation_client(service, monkeypatch)
    entries = _seed_scoped_caches(service, account)
    failure = {
        "success": None,
        "denied": ClientError({"Error": {"Code": "AccessDenied", "Message": "denied"}}, sdk_method),
        "transport": EndpointConnectionError(endpoint_url="https://storage.invalid"),
        "unexpected": RuntimeError("uncertain operation outcome"),
    }[outcome]
    getattr(client, sdk_method).side_effect = failure

    if failure is None:
        _run_mutation(service, account, operation)
    else:
        with pytest.raises(RuntimeError) as caught:
            _run_mutation(service, account, operation)
        assert caught.value is failure or caught.value.__cause__ is failure

    _assert_invalidated(entries, {"target"})


@pytest.mark.parametrize("move", [False, True])
@pytest.mark.parametrize("failure_stage", [None, "copy", "tags", "verification", "source_delete"])
def test_copy_and_move_expire_only_potentially_mutated_buckets(monkeypatch, move, failure_stage):
    service = BrowserService()
    account = make_s3_execution_context()
    client = _mutation_client(service, monkeypatch)
    entries = _seed_scoped_caches(service, account)
    failure = ClientError({"Error": {"Code": "AccessDenied", "Message": "denied"}}, "CopyWorkflow")
    if failure_stage == "copy":
        client.copy_object.side_effect = failure
    elif failure_stage == "tags":
        client.put_object_tagging.side_effect = failure
    elif failure_stage == "verification":
        client.head_object.side_effect = [{"ContentLength": 10, "ETag": "one"}, {"ContentLength": 10, "ETag": "two"}]
    elif failure_stage == "source_delete":
        client.delete_object.side_effect = failure
    payload = CopyObjectPayload(
        source_bucket="source", source_key=" source ", destination_key=" destination ", move=move,
        replace_tags=True, tags=[ObjectTag(key="new", value="value")],
    )
    should_fail = failure_stage in {"copy", "tags"} or (move and failure_stage is not None)

    if should_fail:
        with pytest.raises(RuntimeError):
            service.copy_object("target", account, payload)
    else:
        service.copy_object("target", account, payload)

    _assert_invalidated(entries, {"target", "source"} if move else {"target"})
    if not move or failure_stage in {"copy", "tags", "verification"}:
        client.delete_object.assert_not_called()
    else:
        client.delete_object.assert_called_once_with(Bucket="source", Key=" source ")


def test_same_bucket_move_invalidates_each_cache_once(monkeypatch):
    service = BrowserService()
    account = make_s3_execution_context()
    _mutation_client(service, monkeypatch)
    invalidate = Mock(wraps=service.invalidate_object_list_cache_for_account)
    monkeypatch.setattr(service, "invalidate_object_list_cache_for_account", invalidate)

    service.copy_object("target", account, CopyObjectPayload(source_key="source", destination_key="destination", move=True))

    invalidate.assert_called_once_with(account, "target")


def test_metadata_copy_failure_after_write_expires_cached_columns(monkeypatch):
    service = BrowserService()
    account = make_s3_execution_context()
    client = _mutation_client(service, monkeypatch)
    entries = _seed_scoped_caches(service, account)
    client.put_object_tagging.side_effect = ClientError(
        {"Error": {"Code": "AccessDenied", "Message": "denied"}}, "PutObjectTagging",
    )

    with pytest.raises(RuntimeError, match="Unable to restore tags"):
        service.update_object_metadata("target", account, ObjectMetadataUpdate(key="object", metadata={"new": "value"}))

    assert client.copy_object.call_count == 1
    _assert_invalidated(entries, {"target"})


@pytest.mark.parametrize("stage", ["versions", "markers"])
@pytest.mark.parametrize("outcome", ["success", "partial", "transport"])
def test_version_cleanup_batches_invalidate_even_when_cleanup_aborts(monkeypatch, stage, outcome):
    service = BrowserService()
    account = make_s3_execution_context()
    client = _mutation_client(service, monkeypatch)
    entries = _seed_scoped_caches(service, account)
    versions = [
        {"Key": "same", "VersionId": f"v{index}", "IsLatest": index == 3,
         "LastModified": datetime(2026, 1, index, tzinfo=timezone.utc)}
        for index in range(1, 4)
    ]
    client.list_object_versions.return_value = {"Versions": versions} if stage == "versions" else {
        "DeleteMarkers": [dict(item, IsLatest=False) for item in versions[:2]],
    }
    if outcome == "partial":
        client.delete_objects.side_effect = lambda **kwargs: {
            "Errors": [{**kwargs["Delete"]["Objects"][-1], "Code": "AccessDenied"}],
        }
    elif outcome == "transport":
        client.delete_objects.side_effect = EndpointConnectionError(endpoint_url="https://storage.invalid")
    payload = CleanupObjectVersionsPayload(keep_last_n=1) if stage == "versions" else CleanupObjectVersionsPayload(delete_orphan_markers=True)

    if outcome == "success":
        result = service.cleanup_object_versions("target", account, payload)
        assert result.deleted_versions + result.deleted_delete_markers == 2
    else:
        with pytest.raises(RuntimeError):
            service.cleanup_object_versions("target", account, payload)

    assert client.delete_objects.call_count == 1
    _assert_invalidated(entries, {"target"})


def test_cleanup_invalidation_precedes_local_bookkeeping(monkeypatch):
    service = BrowserService()
    account = make_s3_execution_context()
    client = _mutation_client(service, monkeypatch)
    entries = _seed_scoped_caches(service, account)
    client.list_object_versions.return_value = {"Versions": [
        {"Key": "object", "VersionId": "latest", "IsLatest": True},
        {"Key": "object", "VersionId": "old", "IsLatest": False},
    ]}

    def fail_bookkeeping(*_args):
        _assert_invalidated(entries, {"target"})
        raise RuntimeError("bookkeeping failed")

    monkeypatch.setattr(browser_versions.ObjectVersionCleanupStore, "remove_versions", fail_bookkeeping)

    with pytest.raises(RuntimeError, match="bookkeeping failed"):
        service.cleanup_object_versions("target", account, CleanupObjectVersionsPayload(keep_last_n=1))

    assert client.delete_objects.call_count == 1


@pytest.mark.parametrize("operation", [
    "empty_delete", "empty_cleanup", "scan_error", "metadata_read", "copy_read", "empty_parts", "file_seek", "client_init",
])
def test_noop_and_read_only_failures_do_not_expire_caches(monkeypatch, operation):
    service = BrowserService()
    account = make_s3_execution_context()
    client = _mutation_client(service, monkeypatch)
    entries = _seed_scoped_caches(service, account)
    denied = ClientError({"Error": {"Code": "AccessDenied", "Message": "denied"}}, "ReadObject")
    if operation == "empty_delete":
        assert service.delete_objects("target", account, DeleteObjectsPayload(objects=[])) == 0
    elif operation == "empty_cleanup":
        client.list_object_versions.return_value = {}
        service.cleanup_object_versions("target", account, CleanupObjectVersionsPayload(keep_last_n=1))
    else:
        with pytest.raises((RuntimeError, OSError)):
            if operation == "scan_error":
                client.list_object_versions.side_effect = denied
                service.cleanup_object_versions("target", account, CleanupObjectVersionsPayload(keep_last_n=1))
            elif operation == "metadata_read":
                client.head_object.side_effect = denied
                service.update_object_metadata("target", account, ObjectMetadataUpdate(key="object"))
            elif operation == "copy_read":
                client.head_object.side_effect = denied
                service.copy_object("target", account, CopyObjectPayload(source_key="old", destination_key="new", replace_metadata=True))
            elif operation == "empty_parts":
                service.complete_multipart_upload("target", account, "object", "upload-id", CompleteMultipartUploadRequest(parts=[]))
            elif operation == "client_init":
                monkeypatch.setattr(service, "_client", Mock(side_effect=RuntimeError("client unavailable")))
                _run_mutation(service, account, "delete")
            else:
                body = Mock()
                body.seek.side_effect = OSError("cannot seek")
                service.proxy_upload("target", account, "object", body, None)

    _assert_invalidated(entries, set())
    client.copy_object.assert_not_called()
    client.delete_objects.assert_not_called()
    client.upload_fileobj.assert_not_called()


@pytest.mark.parametrize("outcome", ["success", "create_failed", "versioning_failed", "config_failed"])
def test_bucket_creation_expires_bucket_list_after_partial_configuration(monkeypatch, outcome):
    service = BrowserService()
    account = make_s3_execution_context()
    entries = _seed_scoped_caches(service, account)
    account_key = service._account_cache_key(account)
    other_key = service._account_cache_key(make_s3_execution_context(context_id="2", id=2))
    _shared._BUCKET_LIST_CACHE.set(account_key, [])
    _shared._BUCKET_LIST_CACHE.set(other_key, [])
    create = Mock()
    versioning = Mock()
    failure = RuntimeError("storage mutation failed")
    if outcome == "create_failed":
        create.side_effect = failure
    elif outcome == "versioning_failed":
        versioning.side_effect = failure
    monkeypatch.setattr(browser_buckets, "s3_create_bucket", create)
    monkeypatch.setattr(browser_buckets, "s3_set_bucket_versioning", versioning)
    monkeypatch.setattr(service, "_resolve_s3_credentials", lambda _account: ("TEST-AK", "TEST-SK", None))
    if outcome == "config_failed":
        monkeypatch.setattr(service, "_s3_client_kwargs", Mock(side_effect=failure))

    if outcome == "success":
        service.create_bucket("target", account, versioning=True)
    else:
        with pytest.raises(RuntimeError) as caught:
            service.create_bucket("target", account, versioning=True)
        assert caught.value is failure

    attempted = outcome != "config_failed"
    assert create.call_count == int(attempted)
    assert versioning.call_count == int(outcome in {"success", "versioning_failed"})
    assert _shared._BUCKET_LIST_CACHE.get(account_key) == (None if attempted else [])
    assert _shared._BUCKET_LIST_CACHE.get(other_key) == []
    _assert_invalidated(entries, {"target"} if attempted else set())
