# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from concurrent.futures import ThreadPoolExecutor
import asyncio
import logging
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from app.routers.bucket_usage_stats_stream import stream_bucket_usage_stats
from app.services import bucket_compare_remediation, bucket_content_comparison, bucket_purge_service, s3_client
from app.services.bucket_comparison_service import BucketComparisonService
from app.services.bucket_integrity_service import (
    BucketIntegrityCheckCancelled, BucketIntegrityCheckService,
    BucketIntegrityOptions, BucketIntegrityResolvedTarget,
)
from app.services.bucket_purge_service import (
    BucketPurgeCancelled, BucketPurgeOptions, BucketPurgeResolvedTarget, BucketPurgeService,
)
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsCancelled, BucketUsageStatsOptions, BucketUsageStatsResolvedTarget, BucketUsageStatsService,
)
from tests.execution_context_factory import make_s3_execution_context


class TrackingClient:
    def __init__(self, *, error=None):
        self.close_calls = 0
        self.error = error
        self.delete_calls = 0

    def close(self):
        self.close_calls += 1

    def get_paginator(self, _operation):
        return self

    def paginate(self, **_kwargs):
        assert self.close_calls == 0
        if self.error:
            raise self.error
        yield {}

    def list_objects_v2(self, **_kwargs):
        assert self.close_calls == 0
        if self.error:
            raise self.error
        return {"Contents": [{"Key": "one", "Size": 1}, {"Key": "two", "Size": 2}]}

    def delete_bucket(self, **_kwargs):
        assert self.close_calls == 0
        self.delete_calls += 1


@pytest.mark.parametrize("service_type", [
    BucketComparisonService, BucketIntegrityCheckService, BucketPurgeService, BucketUsageStatsService,
])
def test_owned_client_scope_closes_logged_sdk_client(monkeypatch, service_type):
    sdk_client = Mock(spec=["close"])
    logged_client = s3_client.LoggedS3Client(sdk_client)
    factory = Mock(return_value=logged_client)
    monkeypatch.setattr(s3_client, "get_s3_client", factory)
    account = make_s3_execution_context(session_endpoint="https://s3.example.test")

    with pytest.raises(RuntimeError, match="Operation failed"):
        with service_type()._open_client(account) as client:
            assert client is logged_client
            sdk_client.close.assert_not_called()
            raise RuntimeError("Operation failed")

    sdk_client.close.assert_called_once_with()
    assert factory.call_args.kwargs["request_profile"] == "long_running"
    assert factory.call_args.kwargs["access_key"] == account.access_key


@pytest.mark.parametrize("operation", ["usage", "integrity", "purge", "delete"])
@pytest.mark.parametrize("outcome", ["success", "failure", "cancel"])
def test_bucket_operations_close_their_client_on_every_exit(monkeypatch, operation, outcome):
    cancellation = {
        "usage": BucketUsageStatsCancelled,
        "integrity": BucketIntegrityCheckCancelled,
        "purge": BucketPurgeCancelled,
        "delete": BucketPurgeCancelled,
    }[operation]
    error = None if outcome == "success" else (
        cancellation("Canceled") if outcome == "cancel" else RuntimeError("Listing failed")
    )
    client = TrackingClient(error=error)
    account = make_s3_execution_context(can_manage_buckets=True)
    if operation == "usage":
        service = BucketUsageStatsService()
        target = BucketUsageStatsResolvedTarget(account=account, bucket_name="bucket", scope_kind="manager", scope_id="1")
        run = lambda: service.calculate_bucket(target)
    elif operation == "integrity":
        service = BucketIntegrityCheckService()
        target = BucketIntegrityResolvedTarget(account=account, bucket_name="bucket")
        run = lambda: service.run([target], BucketIntegrityOptions())
    else:
        service = BucketPurgeService()
        target = BucketPurgeResolvedTarget(account=account, bucket_name="bucket")
        monkeypatch.setattr(service, "_resolve_initial_entry_estimates", lambda targets: [None] * len(targets))

        def purge(client, bucket_name, **_kwargs):
            assert client.close_calls == 0
            if error:
                raise error
            return bucket_purge_service.s3_deletion.BucketContentPurgeResult(bucket_name=bucket_name)

        monkeypatch.setattr(bucket_purge_service.s3_deletion, "purge_bucket_contents", purge)
        run = (
            (lambda: service.run([target], BucketPurgeOptions())) if operation == "purge"
            else (lambda: service.run_delete_bucket_with_purge(target, BucketPurgeOptions()))
        )
    monkeypatch.setattr(service, "_build_client", lambda _account: client)

    if outcome == "cancel":
        with pytest.raises(cancellation):
            run()
    elif operation == "usage" and outcome == "failure":
        with pytest.raises(RuntimeError, match="Listing failed"):
            run()
    else:
        result = run()
        if operation != "usage":
            assert result.status == ("failed" if outcome == "failure" else "passed" if operation == "integrity" else "completed")
    assert client.close_calls == 1
    assert client.delete_calls == int(operation == "delete" and outcome == "success")


@pytest.mark.parametrize("outcome", ["success", "failure", "cancel"])
def test_usage_current_listing_fallback_keeps_client_open_until_finished(monkeypatch, outcome):
    class CurrentOnlyClient(TrackingClient):
        def get_paginator(self, operation):
            assert self.close_calls == 0
            if operation == "list_object_versions":
                raise ClientError({"Error": {"Code": "NotImplemented", "Message": "Not supported"}}, operation)
            assert operation == "list_objects_v2"
            return self

    client = CurrentOnlyClient(error={
        "success": None, "failure": RuntimeError("Current listing failed"), "cancel": BucketUsageStatsCancelled("Canceled"),
    }[outcome])
    service = BucketUsageStatsService()
    monkeypatch.setattr(service, "_build_client", lambda _account: client)
    target = BucketUsageStatsResolvedTarget(
        account=make_s3_execution_context(), bucket_name="bucket", scope_kind="manager", scope_id="1",
    )
    if outcome == "success":
        assert service.calculate_bucket(target).scan_mode == "current_only"
    else:
        with pytest.raises(BucketUsageStatsCancelled if outcome == "cancel" else RuntimeError):
            service.calculate_bucket(target)
    assert client.close_calls == 1


@pytest.mark.parametrize("outcome", ["success", "failure", "early-close"])
def test_comparison_listing_closes_client(monkeypatch, outcome):
    client = TrackingClient(error=RuntimeError("Listing failed") if outcome == "failure" else None)
    service = BucketComparisonService()
    monkeypatch.setattr(service, "_build_client", lambda _account: client)
    iterator = service._list_bucket_objects_for_compare("bucket", make_s3_execution_context())
    if outcome == "early-close":
        assert next(iterator).key == "one"
        assert client.close_calls == 0
        iterator.close()
    elif outcome == "failure":
        with pytest.raises(RuntimeError, match="Listing failed"):
            list(iterator)
    else:
        assert len(list(iterator)) == 2
    assert client.close_calls == 1


@pytest.mark.parametrize("failing_side", ["source", "target"])
def test_comparison_closes_retained_generator_when_indexing_fails(monkeypatch, failing_side):
    clients = []
    retained_iterators = []
    service = BucketComparisonService()

    def build_client(_account):
        client = TrackingClient()
        clients.append(client)
        return client

    original_add = bucket_content_comparison.BucketCompareObjectIndex.add_objects

    def add_objects(index, side, entries):
        if side != failing_side:
            return original_add(index, side, entries)
        retained_iterators.append(entries)
        next(entries)
        raise RuntimeError("Index write failed")

    monkeypatch.setattr(service, "_build_client", build_client)
    monkeypatch.setattr(bucket_content_comparison.BucketCompareObjectIndex, "add_objects", add_objects)
    with pytest.raises(RuntimeError, match="Index write failed"):
        service.compare_bucket_content("source", make_s3_execution_context(), "target", make_s3_execution_context())
    assert retained_iterators
    assert len(clients) == (1 if failing_side == "source" else 2)
    assert all(client.close_calls == 1 for client in clients)


@pytest.mark.parametrize("action", ["sync_source_only", "sync_different", "delete_target_only"])
@pytest.mark.parametrize("outcome", ["success", "failure", "target-build-failure"])
def test_comparison_remediation_closes_all_owned_clients(monkeypatch, action, outcome):
    service = BucketComparisonService()
    source = make_s3_execution_context(context_id="1")
    target = make_s3_execution_context(context_id="2")
    clients = []

    def build_client(account):
        if outcome == "target-build-failure" and account is target:
            raise RuntimeError("Target construction failed")
        client = TrackingClient()
        clients.append(client)
        return client

    def remediate(**kwargs):
        assert all(client.close_calls == 0 for client in clients)
        assert (kwargs["source_client"] is None) == (action == "delete_target_only")
        if outcome == "failure":
            raise RuntimeError("Remediation failed")
        return bucket_compare_remediation.BucketCompareRemediationResult(action, 1, 1, 0, [])

    monkeypatch.setattr(service, "_build_client", build_client)
    monkeypatch.setattr(service, "_accounts_share_storage_endpoint", lambda *_args: True)
    monkeypatch.setattr(bucket_compare_remediation, "remediate_bucket_content", remediate)
    if outcome == "success":
        assert service.run_compare_content_remediation("source", source, "target", target, action=action, object_keys=["one"]).succeeded_count == 1
    else:
        with pytest.raises(RuntimeError):
            service.run_compare_content_remediation("source", source, "target", target, action=action, object_keys=["one"])
    expected_count = 1 if action == "delete_target_only" else 2
    assert len(clients) == expected_count - int(outcome == "target-build-failure")
    assert all(client.close_calls == 1 for client in clients)


def test_integrity_closes_client_only_after_in_flight_worker_finishes(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    class ConcurrentClient(TrackingClient):
        def paginate(self, **_kwargs):
            yield {"Contents": [{"Key": "one"}]}
            assert started.wait(5)
            raise BucketIntegrityCheckCancelled("Canceled during listing")

        def head_object(self, **_kwargs):
            started.set()
            assert release.wait(5)
            assert self.close_calls == 0
            finished.set()
            return {}

        def close(self):
            assert finished.is_set()
            super().close()

    client = ConcurrentClient()
    service = BucketIntegrityCheckService()
    monkeypatch.setattr(service, "_build_client", lambda _account: client)
    target = BucketIntegrityResolvedTarget(account=make_s3_execution_context(), bucket_name="bucket")
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(service.run, [target], BucketIntegrityOptions())
        try:
            assert started.wait(5)
            assert client.close_calls == 0
        finally:
            release.set()
        with pytest.raises(BucketIntegrityCheckCancelled):
            future.result(timeout=5)
    assert client.close_calls == 1


def test_empty_remediation_does_not_acquire_clients(monkeypatch):
    service = BucketComparisonService()
    factory = Mock(side_effect=AssertionError("No client needed"))
    monkeypatch.setattr(service, "_build_client", factory)
    account = make_s3_execution_context()

    result = service.run_compare_content_remediation("source", account, "target", account, action="sync_source_only", object_keys=[])

    assert result.planned_count == 0
    factory.assert_not_called()


@pytest.mark.parametrize("stream", [False, True], ids=["service", "sse"])
def test_usage_worker_cancellation_releases_client_without_persisting(monkeypatch, stream):
    session_factory = Mock(side_effect=AssertionError("Canceled scan must not persist"))
    service = BucketUsageStatsService(session_factory)
    client = TrackingClient(error=BucketUsageStatsCancelled("Canceled while listing"))
    monkeypatch.setattr(service, "_build_client", lambda _account: client)
    target = BucketUsageStatsResolvedTarget(
        account=make_s3_execution_context(), bucket_name="bucket", scope_kind="manager", scope_id="1",
    )

    def run(progress_callback=None, cancel_check=None):
        return service.run([target], BucketUsageStatsOptions(), progress_callback=progress_callback, cancel_check=cancel_check)

    if stream:
        async def consume():
            response = stream_bucket_usage_stats(
                SimpleNamespace(is_disconnected=lambda: asyncio.sleep(0, result=False)),
                run_check=run, logger=logging.getLogger(__name__), failure_message="Usage failed",
            )
            return "".join([chunk async for chunk in response.body_iterator])

        body = asyncio.run(consume())
        assert '"status":"canceled"' in body
        assert "event: error" not in body
        assert "event: result" not in body
    else:
        with pytest.raises(BucketUsageStatsCancelled):
            run()
    assert client.close_calls == 1
    session_factory.assert_not_called()
