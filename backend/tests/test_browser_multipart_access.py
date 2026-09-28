from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from app.main import app
from app.services.browser.object_operations import require_multipart_write_access


@pytest.mark.parametrize("role,bucket", [("Viewer", "allowed"), ("Editor", "missing")])
def test_multipart_keeps_portal_write_checks(role, bucket):
    account = SimpleNamespace(portal_storage_spaces=[SimpleNamespace(id="space", internal_bucket_name="allowed", role=role)])
    with pytest.raises(HTTPException) as error:
        require_multipart_write_access(account, bucket)
    assert error.value.status_code == 403


def test_editor_can_use_classic_multipart_without_recovery_routes():
    account = SimpleNamespace(portal_storage_spaces=[SimpleNamespace(id="space", internal_bucket_name="allowed", role="Editor")])
    require_multipart_write_access(account, "allowed")
    require_multipart_write_access(SimpleNamespace(), "bucket")
    paths = app.openapi()["paths"]
    assert "/api/browser/buckets/{bucket_name}/multipart/{upload_id}/parts" not in paths
    assert "/api/browser/buckets/{bucket_name}/multipart/{upload_id}/complete" in paths
