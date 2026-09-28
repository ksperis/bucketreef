from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.models.browser import CopyObjectPayload
from app.services.browser.object_copy import copy_snapshot
from app.services.browser_service import BrowserService


def fixture():
    client = Mock()
    client.head_object.return_value = {"ContentLength": 17, "ETag": '"old"', "VersionId": "v1", "Metadata": {}}
    client.copy_object.return_value = {"VersionId": "v2", "CopyObjectResult": {"ETag": '"old"'}}
    client.get_object_tagging.return_value = {"TagSet": []}
    client.upload_part_copy.return_value = {"CopyPartResult": {"ETag": '"part"'}}
    client.create_multipart_upload.return_value = {"UploadId": "multipart"}
    client.complete_multipart_upload.return_value = {"ETag": '"composite-2"'}
    return client, SimpleNamespace(storage_endpoint=SimpleNamespace(provider="ceph"))


def test_move_pins_source_and_preserves_older_versions():
    client, account = fixture()
    result = copy_snapshot(client, account, "bucket", CopyObjectPayload(source_key="é/source", destination_key="é/copy", move=True))
    assert result["source_deleted"]
    assert client.copy_object.call_args.kwargs["CopySource"]["VersionId"] == "v1"
    client.delete_object.assert_called_once_with(Bucket="bucket", Key="é/source", IfMatch='"old"')


@pytest.mark.parametrize("failure", ["changed", "size", "etag", "delete"])
def test_move_keeps_source_after_verification_or_delete_failure(failure):
    client, account = fixture()
    original = client.head_object.return_value
    changed = {**original, "ETag": '"changed"'} if failure == "changed" else original
    target = {**original, **({"ContentLength": 18} if failure == "size" else {"ETag": '"other"'} if failure == "etag" else {})}
    client.head_object.side_effect = [original, changed, target]
    if failure == "delete":
        client.delete_object.side_effect = ClientError({"Error": {"Code": "NotImplemented"}}, "DeleteObject")
    result = copy_snapshot(client, account, "bucket", CopyObjectPayload(source_key="source", destination_key="copy", move=True))
    assert result["copied"] and not result["source_deleted"]
    assert result["reason"].startswith("Copied, not deleted")
    if failure != "delete":
        client.delete_object.assert_not_called()


def test_large_copy_verifies_multipart_etag_against_result(monkeypatch):
    from app.services.browser import object_copy
    monkeypatch.setattr(object_copy, "SINGLE_COPY_LIMIT", 10)
    client, account = fixture()
    original = client.head_object.return_value
    client.head_object.side_effect = [original, original, {**original, "ETag": '"composite-2"'}]
    result = copy_snapshot(client, account, "bucket", CopyObjectPayload(source_key="source", destination_key="copy", move=True))
    assert result["source_deleted"]
    client.copy_object.assert_not_called()
    assert client.upload_part_copy.call_args.kwargs["CopySourceRange"] == "bytes=0-16"
    assert client.upload_part_copy.call_args.kwargs["CopySourceIfMatch"] == '"old"'


def test_failed_multipart_copy_aborts_without_deleting_source(monkeypatch):
    from app.services.browser import object_copy
    monkeypatch.setattr(object_copy, "SINGLE_COPY_LIMIT", 10)
    client, account = fixture()
    client.upload_part_copy.side_effect = RuntimeError("interrupted")
    with pytest.raises(RuntimeError, match="interrupted"):
        copy_snapshot(client, account, "bucket", CopyObjectPayload(source_key="source", destination_key="copy", move=True))
    client.abort_multipart_upload.assert_called_once()
    client.delete_object.assert_not_called()


@pytest.mark.parametrize("source_role,target_role,move", [("Viewer", "Editor", True), ("Editor", "Viewer", False), (None, "Editor", False)])
def test_portal_checks_both_storage_spaces(source_role, target_role, move):
    spaces = [SimpleNamespace(internal_bucket_name="target", id="target", role=target_role)]
    if source_role:
        spaces.append(SimpleNamespace(internal_bucket_name="source", id="source", role=source_role))
    with pytest.raises(HTTPException) as error:
        BrowserService().copy_object("target", SimpleNamespace(portal_storage_spaces=spaces), CopyObjectPayload(source_bucket="source", source_key="a", destination_key="b", move=move))
    assert error.value.status_code == 403
