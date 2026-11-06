# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from inspect import signature
from types import SimpleNamespace

import pytest

from app.models.browser import CreateBucketPayload
from app.routers import browser, browser_objects, browser_transfers, portal_objects


@pytest.mark.parametrize(
    "endpoint",
    [
        browser_objects.update_object_metadata,
        browser_objects.put_object_tags,
        browser_objects.put_object_acl,
        browser_objects.put_object_legal_hold,
        browser_objects.put_object_retention,
        browser_objects.delete_objects,
        browser_objects.copy_object,
        browser_objects.create_folder,
        browser_transfers.upload_via_proxy,
        browser_transfers.download_object,
        browser_transfers.multipart_init,
        browser_transfers.complete_multipart_upload,
        browser_transfers.abort_multipart_upload,
        browser_objects.restore_object,
        browser_objects.cleanup_object_versions,
        portal_objects.portal_restore_storage_space_object,
        portal_objects.portal_delete_storage_space_object,
        portal_objects.portal_download_storage_space_object,
    ],
)
def test_data_plane_endpoints_do_not_resolve_application_audit(endpoint) -> None:
    assert "audit_service" not in signature(endpoint).parameters


@pytest.mark.parametrize(
    "endpoint",
    [
        browser.create_bucket,
        portal_objects.portal_restore_deleted_prefix_stream,
    ],
)
def test_control_plane_and_global_workflow_endpoints_keep_application_audit(endpoint) -> None:
    assert "audit_service" in signature(endpoint).parameters


def test_browser_create_bucket_audits_validated_versioning_flag() -> None:
    created: list[tuple[str, object, bool]] = []
    audit_actions: list[dict[str, object]] = []
    context = SimpleNamespace(context_id="1")
    actor = SimpleNamespace(id=1)

    class FakeBrowserService:
        def create_bucket(self, name, current_context, *, versioning=False):  # noqa: ANN001
            created.append((name, current_context, versioning))

    class FakeAuditService:
        def record_action(self, **kwargs):  # noqa: ANN003
            audit_actions.append(kwargs)

    response = browser.create_bucket(
        CreateBucketPayload(name="archive", versioning=False),
        context=context,
        service=FakeBrowserService(),
        actor=actor,
        audit_service=FakeAuditService(),
    )

    assert response.status_code == 201
    assert created == [("archive", context, False)]
    assert audit_actions[0]["metadata"] == {"versioning": False}
