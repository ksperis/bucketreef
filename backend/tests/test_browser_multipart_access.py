import pytest
from fastapi import HTTPException
from app.main import app
from app.models.portal_storage_spaces import PortalStorageSpaceSummary
from app.services.browser.object_operations import require_multipart_write_access
from app.services.s3_execution_context import S3ExecutionContext


def _context(*, spaces=None):
    return S3ExecutionContext(
        context_id="test",
        context_kind="portal_account" if spaces is not None else "account",
        name="test",
        access_key=None,
        secret_key=None,
        portal_storage_spaces=spaces,
    )


def _space(space_id: str, bucket_name: str, role: str) -> PortalStorageSpaceSummary:
    return PortalStorageSpaceSummary(
        id=space_id,
        name=space_id,
        role=role,
        internal_bucket_name=bucket_name,
    )


@pytest.mark.parametrize("role,bucket", [("Viewer", "allowed"), ("Editor", "missing")])
def test_multipart_keeps_portal_write_checks(role, bucket):
    account = _context(spaces=[_space("space", "allowed", role)])
    with pytest.raises(HTTPException) as error:
        require_multipart_write_access(account, bucket)
    assert error.value.status_code == 403


def test_editor_can_use_classic_multipart_without_recovery_routes():
    account = _context(spaces=[_space("space", "allowed", "Editor")])
    require_multipart_write_access(account, "allowed")
    require_multipart_write_access(_context(), "bucket")
    paths = app.openapi()["paths"]
    assert "/api/browser/buckets/{bucket_name}/multipart/{upload_id}/parts" not in paths
    assert "/api/browser/buckets/{bucket_name}/multipart/{upload_id}/complete" in paths


@pytest.mark.parametrize("source_role,destination_role,move", [("Editor", "Viewer", False), ("Viewer", "Editor", True)])
def test_classic_copy_keeps_portal_source_and_destination_checks(source_role, destination_role, move):
    from app.services.browser.object_operations import BrowserObjectOperationsMixin
    from app.models.browser import CopyObjectPayload
    account = _context(spaces=[
        _space("source", "source", source_role),
        _space("target", "target", destination_role),
    ])
    with pytest.raises(HTTPException) as error:
        BrowserObjectOperationsMixin().copy_object("target", account, CopyObjectPayload(source_bucket="source", source_key="file", destination_key="file", move=move))
    assert error.value.status_code == 403
    assert "/api/browser/buckets/{bucket_name}/write-preflight" not in app.openapi()["paths"]
