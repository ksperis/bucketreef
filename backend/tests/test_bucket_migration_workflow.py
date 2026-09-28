# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock
import io
import json

import pytest
from botocore.exceptions import ClientError
from app.db import BucketMigration, BucketMigrationItem
from app.models.bucket_migration import (
    BucketMigrationCreateRequest,
    BucketMigrationBucketMapping,
)
from app.services.bucket_migration_service import BucketMigrationService
from app.services.bucket_migration.workflow import available_actions, preparation_state
from app.services.mappers.bucket_migration import bucket_migration_to_detail
from app.utils.time import utcnow
from tests.test_bucket_migration_service import (
    _create_account,
    _create_user,
    _bucket_profile_stub,
)


@pytest.fixture
def prepared(db_session):
    user = _create_user(db_session)
    source = _create_account(
        db_session,
        name="source",
        endpoint_url="https://source.example.test",
        account_id="RGW001",
    )
    target = _create_account(
        db_session,
        name="target",
        endpoint_url="https://target.example.test",
        account_id="RGW002",
    )
    db_session.commit()
    service = BucketMigrationService(db_session)
    payload = BucketMigrationCreateRequest(
        source_context_id=str(source.id),
        target_context_id=str(target.id),
        buckets=[
            BucketMigrationBucketMapping(
                source_bucket="source-bucket", target_bucket="new-bucket"
            )
        ],
    )
    migration = service.create_migration(payload, user)
    service._precheck_can_list_bucket = Mock()
    service._count_bucket_objects = Mock(return_value=1)
    service._precheck_bucket_exists = Mock(return_value=False)
    service._precheck_policy_roundtrip = Mock()
    service._precheck_destination = Mock()
    service._inspector.inspect_bucket_state = Mock(
        return_value=_bucket_profile_stub("source-bucket")
    )
    return service, migration, payload


def test_check_is_queued_persisted_and_never_starts(prepared, db_session):
    service, migration, _ = prepared
    result = service.request_precheck(migration.id)
    assert result.status == "draft"
    assert result.preparation_status == "checking"
    service._precheck_can_list_bucket.assert_not_called()
    assert (
        service.claim_next_runnable_migration_id(worker_id="copy", lease_seconds=60)
        is None
    )
    assert (
        service.claim_next_preparation_id(worker_id="check", lease_seconds=60)
        == migration.id
    )
    service.run_precheck(migration.id, worker_id="check")
    db_session.expire_all()
    detail = service.get_migration(migration.id)
    assert detail.status == "draft"
    assert detail.preparation_status == "unverified"
    service._precheck_policy_roundtrip.assert_not_called()
    service._precheck_destination.assert_not_called()
    assert not available_actions(detail)["start"]["enabled"]


def test_active_checks_require_explicit_start_and_current_revision(prepared):
    service, migration, payload = prepared
    service.run_precheck(migration.id, active_checks=True)
    assert migration.status == "draft"
    assert available_actions(migration)["start"]["enabled"]
    with pytest.raises(ValueError, match="revision"):
        service.start_migration(migration.id, configuration_revision=2)
    service.update_draft_migration(
        migration.id, payload.model_copy(update={"configuration_revision": 1})
    )
    assert migration.configuration_revision == 2
    assert migration.checked_revision is None
    assert migration.preparation_status == "stale"
    with pytest.raises(ValueError, match="active checks"):
        service.start_migration(migration.id, configuration_revision=1)


def test_expired_report_cannot_start(prepared):
    service, migration, _ = prepared
    service.run_precheck(migration.id, active_checks=True)
    migration.precheck_checked_at = utcnow() - timedelta(minutes=16)
    assert preparation_state(migration) == "stale"
    with pytest.raises(ValueError, match="active checks"):
        service.start_migration(migration.id, configuration_revision=1)


def test_immediate_copy_requires_interruption_confirmation(prepared):
    service, migration, _ = prepared
    migration.mode = "one_shot"
    service.run_precheck(migration.id, active_checks=True)
    with pytest.raises(ValueError, match="interruption"):
        service.start_migration(migration.id, configuration_revision=1)
    assert migration.status == "draft"
    assert (
        service.start_migration(
            migration.id, configuration_revision=1, confirm_write_interruption=True
        ).status
        == "queued"
    )


def test_existing_destination_blocks_instead_of_skipping(prepared):
    service, migration, _ = prepared
    service._precheck_bucket_exists.return_value = True
    service.run_precheck(migration.id, active_checks=True)
    assert migration.preparation_status == "blocked"
    report = json.loads(migration.precheck_report_json)
    check = next(
        entry
        for entry in report["items"][0]["checks"]
        if entry["code"] == "target_exists"
    )
    assert check["blocking"] is True
    assert check["remediation"] == "Choose a new destination name."
    assert migration.items[0].status == "pending"


def test_destination_checks_run_without_write_lock(prepared):
    service, migration, _ = prepared
    migration.lock_target_writes = False
    service.run_precheck(migration.id, active_checks=True)
    service._precheck_destination.assert_called_once()


def test_changed_destination_blocks_start(prepared):
    service, migration, _ = prepared
    service.run_precheck(migration.id, active_checks=True)
    service._precheck_bucket_exists.return_value = True
    with pytest.raises(ValueError, match="already exists"):
        service.start_migration(migration.id, configuration_revision=1)
    assert migration.status == "draft"


def test_same_endpoint_copy_aggregates_success(prepared):
    service, migration, _ = prepared
    migration.use_same_endpoint_copy = True
    service._is_same_endpoint = Mock(return_value=True)
    service._precheck_same_endpoint_copy_source_access = Mock(return_value="validated")
    service.run_precheck(migration.id, active_checks=True)
    assert json.loads(migration.precheck_report_json)["same_endpoint_copy_safe"] is True


def test_source_deletion_cannot_be_requested_in_configuration(prepared):
    _, _, payload = prepared
    with pytest.raises(ValueError, match="separate operation"):
        BucketMigrationCreateRequest(**{**payload.model_dump(), "delete_source": True})


@pytest.mark.parametrize(
    "name",
    [
        "UPPER",
        "a",
        "has space",
        "bad..dots",
        "1.2.3.4",
        "bad-",
        "xn--reserved",
        "x" * 64,
    ],
)
def test_invalid_destinations_rejected_by_backend(prepared, name):
    service, _, payload = prepared
    payload.buckets[0].target_bucket = name
    with pytest.raises(ValueError, match="Invalid destination"):
        service._build_bucket_mappings(payload)


def test_content_and_tag_access_are_checked_without_trimming(prepared):
    service, _, _ = prepared
    client = Mock()
    client.list_objects_v2.return_value = {"Contents": [{"Key": " key "}]}
    client.get_object.return_value = {"Body": io.BytesIO(b"content")}
    client.get_object_tagging.side_effect = ClientError(
        {"Error": {"Code": "AccessDenied"}}, "GetObjectTagging"
    )
    service._context_client = Mock(return_value=client)
    with pytest.raises(RuntimeError, match="GetObjectTagging"):
        BucketMigrationService._precheck_can_list_bucket(
            service, SimpleNamespace(), "source-bucket"
        )
    client.get_object.assert_called_once_with(Bucket="source-bucket", Key=" key ")
    client.get_object_tagging.assert_called_once_with(
        Bucket="source-bucket", Key=" key "
    )


def test_forbidden_destination_is_unknown_not_absent(prepared):
    service, _, _ = prepared
    client = Mock()
    client.head_bucket.side_effect = ClientError(
        {
            "Error": {"Code": "AccessDenied"},
            "ResponseMetadata": {"HTTPStatusCode": 403},
        },
        "HeadBucket",
    )
    client.list_buckets.return_value = {"Buckets": []}
    service._context_client = Mock(return_value=client)
    assert (
        BucketMigrationService._precheck_bucket_exists(
            service, SimpleNamespace(), "other-bucket"
        )
        is None
    )


def test_policy_intent_precedes_mutation_and_survives_interruption(
    prepared, db_session
):
    service, migration, _ = prepared
    item = migration.items[0]
    service._preparation_item = item
    policy = {"Version": "2012-10-17", "Statement": []}
    configuration = Mock()
    configuration.get_policy.return_value = policy

    def interrupted(*args):
        durable = (
            db_session.query(BucketMigrationItem.preparation_effects_json)
            .filter_by(id=item.id)
            .scalar()
        )
        assert json.loads(durable)["source_policy"]["policy"] == policy
        raise KeyboardInterrupt("process interrupted")

    configuration.put_policy.side_effect = interrupted
    service._configuration = configuration
    with pytest.raises(KeyboardInterrupt):
        BucketMigrationService._precheck_policy_roundtrip(
            service, object(), item.source_bucket
        )
    assert item.preparation_effects_json
    configuration.put_policy.side_effect = None
    service._recover_preparation_effects(migration)
    assert item.preparation_effects_json is None
    configuration.put_policy.assert_called_with(
        item.source_bucket,
        service._resolve_context(migration.source_context_id).account,
        policy,
    )


def test_failed_restoration_blocks_checks_edits_and_start(prepared):
    service, migration, payload = prepared
    item = migration.items[0]
    item.preparation_effects_json = json.dumps(
        {
            "source_policy": {
                "bucket": item.source_bucket,
                "context_id": migration.source_context_id,
                "policy": None,
            }
        }
    )
    service._configuration.delete_policy = Mock(
        side_effect=RuntimeError("AccessDenied token=do-not-leak")
    )
    service._commit()
    service.run_precheck(migration.id, active_checks=True)
    assert migration.preparation_status == "blocked"
    assert "do-not-leak" not in migration.error_message
    assert available_actions(migration)["restore_access"]["enabled"]
    with pytest.raises(ValueError):
        service.update_draft_migration(
            migration.id, payload.model_copy(update={"configuration_revision": 1})
        )
    with pytest.raises(ValueError):
        service.start_migration(migration.id, configuration_revision=1)
    assert item.preparation_effects_json


def test_stale_worker_cannot_publish_ready(prepared):
    service, migration, _ = prepared
    service.request_precheck(migration.id, active_checks=True)
    service.claim_next_preparation_id(worker_id="owner", lease_seconds=60)
    with pytest.raises(RuntimeError, match="lease"):
        service.run_precheck(migration.id, worker_id="other")
    assert service.get_migration(migration.id).checked_revision is None


def test_created_destination_provenance_allows_retry_only_for_own_bucket(prepared):
    service, migration, _ = prepared
    service.run_precheck(migration.id, active_checks=True)
    service._precheck_bucket_exists.return_value = True
    with pytest.raises(ValueError, match="already exists"):
        service._revalidate_transfer_preconditions(migration)
    migration.items[0].target_created_by_migration = True
    service._revalidate_transfer_preconditions(migration)


def test_current_only_start_does_not_require_version_content_permissions(prepared):
    service, migration, _ = prepared
    service.run_precheck(migration.id, active_checks=True)
    service._precheck_version_aware_source_access = Mock(
        side_effect=RuntimeError("version reads denied")
    )
    service.start_migration(migration.id, configuration_revision=1)
    assert migration.status == "queued"
    service._precheck_version_aware_source_access.assert_not_called()


def test_cleanup_failure_preserves_verified_transfer(prepared):
    service, migration, _ = prepared
    migration.status = "completed"
    item = migration.items[0]
    item.status = "completed"
    item.read_only_applied = True
    item.target_created_by_migration = True
    service._commit()
    service._cleanup_verified_source = Mock(side_effect=RuntimeError("cleanup denied"))
    service.request_maintenance(
        migration.id, operation="cleanup_source", confirmed=True
    )
    service.run_maintenance(migration.id)
    assert migration.status == "completed"
    assert item.status == "completed"
    assert item.cleanup_status == "failed"
    assert migration.maintenance_status == "failed"
    assert not item.source_deleted


def test_access_recovery_resolves_restoration_failure_after_source_deletion(prepared):
    service, migration, _ = prepared
    migration.status = "completed"
    item = migration.items[0]
    item.status = "completed"
    item.source_deleted = True
    item.target_lock_applied = True
    item.cleanup_status = "failed"
    item.cleanup_error = "Could not restore destination policy"
    service._configuration.get_policy = Mock(return_value=None)
    service._configuration.delete_policy = Mock()
    service._commit()
    service.request_maintenance(
        migration.id, operation="restore_access", confirmed=True
    )
    service.run_maintenance(migration.id)
    assert migration.status == item.status == "completed"
    assert migration.maintenance_status == "completed"
    assert item.cleanup_status == "completed" and item.cleanup_error is None
    assert item.source_deleted and not item.target_lock_applied


def test_empty_source_does_not_claim_content_and_tag_checks_passed(prepared):
    service, migration, _ = prepared
    service._precheck_can_list_bucket.return_value = False
    service._count_bucket_objects.return_value = 0
    service.run_precheck(migration.id, active_checks=False)
    checks = json.loads(migration.precheck_report_json)["items"][0]["checks"]
    diagnostic = next(
        check for check in checks if check["code"] == "source_object_reads_not_tested"
    )
    assert diagnostic["severity"] == "warning"
    assert "unverified" in diagnostic["message"]


def test_source_cleanup_requires_confirmation_and_fresh_strong_verification(prepared):
    service, migration, _ = prepared
    migration.status = "completed"
    item = migration.items[0]
    item.status = "completed"
    item.read_only_applied = True
    item.target_created_by_migration = True
    service._commit()
    with pytest.raises(ValueError, match="confirm"):
        service.request_maintenance(
            migration.id, operation="cleanup_source", confirmed=False
        )
    service._apply_target_write_lock_policy = Mock()
    service._apply_read_only_policy = Mock()
    service._cleanup_fingerprint = Mock(side_effect=["destination", "different-source"])
    service._delete_maintenance_bucket = Mock()
    service.request_maintenance(
        migration.id, operation="cleanup_source", confirmed=True
    )
    service.run_maintenance(migration.id)
    service._delete_maintenance_bucket.assert_not_called()
    assert item.status == "completed"
    assert "SHA-256" in item.cleanup_error


def test_fingerprint_detects_tag_changes_and_preserves_exact_identity(prepared):
    service, _, _ = prepared
    service._iter_bucket_objects = Mock(return_value=[SimpleNamespace(key=" key ")])
    client = Mock()
    client.get_object_tagging.return_value = {
        "TagSet": [{"Key": " tag ", "Value": " value "}]
    }
    service._context_client = Mock(return_value=client)
    service._stream_object_sha256 = Mock(return_value="same-content")
    first = service._cleanup_fingerprint(
        object(), "bucket", strategy="current_only", check=lambda: "run"
    )
    client.get_object_tagging.assert_called_with(Bucket="bucket", Key=" key ")
    client.get_object_tagging.return_value = {
        "TagSet": [{"Key": "tag", "Value": "value"}]
    }
    second = service._cleanup_fingerprint(
        object(), "bucket", strategy="current_only", check=lambda: "run"
    )
    assert first != second


def test_cleanup_target_keeps_success_and_source_protection(prepared):
    service, migration, _ = prepared
    migration.status = "completed_with_errors"
    failed = migration.items[0]
    failed.status = "failed"
    failed.target_created_by_migration = True
    failed.read_only_applied = True
    complete = BucketMigrationItem(
        source_bucket="complete",
        target_bucket="complete-copy",
        status="completed",
        target_created_by_migration=True,
    )
    migration.items.append(complete)
    service._apply_target_write_lock_policy = Mock()
    service._delete_maintenance_bucket = Mock()
    service._commit()
    service.request_maintenance(
        migration.id, operation="cleanup_target", confirmed=True
    )
    service.run_maintenance(migration.id)
    assert complete.status == "completed" and complete.target_created_by_migration
    assert failed.read_only_applied is True
    assert failed.step == "create_bucket"
    assert not failed.target_created_by_migration
    service._delete_maintenance_bucket.assert_called_once()


def test_partial_retry_does_not_reset_successful_items(prepared):
    service, migration, _ = prepared
    service.run_precheck(migration.id, active_checks=True)
    migration.status = "completed_with_errors"
    migration.items[0].status = "failed"
    complete = BucketMigrationItem(
        source_bucket="done",
        target_bucket="done-copy",
        status="completed",
        step="completed",
        objects_copied=42,
    )
    migration.items.append(complete)
    service._commit()
    service.retry_failed_items(migration.id)
    assert complete.status == "completed"
    assert complete.objects_copied == 42
    assert migration.items[0].status == "pending"


def test_cutover_is_explicit_and_never_sets_auto_deletion(prepared):
    service, migration, _ = prepared
    service.run_precheck(migration.id, active_checks=True)
    migration.status = "awaiting_cutover"
    migration.items[0].status = "awaiting_cutover"
    service._commit()
    with pytest.raises(ValueError, match="Confirm"):
        service.continue_after_presync(migration.id)
    service.continue_after_presync(migration.id, confirmed=True)
    assert migration.items[0].step == "apply_read_only"
    assert not migration.delete_source


def test_maintenance_result_and_actions_are_exposed_without_policy_backups(prepared):
    service, migration, _ = prepared
    migration.items[0].preparation_effects_json = (
        '{"internal": {"policy": "not-public"}}'
    )
    detail = bucket_migration_to_detail(
        migration, items=migration.items, recent_events=[]
    ).model_dump_json()
    assert '"recovery_required":true' in detail
    assert '"restore_access"' in detail
    assert "not-public" not in detail


def test_new_source_versioning_blocks_a_previously_valid_plan(prepared):
    service, migration, _ = prepared
    service.run_precheck(migration.id, active_checks=True)
    changed = _bucket_profile_stub("source-bucket")
    changed["versioning"] = {"enabled": True, "status": "Enabled", "suspended": False}
    service._inspector.inspect_bucket_state.return_value = changed
    with pytest.raises(ValueError, match="versioning changed"):
        service.start_migration(migration.id, configuration_revision=1)
    assert migration.status == "draft"


def test_diagnostics_identify_permission_identity_and_remediation(prepared):
    from app.services.bucket_migration.diagnostics import MigrationPermissionCheckError

    service, migration, _ = prepared
    service._precheck_can_list_bucket.side_effect = MigrationPermissionCheckError(
        "Cannot read source object tags.",
        "s3:GetObjectTagging",
        RuntimeError("token=secret-value"),
    )
    service.run_precheck(migration.id)
    check = json.loads(migration.precheck_report_json)["items"][0]["checks"][0]
    assert check["permission"] == "s3:GetObjectTagging"
    assert check["context_id"] == migration.source_context_id
    assert check["bucket"] == "source-bucket"
    assert "s3:GetObjectTagging" in check["remediation"]
    assert "secret-value" not in json.dumps(check)


def test_operator_revocation_keeps_preparation_as_draft(prepared):
    service, migration, _ = prepared
    service.request_precheck(migration.id)
    service._creator_allowed_context_ids = Mock(return_value=set())
    service.run_precheck(migration.id)
    assert migration.status == "draft"
    assert migration.preparation_status == "blocked"
    assert "revoked" in migration.error_message


def test_concurrent_editor_cannot_overwrite_a_saved_revision(prepared, db_session):
    from sqlalchemy.orm import Session

    service, migration, payload = prepared
    with Session(db_session.get_bind(), autoflush=False) as other_db:
        other = BucketMigrationService(other_db)
        stale = other.get_migration(migration.id)
        service.update_draft_migration(
            migration.id, payload.model_copy(update={"configuration_revision": 1})
        )
        assert stale.configuration_revision == 1
        with pytest.raises(ValueError, match="changed"):
            other.update_draft_migration(
                migration.id, payload.model_copy(update={"configuration_revision": 1})
            )
    assert service.get_migration(migration.id).configuration_revision == 2


def test_stop_cannot_interrupt_preparation_or_cleanup(prepared):
    service, migration, _ = prepared
    service.request_precheck(migration.id)
    with pytest.raises(ValueError, match="no active transfer"):
        service.stop_migration(migration.id)
    assert migration.status == "draft" and migration.preparation_status == "checking"


def test_active_destination_probe_exercises_multipart_tags_and_cleanup(prepared):
    service, migration, _ = prepared
    item = migration.items[0]
    migration.lock_target_writes = False
    source = service._resolve_context(migration.source_context_id)
    target = service._resolve_context(migration.target_context_id)
    client = Mock()
    client.put_object.return_value = {}
    client.get_object.return_value = {"Body": io.BytesIO(b"test")}
    client.create_multipart_upload.return_value = {"UploadId": "upload"}
    client.upload_part.return_value = {"ETag": "etag"}
    service._context_client = Mock(return_value=client)
    service._precheck_bucket_exists = Mock(side_effect=[True, False])
    service._buckets.create_bucket = Mock(
        side_effect=lambda *args, **kwargs: item.preparation_effects_json
        or pytest.fail("Intent was not saved")
    )
    service._buckets.delete_bucket = Mock()
    BucketMigrationService._precheck_destination(
        service, migration, item, source, target, strategy="current_only"
    )
    assert item.preparation_effects_json is None
    client.put_object_tagging.assert_called_once()
    client.get_object_tagging.assert_called_once()
    client.complete_multipart_upload.assert_called_once()
    client.abort_multipart_upload.assert_called_once()
    service._buckets.delete_bucket.assert_called_once()


def test_probe_interruption_leaves_durable_cleanup_intent(prepared):
    service, migration, _ = prepared
    item = migration.items[0]
    migration.lock_target_writes = False
    service._buckets.create_bucket = Mock(side_effect=KeyboardInterrupt())
    source = service._resolve_context(migration.source_context_id)
    target = service._resolve_context(migration.target_context_id)
    with pytest.raises(KeyboardInterrupt):
        BucketMigrationService._precheck_destination(
            service, migration, item, source, target, strategy="current_only"
        )
    effect = json.loads(item.preparation_effects_json)["probe_bucket"]
    assert effect["bucket"].startswith("bucketreef-mig-precheck-")
    service._precheck_bucket_exists = Mock(side_effect=[True, False])
    service._buckets.delete_bucket = Mock()
    service._recover_preparation_effects(migration)
    assert item.preparation_effects_json is None


def test_probe_cleanup_unknown_state_keeps_recovery_record(prepared):
    service, migration, _ = prepared
    item = migration.items[0]
    item.preparation_effects_json = json.dumps(
        {
            "probe_bucket": {
                "context_id": migration.target_context_id,
                "bucket": "temporary-bucket",
            }
        }
    )
    service._precheck_bucket_exists = Mock(side_effect=[True, True])
    service._buckets.delete_bucket = Mock()
    with pytest.raises(RuntimeError, match="removal could not be verified"):
        service._recover_preparation_effects(migration)
    assert item.preparation_effects_json is not None


def test_finished_cutover_does_not_wait_for_another_cutover(prepared):
    service, migration, _ = prepared
    migration.status = "running"
    migration.items[0].status = "completed"
    service._finalize_or_wait_cutover(migration)
    assert migration.status == "completed"


def test_partial_precopy_preserves_successful_destination_lock(prepared):
    service, migration, _ = prepared
    migration.status = "running"
    migration.items[0].status = "awaiting_cutover"
    migration.items[0].target_lock_applied = True
    migration.items.append(
        BucketMigrationItem(
            source_bucket="failed-source",
            target_bucket="failed-target",
            status="failed",
        )
    )
    service._commit()
    service._restore_target_write_lock_policy = Mock()
    service._finalize_or_wait_cutover(
        migration, target_ctx=service._resolve_context(migration.target_context_id)
    )
    assert migration.status == "completed_with_errors"
    assert migration.items[0].target_lock_applied is True
    service._restore_target_write_lock_policy.assert_not_called()


def test_verified_source_cleanup_keeps_receipt_before_destructive_call(prepared):
    service, migration, _ = prepared
    item = migration.items[0]
    migration.status = "completed"
    item.status = "completed"
    item.read_only_applied = True
    item.target_created_by_migration = True
    service._commit()
    service._apply_target_write_lock_policy = Mock()
    service._apply_read_only_policy = Mock()
    service._configuration.put_policy = Mock()
    service._restore_checked_policy = Mock()
    service._cleanup_fingerprint = Mock(return_value="verified-sha256")
    service._precheck_bucket_exists = Mock(side_effect=[True, False])

    def delete(context, bucket, check):
        assert (
            json.loads(item.cleanup_verification_json)["target_sha256"]
            == "verified-sha256"
        )
        policy = service._configuration.put_policy.call_args.args[2]
        delete_rule = policy["Statement"][-1]
        assert "s3:DeleteObject" in delete_rule["Action"]
        assert "aws:UserAgent" in delete_rule["Condition"]["StringNotLike"]

    service._delete_maintenance_bucket = Mock(side_effect=delete)
    service.request_maintenance(
        migration.id, operation="cleanup_source", confirmed=True
    )
    service.run_maintenance(migration.id)
    assert item.source_deleted and item.status == "completed"
    assert (
        migration.status == "completed" and migration.maintenance_status == "completed"
    )
    assert not item.read_only_applied and not item.target_lock_applied
    assert all(
        call.kwargs["strategy"] == "version_aware"
        for call in service._cleanup_fingerprint.call_args_list
    )


def test_partial_source_cleanup_blocks_when_protection_was_changed(prepared):
    service, migration, _ = prepared
    item = migration.items[0]
    migration.status = item.status = "completed"
    item.read_only_applied = item.target_created_by_migration = True
    item.cleanup_verification_json = json.dumps({"target_sha256": "verified"})
    service._apply_target_write_lock_policy = Mock()
    service._cleanup_fingerprint = Mock(return_value="verified")
    service._precheck_bucket_exists = Mock(return_value=True)
    service._configuration.get_policy = Mock(return_value=None)
    service._delete_maintenance_bucket = Mock()
    service._commit()
    service.request_maintenance(
        migration.id, operation="cleanup_source", confirmed=True
    )
    service.run_maintenance(migration.id)
    assert migration.maintenance_status == "failed"
    assert "protection changed" in item.cleanup_error
    service._delete_maintenance_bucket.assert_not_called()


def test_stale_worker_cannot_fail_another_workers_job(prepared):
    service, migration, _ = prepared
    migration.worker_lease_owner = "current-owner"
    service._commit()
    service.fail_migration_fatal(
        migration.id, error=RuntimeError("stale"), worker_id="former-owner"
    )
    assert migration.status == "draft"
    assert migration.worker_lease_owner == "current-owner"


def test_expired_recovery_worker_cannot_clear_replacement_lease(prepared):
    service, migration, _ = prepared
    item = migration.items[0]
    migration.status = item.status = "completed"
    item.read_only_applied = True
    service._commit()
    service.request_maintenance(
        migration.id, operation="restore_access", confirmed=True
    )
    service.claim_next_runnable_migration_id(worker_id="former-owner", lease_seconds=60)

    def lose_lease(*args, **kwargs):
        migration.worker_lease_owner = "replacement-owner"
        service._commit()
        return ["lease lost"]

    service._release_source_read_only_policies = Mock(side_effect=lose_lease)
    with pytest.raises(RuntimeError, match="lease"):
        service.run_maintenance(migration.id, worker_id="former-owner")
    service.db.rollback()
    service.db.refresh(migration)
    assert migration.worker_lease_owner == "replacement-owner"
    assert migration.maintenance_status == "running"


def test_precheck_api_returns_202_and_result_survives_reopen(
    prepared, client, monkeypatch
):
    from app.main import app
    from app.routers import dependencies
    from tests.test_manager_migrations_permissions import _override_migration_scope

    service, migration, _ = prepared
    _override_migration_scope(
        user_id=migration.created_by_user_id,
        allowed_context_ids={migration.source_context_id, migration.target_context_id},
    )
    monkeypatch.setattr(
        "app.routers.manager.migrations_definition._worker_wake_up", lambda: None
    )
    try:
        response = client.post(
            f"/api/manager/migrations/{migration.id}/precheck",
            json={"active_checks": False},
        )
        assert response.status_code == 202
        assert response.json()["status"] == "draft"
        assert (
            client.get(f"/api/manager/migrations/{migration.id}").json()[
                "preparation_status"
            ]
            == "checking"
        )
        service.run_precheck(migration.id)
        reopened = client.get(f"/api/manager/migrations/{migration.id}").json()
        assert reopened["status"] == "draft"
        assert reopened["preparation_status"] == "unverified"
        assert reopened["precheck_report"]["configuration_revision"] == 1
        assert not reopened["available_actions"]["start"]["enabled"]
    finally:
        app.dependency_overrides.pop(
            dependencies.get_current_bucket_migration_scope, None
        )
