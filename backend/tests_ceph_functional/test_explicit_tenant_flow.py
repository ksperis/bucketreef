# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import copy
import io
import uuid
from typing import Any

import boto3
import pytest
from botocore.client import Config

from app.services.managed_resource_naming import portal_access_log_bucket_name

from .clients import BackendSession, CephVerifier
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
        params={"context_id": account_ref},
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
        params={"context_id": account_ref},
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


def test_managed_explicit_tenant_creation_respects_global_opt_in(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    storage_endpoint_id: int,
    resource_tracker: ResourceTracker,
) -> None:
    suffix = uuid.uuid4().hex[:8]
    tenant = f"brmanaged_{suffix}"
    account_name = f"Managed tenant account {suffix}"
    user_name = f"managed-tenant-user-{suffix}"
    account_bucket = f"br-{suffix}-managed-account"
    user_bucket = f"br-{suffix}-managed-user"
    account_object = "managed-account.bin"
    user_object = "managed-user.bin"
    original_settings = super_admin_session.get("/admin/settings")
    managed_account_id: int | None = None
    managed_s3_user_id: int | None = None
    managed_account_bucket_created = False
    managed_user_bucket_created = False

    try:
        disabled_settings = copy.deepcopy(original_settings)
        disabled_settings["general"]["allow_managed_rgw_tenant_creation"] = False
        super_admin_session.put("/admin/settings", json=disabled_settings)

        blocked_account = super_admin_session.post(
            "/admin/accounts",
            json={
                "name": f"Blocked tenant account {suffix}",
                "rgw_tenant": tenant,
                "storage_endpoint_id": storage_endpoint_id,
            },
            expected_status=400,
        )
        assert "Managed RGW tenant creation is disabled" in str(blocked_account.get("detail"))
        blocked_user = super_admin_session.post(
            "/admin/s3-users",
            json={
                "name": f"Blocked tenant user {suffix}",
                "uid": f"blocked-{suffix}",
                "rgw_tenant": tenant,
                "storage_endpoint_id": storage_endpoint_id,
            },
            expected_status=400,
        )
        assert "Managed RGW tenant creation is disabled" in str(blocked_user.get("detail"))

        enabled_settings = copy.deepcopy(disabled_settings)
        enabled_settings["general"]["allow_managed_rgw_tenant_creation"] = True
        super_admin_session.put("/admin/settings", json=enabled_settings)

        managed_account = super_admin_session.post(
            "/admin/accounts",
            json={
                "name": account_name,
                "rgw_tenant": tenant,
                "storage_endpoint_id": storage_endpoint_id,
            },
            expected_status=201,
        )
        managed_account_id = int(managed_account["id"])
        assert managed_account["rgw_tenant"] == tenant

        managed_user = super_admin_session.post(
            "/admin/s3-users",
            json={
                "name": user_name,
                "uid": user_name,
                "rgw_tenant": tenant,
                "storage_endpoint_id": storage_endpoint_id,
            },
            expected_status=201,
        )
        managed_s3_user_id = int(managed_user["id"])
        managed_s3_user_ref = f"s3u-{managed_s3_user_id}"
        assert managed_user["rgw_tenant"] == tenant
        assert managed_user["rgw_user_uid"] == user_name

        super_admin_user_id = _super_admin_id(
            super_admin_session,
            ceph_test_settings.super_admin_email,
        )
        super_admin_session.patch(
            f"/admin/users/{super_admin_user_id}",
            json={
                "account_links": [
                    {
                        "account_id": managed_account_id,
                        "manager_role": "account_administrator",
                        "portal_role": None,
                        "allow_manager_browser_data_access": True,
                    }
                ],
                "s3_user_links": [
                    {
                        "s3_user_id": managed_s3_user_id,
                        "allow_manager_browser_data_access": True,
                    }
                ],
            },
        )
        resource_tracker.track_account(
            managed_account_id,
            rgw_account_id=str(managed_account["rgw_account_id"]),
        )

        account_context = super_admin_session.get(
            "/manager/context",
            params={"context_id": managed_account_id, "include_limits": "true"},
        )
        assert account_context["context_kind"] == "account"
        assert account_context["access_mode"] == "admin"
        super_admin_session.post(
            "/manager/buckets",
            params={"context_id": managed_account_id},
            json={"name": account_bucket, "versioning": False},
            expected_status=201,
        )
        managed_account_bucket_created = True
        _upload(
            super_admin_session,
            account_ref=managed_account_id,
            bucket=account_bucket,
            key=account_object,
            body=b"managed-account-tenant-object",
        )
        account_objects = super_admin_session.get(
            f"/browser/buckets/{account_bucket}/objects",
            params={
                "context_id": managed_account_id,
                "recursive": "true",
                "max_keys": 1000,
            },
        )
        assert [item["key"] for item in account_objects.get("objects", [])] == [account_object]

        account_overview = super_admin_session.get(
            "/manager/stats/overview",
            params={"context_id": managed_account_id},
        )
        assert account_overview["total_buckets"] == 1
        assert [item["name"] for item in account_overview["bucket_usage"]] == [account_bucket]
        account_admin_stats = super_admin_session.get(
            "/admin/stats/account",
            params={"account_id": managed_account_id},
        )
        assert account_admin_stats["total_buckets"] == 1
        assert [item["name"] for item in account_admin_stats["bucket_usage"]] == [account_bucket]
        account_ceph_admin_metrics = super_admin_session.get(
            f"/ceph-admin/endpoints/{storage_endpoint_id}/accounts/{managed_account['rgw_account_id']}/metrics",
        )
        assert account_ceph_admin_metrics["bucket_count"] == 1
        assert [item["name"] for item in account_ceph_admin_metrics["bucket_usage"]] == [account_bucket]

        user_context = super_admin_session.get(
            "/manager/context",
            params={"context_id": managed_s3_user_ref, "include_limits": "true"},
        )
        assert user_context["context_kind"] == "account"
        assert user_context["access_mode"] == "s3_user"
        super_admin_session.post(
            "/manager/buckets",
            params={"context_id": managed_s3_user_ref},
            json={"name": user_bucket, "versioning": False},
            expected_status=201,
        )
        managed_user_bucket_created = True
        _upload(
            super_admin_session,
            account_ref=managed_s3_user_ref,
            bucket=user_bucket,
            key=user_object,
            body=b"managed-user-tenant-object",
        )
        user_objects = super_admin_session.get(
            f"/browser/buckets/{user_bucket}/objects",
            params={
                "context_id": managed_s3_user_ref,
                "recursive": "true",
                "max_keys": 1000,
            },
        )
        assert [item["key"] for item in user_objects.get("objects", [])] == [user_object]

        user_overview = super_admin_session.get(
            "/manager/stats/overview",
            params={"context_id": managed_s3_user_ref},
        )
        assert user_overview["total_buckets"] == 1
        assert [item["name"] for item in user_overview["bucket_usage"]] == [user_bucket]
        user_admin_stats = super_admin_session.get(
            "/admin/stats/s3-user",
            params={"user_id": managed_s3_user_id},
        )
        assert user_admin_stats["total_buckets"] == 1
        assert [item["name"] for item in user_admin_stats["bucket_usage"]] == [user_bucket]
        user_usage = super_admin_session.get(
            "/browser/usage-summary",
            params={"context_id": managed_s3_user_ref},
        )
        assert user_usage["available"] is True
        assert user_usage["source"] == "s3_user"
        assert user_usage["object_count"] == 1
        user_ceph_admin_metrics = super_admin_session.get(
            f"/ceph-admin/endpoints/{storage_endpoint_id}/users/{user_name}/metrics",
            params={"tenant": tenant},
        )
        assert user_ceph_admin_metrics["bucket_count"] == 1
        assert [item["name"] for item in user_ceph_admin_metrics["bucket_usage"]] == [user_bucket]

        initial_keys = super_admin_session.get(f"/admin/s3-users/{managed_s3_user_id}/keys")
        assert any(item.get("is_ui_managed") is True for item in initial_keys)
        generated_key = super_admin_session.post(
            f"/admin/s3-users/{managed_s3_user_id}/keys",
            expected_status=201,
        )
        generated_access_key = str(generated_key["access_key_id"])
        assert generated_key["secret_access_key"]
        listed_keys = super_admin_session.get(f"/admin/s3-users/{managed_s3_user_id}/keys")
        assert generated_access_key in {str(item["access_key_id"]) for item in listed_keys}
        disabled_key = super_admin_session.put(
            f"/admin/s3-users/{managed_s3_user_id}/keys/{generated_access_key}/status",
            json={"active": False},
        )
        assert disabled_key["is_active"] is False
        enabled_key = super_admin_session.put(
            f"/admin/s3-users/{managed_s3_user_id}/keys/{generated_access_key}/status",
            json={"active": True},
        )
        assert enabled_key["is_active"] is True
        super_admin_session.delete(
            f"/admin/s3-users/{managed_s3_user_id}/keys/{generated_access_key}",
            expected_status=204,
        )
        remaining_keys = super_admin_session.get(f"/admin/s3-users/{managed_s3_user_id}/keys")
        assert generated_access_key not in {str(item["access_key_id"]) for item in remaining_keys}

        _delete_object(
            super_admin_session,
            account_ref=managed_account_id,
            bucket=account_bucket,
            key=account_object,
        )
        super_admin_session.delete(
            f"/manager/buckets/{account_bucket}",
            params={"context_id": managed_account_id, "force": "true"},
            expected_status=(200, 204),
        )
        managed_account_bucket_created = False

        _delete_object(
            super_admin_session,
            account_ref=managed_s3_user_ref,
            bucket=user_bucket,
            key=user_object,
        )
        super_admin_session.delete(
            f"/manager/buckets/{user_bucket}",
            params={"context_id": managed_s3_user_ref, "force": "true"},
            expected_status=(200, 204),
        )
        managed_user_bucket_created = False
    finally:
        try:
            for bucket_name, was_created in (
                (account_bucket, managed_account_bucket_created),
                (user_bucket, managed_user_bucket_created),
            ):
                if not was_created:
                    continue
                super_admin_session.delete(
                    f"/ceph-admin/endpoints/{storage_endpoint_id}/buckets/{bucket_name}",
                    params={"tenant": tenant},
                    json={
                        "confirmation": f"PURGE AND DELETE BUCKET {tenant}/{bucket_name}",
                        "purge_objects": True,
                        "bypass_gc": False,
                    },
                    expected_status=(200, 404),
                )
            if managed_s3_user_id is not None:
                super_admin_session.delete(
                    f"/admin/s3-users/{managed_s3_user_id}",
                    params={"delete_rgw": "true"},
                    expected_status=(204, 404),
                )
            if managed_account_id is not None:
                super_admin_session.delete(
                    f"/admin/accounts/{managed_account_id}",
                    params={"delete_rgw": "true"},
                    expected_status=(204, 404),
                )
                resource_tracker.discard_account(managed_account_id)
        finally:
            super_admin_session.put("/admin/settings", json=original_settings)


def test_explicit_tenant_account_user_manager_portal_and_metrics(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
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
        tenant=account_tenant,
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

    ceph_bucket_base = (
        f"/ceph-admin/endpoints/{storage_endpoint_id}/buckets/{shared_bucket}"
    )
    ceph_bucket_listing = super_admin_session.get(
        f"/ceph-admin/endpoints/{storage_endpoint_id}/buckets",
        params={
            "filter": shared_bucket,
            "page": 1,
            "page_size": 100,
            "sort_by": "name",
            "sort_dir": "asc",
        },
    )
    listed_identities = {
        (str(item.get("tenant") or ""), str(item.get("name") or ""))
        for item in ceph_bucket_listing.get("items", [])
        if item.get("name") == shared_bucket
    }
    assert ("", shared_bucket) in listed_identities
    assert (user_tenant, shared_bucket) in listed_identities

    tenant_params = {"tenant": user_tenant}
    default_properties = super_admin_session.get(f"{ceph_bucket_base}/properties")
    tenant_properties = super_admin_session.get(
        f"{ceph_bucket_base}/properties",
        params=tenant_params,
    )
    assert "versioning_status" in default_properties
    assert "versioning_status" in tenant_properties
    for feature_path in (
        "versioning",
        "object-lock",
        "encryption",
        "tags",
        "logging",
        "website",
    ):
        super_admin_session.get(
            f"{ceph_bucket_base}/{feature_path}",
            params=tenant_params,
        )

    original_settings = super_admin_session.get("/admin/settings")
    disabled_settings = copy.deepcopy(original_settings)
    disabled_settings["general"]["allow_managed_rgw_tenant_creation"] = False
    super_admin_session.put("/admin/settings", json=disabled_settings)
    account_import_payload = [
        {
            "rgw_account_id": rgw_account_id,
            "rgw_tenant": account_tenant,
            "root_uid": f"{account_tenant}${root_uid}",
            "name": f"Imported tenant account {suffix}",
            "storage_endpoint_id": storage_endpoint_id,
        }
    ]
    user_import_payload = [
        {
            "uid": f"{user_tenant}${standalone_uid}",
            "name": f"Imported tenant user {suffix}",
            "storage_endpoint_id": storage_endpoint_id,
        }
    ]
    blocked_account_import = super_admin_session.post(
        "/admin/accounts/import",
        json=account_import_payload,
        expected_status=400,
    )
    assert "Managed RGW tenant creation is disabled" in str(blocked_account_import.get("detail"))
    blocked_user_import = super_admin_session.post(
        "/admin/s3-users/import",
        json=user_import_payload,
        expected_status=400,
    )
    assert "Managed RGW tenant creation is disabled" in str(blocked_user_import.get("detail"))

    enabled_settings = copy.deepcopy(disabled_settings)
    enabled_settings["general"]["allow_managed_rgw_tenant_creation"] = True
    super_admin_session.put("/admin/settings", json=enabled_settings)
    try:
        imported_account = super_admin_session.post(
            "/admin/accounts/import",
            json=account_import_payload,
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
            json=user_import_payload,
        )[0]
    finally:
        super_admin_session.put("/admin/settings", json=original_settings)
    s3_user_id = int(imported_user["id"])
    s3_user_ref = f"s3u-{s3_user_id}"
    assert imported_user["rgw_tenant"] == user_tenant
    assert imported_user["rgw_user_uid"] == standalone_uid

    super_admin_user_id = _super_admin_id(super_admin_session, ceph_test_settings.super_admin_email)
    super_admin_session.patch(
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
    actor = super_admin_session

    account_context = actor.get(
        "/manager/context",
        params={"context_id": account_id, "include_limits": "true"},
    )
    assert account_context["context_kind"] == "account"
    assert account_context["access_mode"] == "admin"

    actor.post(
        "/manager/buckets",
        params={"context_id": account_id},
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
        params={"context_id": account_id},
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
        params={"context_id": s3_user_ref, "include_limits": "true"},
    )
    # ManagerContext keeps the historical account-shaped response contract;
    # access_mode identifies the selected S3-user execution context.
    assert user_context["context_kind"] == "account"
    assert user_context["access_mode"] == "s3_user"
    assert user_context["manager_bucket_quota_enabled"] is False
    user_buckets = actor.get(
        "/manager/buckets",
        params={"context_id": s3_user_ref},
    )
    assert [item["name"] for item in user_buckets] == [shared_bucket]
    user_overview = actor.get(
        "/manager/stats/overview",
        params={"context_id": s3_user_ref},
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
        params={"context_id": s3_user_ref},
    )
    assert usage_summary["available"] is True
    assert usage_summary["source"] == "s3_user"
    assert usage_summary["object_count"] == 1

    for context_ref in (account_id, s3_user_ref):
        traffic = actor.get(
            "/manager/stats/traffic",
            params={"context_id": context_ref, "window": "day"},
            expected_status=(200, 502),
        )
        if "detail" not in traffic:
            assert traffic["window"] in {"day", "DAY"}

    super_admin_session.patch(
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
            params={"context_id": account_id, "force": "true"},
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

    super_admin_session.patch(
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
