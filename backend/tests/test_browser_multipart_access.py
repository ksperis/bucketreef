import pytest
from fastapi import HTTPException

from app.core.domain_errors import BrowserStorageSpacePermissionError
from app.main import app
from app.models.browser import CopyObjectPayload, MultipartUploadInitRequest
from app.models.portal_storage_spaces import PortalStorageSpaceSummary
from app.routers import browser_objects, browser_transfers
from app.services.browser.object_operations import (
    BrowserObjectOperationsMixin,
    require_multipart_write_access,
)
from app.services.s3_execution_context import S3ExecutionContext
from tests.portal_storage_space_factory import portal_storage_space_summary


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
    return portal_storage_space_summary(
        id=space_id,
        name=space_id,
        role=role,
        internal_bucket_name=bucket_name,
    )


@pytest.mark.parametrize("role,bucket", [("Viewer", "allowed"), ("Editor", "missing")])
def test_multipart_keeps_portal_write_checks(role, bucket):
    account = _context(spaces=[_space("space", "allowed", role)])
    with pytest.raises(BrowserStorageSpacePermissionError) as error:
        require_multipart_write_access(account, bucket)
    assert str(error.value) == "Storage Space permissions do not allow this upload"


def test_editor_can_use_classic_multipart_without_recovery_routes():
    account = _context(spaces=[_space("space", "allowed", "Editor")])
    require_multipart_write_access(account, "allowed")
    require_multipart_write_access(_context(), "bucket")
    paths = app.openapi()["paths"]
    assert "/api/browser/buckets/{bucket_name}/multipart/{upload_id}/parts" not in paths
    assert "/api/browser/buckets/{bucket_name}/multipart/{upload_id}/complete" in paths


@pytest.mark.parametrize("source_role,destination_role,move", [("Editor", "Viewer", False), ("Viewer", "Editor", True)])
def test_classic_copy_keeps_portal_source_and_destination_checks(source_role, destination_role, move):
    account = _context(spaces=[
        _space("source", "source", source_role),
        _space("target", "target", destination_role),
    ])
    with pytest.raises(BrowserStorageSpacePermissionError) as error:
        BrowserObjectOperationsMixin().copy_object("target", account, CopyObjectPayload(source_bucket="source", source_key="file", destination_key="file", move=move))
    assert str(error.value) == "Storage Space permissions do not allow this transfer"
    assert "/api/browser/buckets/{bucket_name}/write-preflight" not in app.openapi()["paths"]


def test_copy_route_preserves_storage_space_permission_response():
    class FakeService:
        def copy_object(self, *_args, **_kwargs):  # noqa: ANN002, ANN003
            raise BrowserStorageSpacePermissionError(
                "Storage Space permissions do not allow this transfer"
            )

    with pytest.raises(HTTPException) as error:
        browser_objects.copy_object(
            bucket_name="target",
            payload=CopyObjectPayload(
                source_bucket="source",
                source_key="file",
                destination_key="file-copy",
            ),
            context=_context(),
            service=FakeService(),
            _=object(),
        )

    assert error.value.status_code == 403
    assert error.value.detail == "Storage Space permissions do not allow this transfer"


def test_multipart_route_preserves_storage_space_permission_response():
    class FakeService:
        def initiate_multipart_upload(self, *_args, **_kwargs):  # noqa: ANN002, ANN003
            raise BrowserStorageSpacePermissionError(
                "Storage Space permissions do not allow this upload"
            )

    with pytest.raises(HTTPException) as error:
        browser_transfers.multipart_init(
            bucket_name="target",
            payload=MultipartUploadInitRequest(key="file"),
            context=_context(),
            service=FakeService(),
            sse_customer=None,
            _=object(),
        )

    assert error.value.status_code == 403
    assert error.value.detail == "Storage Space permissions do not allow this upload"
