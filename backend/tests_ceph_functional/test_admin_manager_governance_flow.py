# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

import pytest

from .clients import BackendSession
from .clients import BackendAPIError
from .config import CephTestSettings
from .resources import ResourceTracker
from .test_browser_clipboard_flow import _upload_bytes
from .test_bucket_configuration_flow import (
    _bucket_name,
    _create_bucket,
    _delete_bucket,
    _wait_for_value,
)


pytestmark = pytest.mark.ceph_functional


def _actions(payload: dict) -> set[str]:
    return {str(entry.get("action") or "") for entry in payload.get("logs", [])}


def _manager_actions(session: BackendSession, account_id: int, search: str) -> set[str]:
    entries = session.get(
        "/manager/activity",
        params={"context_id": account_id, "search": search, "limit": 20},
    )
    return {str(entry.get("action") or "") for entry in entries}


def test_manager_iam_key_metadata_and_audit(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    super_admin_session: BackendSession,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id
    user_name = f"{ceph_test_settings.test_prefix}-iam-deep-{uuid.uuid4().hex[:8]}"
    inline_policy_name = "FunctionalUserInlineAccess"

    account_before = super_admin_session.get(f"/admin/accounts/{account_id}")
    original_overrides = {
        "allow_access_key_metadata": account_before.get("allow_access_key_metadata"),
        "allow_access_key_expiration": account_before.get("allow_access_key_expiration"),
        "allow_activity_history": account_before.get("allow_activity_history"),
    }
    super_admin_session.put(
        f"/admin/accounts/{account_id}",
        json={
            "allow_access_key_metadata": True,
            "allow_access_key_expiration": True,
            "allow_activity_history": True,
        },
    )

    created_key_id: str | None = None
    try:
        created_user = manager_session.post(
            "/manager/iam/users",
            params={"context_id": account_id},
            json={"name": user_name, "create_key": False},
            expected_status=201,
        )
        assert created_user["name"] == user_name
        assert created_user.get("has_keys") is False

        updated_user = manager_session.put(
            f"/manager/iam/users/{user_name}",
            params={"context_id": account_id},
            json={"path": "/functional/"},
        )
        assert updated_user["path"] == "/functional/"

        inline_document = {
            "Version": "2012-10-17",
            "Statement": [{"Effect": "Allow", "Action": ["s3:ListAllMyBuckets"], "Resource": ["*"]}],
        }
        saved_inline = manager_session.put(
            f"/manager/iam/users/{user_name}/inline-policies/{inline_policy_name}",
            params={"context_id": account_id},
            json={"name": inline_policy_name, "document": inline_document},
        )
        assert saved_inline["name"] == inline_policy_name
        assert saved_inline["document"] == inline_document
        listed_inline = manager_session.get(
            f"/manager/iam/users/{user_name}/inline-policies",
            params={"context_id": account_id},
        )
        assert any(entry["name"] == inline_policy_name for entry in listed_inline)

        expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).replace(microsecond=0).isoformat()
        created_key = manager_session.post(
            f"/manager/iam/users/{user_name}/keys",
            params={"context_id": account_id},
            json={
                "name": "functional-primary",
                "notes": "Ceph functional IAM qualification",
                "expires_at": expires_at,
            },
            expected_status=201,
        )
        created_key_id = str(created_key["access_key_id"])
        assert created_key.get("secret_access_key"), "New IAM access key must expose its secret once"
        assert created_key["name"] == "functional-primary"
        assert created_key["notes"] == "Ceph functional IAM qualification"

        listed_keys = manager_session.get(
            f"/manager/iam/users/{user_name}/keys",
            params={"context_id": account_id},
        )
        listed_key = next(entry for entry in listed_keys if entry["access_key_id"] == created_key_id)
        assert not listed_key.get("secret_access_key"), "IAM key listing must not reveal stored secrets"
        assert listed_key["name"] == "functional-primary"
        assert listed_key["notes"] == "Ceph functional IAM qualification"

        updated_metadata = manager_session.put(
            f"/manager/iam/users/{user_name}/keys/{created_key_id}/metadata",
            params={"context_id": account_id},
            json={"name": "functional-renamed", "notes": "metadata roundtrip", "expires_at": expires_at},
        )
        assert updated_metadata["name"] == "functional-renamed"
        assert updated_metadata["notes"] == "metadata roundtrip"

        inactive = manager_session.put(
            f"/manager/iam/users/{user_name}/keys/{created_key_id}/status",
            params={"context_id": account_id},
            json={"active": False},
        )
        assert str(inactive.get("status") or "").lower() == "inactive"
        active = manager_session.put(
            f"/manager/iam/users/{user_name}/keys/{created_key_id}/status",
            params={"context_id": account_id},
            json={"active": True},
        )
        assert str(active.get("status") or "").lower() == "active"

        audit = super_admin_session.get(
            "/admin/audit/logs",
            params={
                "scope": "manager",
                "context_kind": "account",
                "context_id": str(account_id),
                "limit": 200,
            },
        )
        expected_actions = {
            "create_iam_user",
            "update_iam_user",
            "put_user_inline_policy",
            "create_access_key",
            "update_access_key_metadata",
            "update_access_key_status",
        }
        assert expected_actions <= _actions(audit)
        activity_actions = _manager_actions(manager_session, account_id, user_name)
        assert {"create_iam_user", "update_iam_user", "put_user_inline_policy", "create_access_key"} <= activity_actions
    finally:
        try:
            manager_session.delete(
                f"/manager/iam/users/{user_name}/inline-policies/{inline_policy_name}",
                params={"context_id": account_id},
                expected_status=(204, 404),
            )
        except BackendAPIError:
            pass
        if created_key_id:
            try:
                manager_session.delete(
                    f"/manager/iam/users/{user_name}/keys/{created_key_id}",
                    params={"context_id": account_id},
                    expected_status=(204, 404),
                )
            except BackendAPIError:
                pass
        try:
            manager_session.delete(
                f"/manager/iam/users/{user_name}",
                params={"context_id": account_id},
                expected_status=(204, 404),
            )
        except BackendAPIError:
            pass
        super_admin_session.put(f"/admin/accounts/{account_id}", json=original_overrides)


def test_manager_iam_role_tags_detect_storage_backend_false_success(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id
    role_name = f"{ceph_test_settings.test_prefix}-role-tags-{uuid.uuid4().hex[:8]}"
    role_created = False

    try:
        role = manager_session.post(
            "/manager/iam/roles",
            params={"context_id": account_id},
            json={
                "name": role_name,
                "path": "/functional/",
                "assume_role_policy_document": {
                    "Version": "2012-10-17",
                    "Statement": [{"Effect": "Allow", "Principal": {"AWS": "*"}, "Action": "sts:AssumeRole"}],
                },
            },
            expected_status=201,
        )
        role_created = True
        assert role["name"] == role_name

        try:
            tags = manager_session.put(
                f"/manager/iam/roles/{role_name}/tags",
                params={"context_id": account_id},
                json=[
                    {"key": "environment", "value": "functional"},
                    {"key": "suite", "value": "ceph"},
                ],
            )
        except BackendAPIError as exc:
            detail = str((exc.payload or {}).get("detail") if isinstance(exc.payload, dict) else exc.payload or "")
            if exc.status_code == 502 and "did not persist on the storage backend" in detail:
                pytest.skip(f"Ceph RGW role tags are not mutation-safe on this cluster: {detail}")
            raise

        assert {(entry["key"], entry["value"]) for entry in tags} >= {
            ("environment", "functional"),
            ("suite", "ceph"),
        }
        try:
            tags_after_delete = manager_session.delete(
                f"/manager/iam/roles/{role_name}/tags/suite",
                params={"context_id": account_id},
                expected_status=200,
            )
        except BackendAPIError as exc:
            detail = str((exc.payload or {}).get("detail") if isinstance(exc.payload, dict) else exc.payload or "")
            if exc.status_code == 502 and "did not persist on the storage backend" in detail:
                pytest.skip(f"Ceph RGW role tag deletion is not mutation-safe on this cluster: {detail}")
            raise
        assert "suite" not in {entry["key"] for entry in tags_after_delete}
    finally:
        if role_created:
            try:
                manager_session.delete(
                    f"/manager/iam/roles/{role_name}",
                    params={"context_id": account_id},
                    expected_status=(204, 404),
                )
            except Exception:
                pass


def test_admin_manager_stats_access_and_bucket_audit(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id
    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "admin-stats-audit")
    object_key = "stats/functional.bin"
    payload = (b"bucketreef-functional-stats-" * 16) + b"end"

    _create_bucket(manager_session, account_id, bucket_name, versioning=False)
    resource_tracker.track_bucket(account_id, bucket_name)
    try:
        _upload_bytes(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            payload,
            content_type="application/octet-stream",
        )
        manager_session.put(
            f"/manager/buckets/{bucket_name}/versioning",
            params={"context_id": account_id},
            json={"enabled": True},
        )

        bucket_stats = _wait_for_value(
            "manager bucket statistics",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/stats",
                params={"context_id": account_id},
            ),
            lambda current: int(current.get("object_count") or 0) >= 1
            and int(current.get("used_bytes") or 0) >= len(payload),
            timeout=20.0,
        )

        manager_overview = _wait_for_value(
            "manager statistics overview",
            lambda: manager_session.get("/manager/stats/overview", params={"context_id": account_id}),
            lambda current: any(
                entry.get("name") == bucket_name and int(entry.get("object_count") or 0) >= 1
                for entry in current.get("bucket_usage", [])
            ),
            timeout=20.0,
        )
        manager_bucket = next(entry for entry in manager_overview["bucket_usage"] if entry["name"] == bucket_name)
        assert manager_bucket["object_count"] == bucket_stats["object_count"]
        assert manager_bucket["used_bytes"] == bucket_stats["used_bytes"]

        admin_account_stats = _wait_for_value(
            "admin account statistics",
            lambda: super_admin_session.get("/admin/stats/account", params={"account_id": account_id}),
            lambda current: any(
                entry.get("name") == bucket_name and int(entry.get("object_count") or 0) >= 1
                for entry in current.get("bucket_usage", [])
            ),
            timeout=20.0,
        )
        admin_bucket = next(entry for entry in admin_account_stats["bucket_usage"] if entry["name"] == bucket_name)
        assert admin_bucket["object_count"] == manager_bucket["object_count"]
        assert admin_bucket["used_bytes"] == manager_bucket["used_bytes"]
        assert admin_account_stats["total_objects"] == manager_overview["total_objects"]
        assert admin_account_stats["total_bytes"] == manager_overview["total_bytes"]
        assert admin_account_stats["total_buckets"] == manager_overview["total_buckets"]

        account_detail = super_admin_session.get(
            f"/admin/accounts/{account_id}",
            params={"include_usage": "true"},
        )
        assert account_detail["bucket_count"] == manager_overview["total_buckets"]
        assert account_detail["used_objects"] == manager_overview["total_objects"]
        assert account_detail["used_bytes"] == manager_overview["total_bytes"]

        summary = super_admin_session.get("/admin/stats/summary")
        assert summary["total_accounts"] >= 1
        assert summary["assigned_accounts"] >= 1
        assert summary["total_endpoints"] >= 1
        assert summary["total_active_sessions"] >= 1

        dashboard_scope = super_admin_session.get("/admin/stats/dashboard/scope")
        assert any(
            int(endpoint["endpoint_id"]) == int(account_detail["storage_endpoint_id"])
            for endpoint in dashboard_scope["endpoints"]
        )
        dashboard_storage = super_admin_session.get("/admin/stats/dashboard/storage")
        assert dashboard_storage["coverage"]["eligible_count"] >= 1
        assert dashboard_storage["coverage"]["contributing_count"] >= 1
        assert dashboard_storage["storage_totals"]["bucket_count"] is not None
        assert dashboard_storage["storage_totals"]["object_count"] is not None
        dashboard_traffic = super_admin_session.get("/admin/stats/dashboard/traffic")
        assert dashboard_traffic["window"] == "day"
        assert dashboard_traffic["coverage"]["eligible_count"] >= 1
        assert isinstance(dashboard_traffic["series"], list)

        access_audit = super_admin_session.get(
            "/admin/access-audit",
            params={
                "page": 1,
                "page_size": 200,
                "scope": "rgw_account",
                "user_id": provisioned_account.manager_user_id,
                "target_id": account_id,
            },
        )
        access_row = next(
            entry
            for entry in access_audit["items"]
            if int(entry["principal"]["id"]) == provisioned_account.manager_user_id
            and int(entry["target"]["id"]) == account_id
        )
        rights = {right["code"] for right in access_row["rights"]}
        assert {"account_administrator", "manager_browser_data_access"} <= rights

        manager_audit = super_admin_session.get(
            "/admin/audit/logs",
            params={
                "scope": "manager",
                "context_kind": "account",
                "context_id": str(account_id),
                "search": bucket_name,
                "limit": 100,
            },
        )
        manager_actions = _actions(manager_audit)
        assert {"create_bucket", "update_bucket_versioning"} <= manager_actions
        assert all(entry["context_name"] == provisioned_account.account_name for entry in manager_audit["logs"])
        assert all(entry["user_email"] == provisioned_account.manager_email for entry in manager_audit["logs"])

        activity_actions = _manager_actions(manager_session, account_id, bucket_name)
        assert {"create_bucket", "update_bucket_versioning"} <= activity_actions

        original_activity_override = account_detail.get("allow_activity_history")
        super_admin_session.put(
            f"/admin/accounts/{account_id}",
            json={"allow_activity_history": False},
        )
        try:
            admin_audit = super_admin_session.get(
                "/admin/audit/logs",
                params={
                    "scope": "admin",
                    "context_kind": "account",
                    "context_id": str(account_id),
                    "search": "update_account",
                    "limit": 20,
                },
            )
            update_entry = next(entry for entry in admin_audit["logs"] if entry["action"] == "update_account")
            assert update_entry["entity_type"] == "account"
            assert update_entry["entity_id"] == str(account_id)
            assert update_entry["metadata"]["allow_activity_history"] is False
        finally:
            super_admin_session.put(
                f"/admin/accounts/{account_id}",
                json={"allow_activity_history": original_activity_override},
            )
    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)
