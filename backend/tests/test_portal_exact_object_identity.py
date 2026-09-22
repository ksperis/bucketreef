# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError
from botocore.response import StreamingBody

from app.db import PortalPublicLink, PortalStorageSpaceMetadata, User
from app.main import app
from app.models.access_context import AccountAccess
from app.models.account_capabilities import AccountCapabilities
from app.models.portal_storage_spaces import PortalStorageSpaceSummary
from app.routers.dependencies import get_portal_account_access
from app.routers.portal_common import get_portal_service_dependency
from app.services.portal import public_links
from app.services.portal_service import PortalService
from tests.s3_account_factory import make_s3_account


EXACT_KEYS = [
    "report.txt", "/report.txt", "//report.txt", "/", "//", " ",
    " /folder//report.txt ", "café/%2F+?#.txt", "cafe\u0301/../report.txt",
]
BASE = "/api/portal/storage-spaces/research/objects"


@pytest.fixture
def storage(db_session, monkeypatch, client):
    account = make_s3_account(db_session, name="portal-exact-identity")
    user = User(email="exact-identity@example.test", hashed_password="x", role="ui_user")
    db_session.add_all([account, user])
    db_session.flush()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id, bucket_name="research", display_name="Research",
        visibility="shared",
    )
    db_session.add(metadata)
    db_session.commit()
    access = AccountAccess(
        account=account, actor=user, membership=None,
        capabilities=AccountCapabilities(), portal_role="portal_manager",
    )
    service = PortalService(db_session)
    # Keep database-backed content/manager guards; isolate only discovery and S3.
    monkeypatch.setattr(service, "list_storage_spaces", lambda *_args, **_kwargs: [
        PortalStorageSpaceSummary(
            id="research", name="Research", role="Manager", internal_bucket_name="research",
        ),
    ])
    sdk = Mock()
    sdk.head_object.return_value = {"ContentLength": 7, "ContentType": "text/plain"}
    sdk.get_bucket_versioning.return_value = {"Status": "Enabled"}
    bodies = []

    def get_object(**_kwargs):
        body = BytesIO(b"payload")
        bodies.append(body)
        return {"Body": StreamingBody(body, 7), "ContentType": "text/plain"}

    sdk.get_object.side_effect = get_object
    monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: sdk)
    app.dependency_overrides[get_portal_account_access] = lambda: access
    app.dependency_overrides[get_portal_service_dependency] = lambda: service
    yield SimpleNamespace(
        http=client, service=service, sdk=sdk, access=access, user=user,
        db=db_session, bodies=bodies, metadata=metadata,
    )
    for body in bodies:
        body.close()


@pytest.mark.parametrize("key", EXACT_KEYS)
def test_http_reads_and_deletion_use_the_selected_key(storage, key):
    response = storage.http.get(f"{BASE}/detail", params={"key": key})
    assert response.status_code == 200, response.text
    assert response.json()["key"] == key
    assert response.json()["preview_text"] == "payload"
    storage.sdk.head_object.assert_called_once_with(Bucket="research", Key=key)
    storage.sdk.get_object.assert_called_once_with(Bucket="research", Key=key, Range="bytes=0-65535")
    assert storage.bodies[-1].closed

    storage.sdk.get_object.reset_mock()
    response = storage.http.get(f"{BASE}/download", params={"key": key})
    assert response.status_code == 200, response.text
    assert response.content == b"payload"
    storage.sdk.get_object.assert_called_once_with(Bucket="research", Key=key)
    assert storage.bodies[-1].closed

    response = storage.http.delete(BASE, params={"key": key})
    assert response.status_code == 200, response.text
    assert response.json()["key"] == key
    storage.sdk.delete_object.assert_called_once_with(Bucket="research", Key=key)


@pytest.mark.parametrize("key", EXACT_KEYS)
def test_http_history_and_restore_keep_exact_keys_versions_and_markers(storage, key):
    neighbors = list(dict.fromkeys([key, key.lstrip("/") or "neighbor", key + "/child"]))
    storage.sdk.list_object_versions.return_value = {
        "Versions": [{"Key": name, "VersionId": " v+%2F "} for name in neighbors],
        "DeleteMarkers": [{"Key": name, "VersionId": " d+%2F "} for name in neighbors],
        "IsTruncated": True,
        "NextKeyMarker": " /next// ", "NextVersionIdMarker": " next version ",
    }
    response = storage.http.get(f"{BASE}/versions", params={
        "key": key, "key_marker": " /previous// ", "version_id_marker": " previous version ", "max_keys": 10,
    })
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["key"] == key
    assert [(item["key"], item["version_id"]) for item in result["versions"]] == [(key, " v+%2F "), (key, " d+%2F ")]
    assert result["next_key_marker"] == " /next// "
    assert result["next_version_id_marker"] == " next version "
    storage.sdk.list_object_versions.assert_called_once_with(
        Bucket="research", Prefix=key, KeyMarker=" /previous// ",
        VersionIdMarker=" previous version ", MaxKeys=10,
    )

    response = storage.http.post(f"{BASE}/restore", json={"key": key, "version_id": " v+%2F "})
    assert response.status_code == 200, response.text
    assert response.json()["key"] == key
    assert response.json()["restored_from_version_id"] == " v+%2F "
    storage.sdk.head_object.assert_called_once_with(Bucket="research", Key=key, VersionId=" v+%2F ")
    storage.sdk.copy_object.assert_called_once_with(
        Bucket="research", Key=key,
        CopySource={"Bucket": "research", "Key": key, "VersionId": " v+%2F "},
    )


def test_trash_restore_selects_the_exact_deleted_key(storage):
    key = "/folder//deleted.txt "
    storage.sdk.list_object_versions.return_value = {
        "Versions": [
            {"Key": key, "VersionId": " source version ", "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc)},
            {"Key": key.lstrip("/"), "VersionId": "neighbor", "LastModified": datetime(2026, 1, 2, tzinfo=timezone.utc)},
        ],
        "DeleteMarkers": [{"Key": key, "VersionId": "delete-marker", "IsLatest": True}],
    }
    response = storage.http.post(f"{BASE}/restore", json={"key": key})
    assert response.status_code == 200, response.text
    assert response.json()["restored_from_version_id"] == " source version "
    storage.sdk.list_object_versions.assert_called_once_with(Bucket="research", Prefix=key, MaxKeys=1000)
    assert storage.sdk.copy_object.call_args.kwargs["CopySource"] == {
        "Bucket": "research", "Key": key, "VersionId": " source version ",
    }


@pytest.mark.parametrize("prefix", ["/", "//", "/folder//", " /folder// "])
def test_deleted_prefix_restore_stays_within_the_literal_selected_prefix(storage, prefix):
    expected_prefix = prefix if prefix.endswith("/") else prefix + "/"
    key = expected_prefix + "deleted.txt"

    def list_versions(**kwargs):
        # A normalized request would select a different key, just as on S3.
        selected = kwargs["Prefix"] + "deleted.txt"
        return {
            "Versions": [{"Key": selected, "VersionId": " v1 "}],
            "DeleteMarkers": [{"Key": selected, "VersionId": "d2", "IsLatest": True}],
        }

    storage.sdk.list_object_versions.side_effect = list_versions
    target = storage.service.prepare_deleted_prefix_restore(storage.user, storage.access, "research", prefix=prefix)
    progress = []
    result = storage.service.run_deleted_prefix_restore(target, progress_callback=progress.append)
    assert target.prefix == result.prefix == expected_prefix
    assert result.restored_objects == 1
    assert result.failed_objects == 0
    assert all(item.prefix == expected_prefix for item in progress)
    storage.sdk.list_object_versions.assert_called_once_with(Bucket="research", Prefix=expected_prefix, MaxKeys=1000)
    storage.sdk.copy_object.assert_called_once_with(
        Bucket="research", Key=key, CopySource={"Bucket": "research", "Key": key, "VersionId": " v1 "},
    )


def test_public_links_persist_filter_and_download_distinct_literal_keys(storage, monkeypatch):
    monkeypatch.setattr(public_links, "get_s3_client", lambda *_args, **_kwargs: storage.sdk)
    monkeypatch.setattr(storage.service, "_account_credentials", lambda _account: ("TEST-AK", "TEST-SK"))
    keys = ["report.txt", "/report.txt", "//report.txt", "/", "//", " "]
    links = {}
    url = "/api/portal/storage-spaces/research/public-links"
    for key in keys:
        response = storage.http.post(url, json={"object_key": key})
        assert response.status_code == 201, response.text
        assert response.json()["object_key"] == key
        links[key] = response.json()["id"]
    assert [call.kwargs["Key"] for call in storage.sdk.head_object.call_args_list] == keys
    assert [row.object_key for row in storage.db.query(PortalPublicLink).order_by(PortalPublicLink.id)] == keys

    for key in keys:
        response = storage.http.get(url, params={"object_key": key})
        assert response.status_code == 200, response.text
        assert [(item["id"], item["object_key"]) for item in response.json()] == [(links[key], key)]
        persisted = storage.db.get(PortalPublicLink, links[key])
        storage.sdk.get_object.reset_mock()
        response = storage.http.get(f"/api/portal/public-links/{persisted.token}/download")
        assert response.status_code == 200, response.text
        assert response.content == b"payload"
        storage.sdk.get_object.assert_called_once_with(Bucket="research", Key=key)
        assert storage.bodies[-1].closed


@pytest.mark.parametrize("code", ["NoSuchKey", "AccessDenied"])
def test_public_link_creation_never_falls_back_to_a_neighbor(storage, code):
    def head_object(**kwargs):
        if kwargs["Key"] == "/report.txt":
            raise ClientError({"Error": {"Code": code}}, "HeadObject")
        return {"ContentLength": 7}

    storage.sdk.head_object.side_effect = head_object
    response = storage.http.post("/api/portal/storage-spaces/research/public-links", json={"object_key": "/report.txt"})
    assert response.status_code >= 400
    storage.sdk.head_object.assert_called_once_with(Bucket="research", Key="/report.txt")
    assert storage.db.query(PortalPublicLink).count() == 0


@pytest.mark.parametrize("action", ["delete", "restore", "public-link"])
def test_missing_content_grant_still_blocks_mutations_before_s3(storage, action):
    storage.access.portal_role = "portal_user"
    if action == "delete":
        response = storage.http.delete(BASE, params={"key": "/report.txt"})
    elif action == "restore":
        response = storage.http.post(f"{BASE}/restore", json={"key": "/report.txt", "version_id": "v1"})
    else:
        response = storage.http.post("/api/portal/storage-spaces/research/public-links", json={"object_key": "/report.txt"})
    assert response.status_code == 403, response.text
    assert storage.sdk.mock_calls == []


def test_empty_prefix_is_not_a_request_to_restore_the_whole_bucket(storage):
    with pytest.raises(ValueError, match="folder prefix is required"):
        storage.service.prepare_deleted_prefix_restore(storage.user, storage.access, "research", prefix="")
    assert storage.sdk.mock_calls == []
