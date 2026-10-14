# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import io
import uuid
from typing import Any

import boto3
import pytest
from botocore.client import Config

from app.services.managed_resource_naming import portal_access_log_bucket_name

from .clients import BackendAuthenticator, BackendSession, CephVerifier
from .config import CephTestSettings
from .resources import ResourceTracker


pytestmark = pytest.mark.ceph_functional


def _account_id() -> str:
    return f"RGW{str(uuid.uuid4().int)[-17:]}"


def _credentials(client, payload: dict[str, Any]) -> tuple[str, str]:
    entries = client.extract_keys(payload)
    complete = next(
        (
            (entry.get("access_key"), entry.get("secret_key"))
            for entry in entries
            if entry.get("access_key") and entry.get("secret_key")
        ),
        (None, None),
    )
    access_key, secret_key = complete
    assert access_key and secret_key
    return str(access_key), str(secret_key)


def _s3_client(
    settings: CephTestSettings,
    *,
    endpoint_url: str,
    access_key: str,
    secret_key: str,
):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=settings.rgw_admin_region or "us-east-1",
        verify=settings.rgw_ca_bundle or settings.rgw_verify_tls,
        config=Config(s3={"addressing_style": "path"}),
    )


def _upload(
    session: BackendSession,
    *,
    account_ref: int | str,
    bucket: str,
    key: str,
    body: bytes,
    workspace: str = "manager-browser",
) -> None:
    response = session.request(
        "POST",
        f"/browser/buckets/{bucket}/proxy-upload",
        params={"account_id": account_ref},
        headers={"X-S3-Workspace": workspace},
        data={"key": key, "content_type": "application/octet-stream"},
        files={"file": (key.rsplit("/", 1)[-1], io.BytesIO(body), "application/octet-stream")},
        expected_status=200,
    )
    response.close()


def _delete_object(
    session: BackendSession,
    *,
    account_ref: int | str,
    bucket: str,
    key: str,
    workspace: str = "manager-browser",
) -> None:
    session.post(
        f"/browser/buckets/{bucket}/delete",
        params={"account_id": account_ref},
        headers={"X-S3-Workspace": workspace},
        json={"objects": [{"key": key}]},
    )


def _super_admin_id(session: BackendSession, email: str) -> int:
    payload = session.get(
        "/admin/users",
        params={"page": 1, "page_size": 200, "search": email},
    )
    user = next(
        item
        for item in payload.get("items", [])
        if str(item.get("email") or "").strip().lower() == email.strip().lower()
    )
    return int(user["id"])


def _purge_bucket_history(client, bucket: str) -> None:
    key_marker = None
    version_id_marker = None
    while True:
        kwargs: dict[str, Any] = {"Bucket": bucket}
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if version_id_marker:
            kwargs["VersionIdMarker"] = version_id_marker
        page = client.list_object_versions(**kwargs)
        objects = [
            {"Key": item["Key"], "VersionId": item["VersionId"]}
            for item in [*(page.get("Versions") or []), *(page.get("DeleteMarkers") or [])]
        ]
        if objects:
            client.delete_objects(Bucket=bucket, Delete={"Objects": objects, "Quiet": True})
        if not page.get("IsTruncated"):
            return
        key_marker = page.get("NextKeyMarker")
        version_id_marker = page.get("NextVersionIdMarker")


def test_explicit_tenant_account_user_manager_portal_and_metrics(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    backend_authenticator: BackendAuthenticator,
    storage_endpoint_id: int,
    resource_tracker: ResourceTracker,
    ceph_verifier: CephVerifier | None,
) -> None:
    if ceph_verifier is None:
        pytest.skip("Explicit tenant qualification requires RGW Admin Ops credentials")

    rgw = ceph_verifier.client
    suffix = uuid.uuid4().hex[:8]
    account_tenant = f"bracct_{suffix}"
    user_tenant = f"bruser_{suffix}"
    rgw_account_id = _account_id()
    root_uid = f"root_{suffix}"
    standalone_uid = f"analyst_{suffix}"
    shared_bucket = f"br-{suffix}-tenant-shared"
    account_bucket = f"br-{suffix}-account"

    rgw.create_account(
        account_id=rgw_account_id,
        account_name=f"Tenant account {suffix}",
        extra_params={"tenant": account_tenant},
    )
    resource_tracker.track_ceph_admin_account(
        rgw_account_id,
        cleanup_users_on_conflict=False,
    )

    root_payload = rgw.create_user_with_account_id(
        uid=root_uid,
        account_id=rgw_account_id,
        display_name=root_uid,
        account_root=True,
        tenant=account_tenant,
    )
    resource_tracker.track_ceph_admin_user(root_uid, tenant=account_tenant)
    root_access, root_secret = _credentials(rgw, root_payload)

    tenant_user_payload = rgw.create_user(
        standalone_uid,
        display_name=standalone_uid,
        tenant=user_tenant,
    )
    resource_tracker.track_ceph_admin_user(standalone_uid, tenant=user_tenant)
    tenant_access, tenant_secret = _credentials(rgw, tenant_user_payload)

    default_user_payload = rgw.create_user(
        standalone_uid,
        display_name=standalone_uid,
    )
    resource_tracker.track_ceph_admin_user(standalone_uid, tenant=None)
    default_access, default_secret = _credentials(rgw, default_user_payload)

    endpoint = next(
        item
        for item in super_admin_session.get("/admin/storage-endpoints")
        if int(item["id"]) == storage_endpoint_id
    )
    endpoint_url = str(endpoint["endpoint_url"])
    tenant_s3 = _s3_client(
        ceph_test_settings,
        endpoint_url=endpoint_url,
        access_key=tenant_access,
        secret_key=tenant_secret,
    )
    default_s3 = _s3_client(
        ceph_test_settings,
        endpoint_url=endpoint_url,
        access_key=default_access,
        secret_key=default_secret,
    )
    root_s3 = _s3_client(
        ceph_test_settings,
        endpoint_url=endpoint_url,
        access_key=root_access,
        secret_key=root_secret,
    )
    tenant_s3.create_bucket(Bucket=shared_bucket)
    default_s3.create_bucket(Bucket=shared_bucket)
    tenant_s3.put_object(Bucket=shared_bucket, Key="tenant.bin", Body=b"tenant-object-123")
    default_s3.put_object(Bucket=shared_bucket, Key="default.bin", Body=b"default-object-must-remain-isolated")
    resource_tracker.track_ceph_admin_bucket(shared_bucket, tenant=user_tenant)
    resource_tracker.track_ceph_admin_bucket(shared_bucket, tenant=None)

    imported_account = super_admin_session.post(
        "/admin/accounts/import",
        json=[
            {
                "rgw_account_id": rgw_account_id,
                "root_uid": f"{account_tenant}${root_uid}",
                "name": f"Imported tenant account {suffix}",
                "storage_endpoint_id": storage_endpoint_id,
            }
        ],
    )[0]
    account_id = int(imported_account["id"])
    assert imported_account["rgw_tenant"] == account_tenant
    imported_account_detail = super_admin_session.get(f"/admin/accounts/{account_id}")
    assert imported_account_detail["rgw_tenant"] == account_tenant
    portal_log_bucket = portal_access_log_bucket_name(
        account_id,
        rgw_account_id,
        str(imported_account["name"]),
    )
    resource_tracker.track_ceph_admin_bucket(
        portal_log_bucket,
        tenant=account_tenant,
    )
    resource_tracker.track_account(
        account_id,
        delete_rgw=False,
        rgw_account_id=rgw_account_id,
    )

    imported_user = super_admin_session.post(
        "/admin/s3-users/import",
        json=[
            {
                "uid": f"{user_tenant}${standalone_uid}",
                "name": f"Imported tenant user {suffix}",
                "storage_endpoint_id": storage_endpoint_id,
            }
        ],
    )[0]
    s3_user_id = int(imported_user["id"])
    s3_user_ref = f"s3u-{s3_user_id}"
    assert imported_user["rgw_tenant"] == user_tenant
    assert imported_user["rgw_user_uid"] == standalone_uid

    super_admin_user_id = _super_admin_id(super_admin_session, ceph_test_settings.super_admin_email)
    super_admin_session.put(
        f"/admin/users/{super_admin_user_id}",
        json={
            "account_links": [
                {
                    "account_id": account_id,
                    "manager_role": "account_administrator",
                    "portal_role": "portal_manager",
                    "allow_manager_browser_data_access": True,
                }
            ],
            "s3_user_links": [
                {
                    "s3_user_id": s3_user_id,
                    "allow_manager_browser_data_access": True,
                }
            ],
        },
    )
    actor = backend_authenticator.login(
        ceph_test_settings.super_admin_email,
        ceph_test_settings.super_admin_password,
    )

    account_context = actor.get(
        "/manager/context",
        params={"account_id": account_id, "include_limits": "true"},
    )
    assert account_context["context_kind"] == "account"
    assert account_context["access_mode"] == "admin"

    actor.post(
        "/manager/buckets",
        params={"account_id": account_id},
        json={"name": account_bucket, "versioning": False},
        expected_status=201,
    )
    resource_tracker.track_ceph_admin_bucket(account_bucket, tenant=account_tenant)
    _upload(
        actor,
        account_ref=account_id,
        bucket=account_bucket,
        key="account.bin",
        body=b"account-tenant-object",
    )
    account_overview = actor.get(
        "/manager/stats/overview",
        params={"account_id": account_id},
    )
    assert account_overview["total_buckets"] == 1
    assert [item["name"] for item in account_overview["bucket_usage"]] == [account_bucket]
    account_admin_stats = super_admin_session.get(
        "/admin/stats/account",
        params={"account_id": account_id},
    )
    assert account_admin_stats["total_buckets"] == 1
    assert [item["name"] for item in account_admin_stats["bucket_usage"]] == [account_bucket]
    ceph_admin_account_metrics = super_admin_session.get(
        f"/ceph-admin/endpoints/{storage_endpoint_id}/accounts/{rgw_account_id}/metrics",
        params={"root_uid": root_uid, "tenant": account_tenant},
    )
    assert ceph_admin_account_metrics["bucket_count"] == 1
    assert [item["name"] for item in ceph_admin_account_metrics["bucket_usage"]] == [account_bucket]
    ceph_admin_account_metrics_without_root = super_admin_session.get(
        f"/ceph-admin/endpoints/{storage_endpoint_id}/accounts/{rgw_account_id}/metrics",
    )
    assert ceph_admin_account_metrics_without_root["bucket_count"] == 1
    assert [item["name"] for item in ceph_admin_account_metrics_without_root["bucket_usage"]] == [account_bucket]

    user_context = actor.get(
        "/manager/context",
        params={"account_id": s3_user_ref, "include_limits": "true"},
    )
    # ManagerContext keeps the historical account-shaped response contract;
    # access_mode identifies the selected S3-user execution context.
    assert user_context["context_kind"] == "account"
    assert user_context["access_mode"] == "s3_user"
    assert user_context["manager_bucket_quota_enabled"] is False
    user_buckets = actor.get(
        "/manager/buckets",
        params={"account_id": s3_user_ref},
    )
    assert [item["name"] for item in user_buckets] == [shared_bucket]
    user_overview = actor.get(
        "/manager/stats/overview",
        params={"account_id": s3_user_ref},
    )
    assert user_overview["total_buckets"] == 1
    assert [item["name"] for item in user_overview["bucket_usage"]] == [shared_bucket]
    user_admin_stats = super_admin_session.get(
        "/admin/stats/s3-user",
        params={"user_id": s3_user_id},
    )
    assert user_admin_stats["total_buckets"] == 1
    assert [item["name"] for item in user_admin_stats["bucket_usage"]] == [shared_bucket]
    usage_summary = actor.get(
        "/browser/usage-summary",
        params={"account_id": s3_user_ref},
    )
    assert usage_summary["available"] is True
    assert usage_summary["source"] == "s3_user"
    assert usage_summary["object_count"] == 1

    for context_ref in (account_id, s3_user_ref):
        traffic = actor.get(
            "/manager/stats/traffic",
            params={"account_id": context_ref, "window": "day"},
            expected_status=(200, 502),
        )
        if "detail" not in traffic:
            assert traffic["window"] in {"day", "DAY"}

    super_admin_session.put(
        f"/admin/s3-users/{s3_user_id}",
        json={"quota_max_objects": 1234},
    )
    user_detail = super_admin_session.get(
        f"/admin/s3-users/{s3_user_id}",
        params={"include_buckets": "true", "include_quota": "true"},
    )
    assert user_detail["rgw_tenant"] == user_tenant
    assert user_detail["bucket_count"] == 1
    assert user_detail["quota_max_objects"] == 1234
    bucket_quota = rgw.set_bucket_quota(
        shared_bucket,
        tenant=user_tenant,
        uid=standalone_uid,
        max_objects=100,
    )
    assert bucket_quota.get("not_found") is not True

    generated_key = super_admin_session.post(
        f"/admin/s3-users/{s3_user_id}/keys",
        expected_status=201,
    )
    generated_access_key = str(generated_key["access_key_id"])
    super_admin_session.put(
        f"/admin/s3-users/{s3_user_id}/keys/{generated_access_key}/status",
        json={"active": False},
    )
    super_admin_session.put(
        f"/admin/s3-users/{s3_user_id}/keys/{generated_access_key}/status",
        json={"active": True},
    )
    super_admin_session.delete(
        f"/admin/s3-users/{s3_user_id}/keys/{generated_access_key}",
        expected_status=204,
    )

    portal_accounts = actor.get("/portal/accounts")
    assert any(int(item["id"]) == account_id for item in portal_accounts)
    portal_state = actor.get("/portal/state", params={"account_id": account_id})
    assert portal_state["portal_role"] == "portal_manager"
    assert portal_state["can_manage_buckets"] is True
    storage_space = actor.post(
        "/portal/storage-spaces",
        params={"account_id": account_id},
        json={
            "name": f"Tenant Portal {suffix}",
            "naming_mode": "generic_uuid",
            "visibility": "private",
        },
        expected_status=201,
    )
    space_id = str(storage_space["id"])
    portal_bucket = str(storage_space.get("internal_bucket_name") or space_id)
    resource_tracker.track_ceph_admin_bucket(portal_bucket, tenant=account_tenant)
    _upload(
        actor,
        account_ref=account_id,
        bucket=portal_bucket,
        key="portal.bin",
        body=b"portal-tenant-object",
        workspace="portal",
    )
    portal_usage = actor.get("/portal/usage", params={"account_id": account_id})
    assert any(item["id"] == space_id for item in portal_usage["storage_spaces"])
    _delete_object(
        actor,
        account_ref=account_id,
        bucket=portal_bucket,
        key="portal.bin",
        workspace="portal",
    )
    _purge_bucket_history(root_s3, portal_bucket)
    actor.delete(
        f"/portal/storage-spaces/{space_id}",
        params={"account_id": account_id},
        expected_status=204,
    )
    resource_tracker.discard_ceph_admin_bucket(portal_bucket, tenant=account_tenant)

    account_after_portal = super_admin_session.get(
        f"/admin/accounts/{account_id}",
        params={"include_usage": "true"},
    )
    assert account_after_portal["bucket_count"] >= 2

    _delete_object(
        actor,
        account_ref=account_id,
        bucket=account_bucket,
        key="account.bin",
    )
    actor.delete(
        f"/manager/buckets/{account_bucket}",
        params={"account_id": account_id, "force": "true"},
        expected_status=(200, 204),
    )
    resource_tracker.discard_ceph_admin_bucket(account_bucket, tenant=account_tenant)

    log_delete = rgw.delete_bucket_operation(
        portal_log_bucket,
        tenant=account_tenant,
        purge_objects=True,
    )
    assert log_delete.success is True
    resource_tracker.discard_ceph_admin_bucket(
        portal_log_bucket,
        tenant=account_tenant,
    )

    super_admin_session.put(
        f"/admin/users/{super_admin_user_id}",
        json={
            "account_links": [],
            "s3_user_links": [
                {
                    "s3_user_id": s3_user_id,
                    "allow_manager_browser_data_access": True,
                }
            ],
        },
    )

    super_admin_session.delete(
        f"/admin/accounts/{account_id}",
        params={"delete_rgw": "true"},
        expected_status=204,
    )
    resource_tracker.discard_account(account_id)
    resource_tracker.discard_ceph_admin_user(root_uid, tenant=account_tenant)
    resource_tracker.discard_ceph_admin_account(rgw_account_id)
