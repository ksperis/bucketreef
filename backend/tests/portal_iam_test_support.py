# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.iam import AccessKey, IAMUser
from app.services.portal_service import PortalService


class FakePortalRevocationIAM:
    def __init__(self, username: str, access_key_id: str) -> None:
        self.username = username
        self.access_key_id = access_key_id
        self.key_status = "Active"
        self.key_exists = True
        self.user_exists = True
        self.fail_get_user = False
        self.fail_delete_key = False
        self.calls: list[tuple[str, ...]] = []

    def get_user(self, username: str):
        self.calls.append(("get_user", username))
        if self.fail_get_user:
            raise RuntimeError("simulated IAM user lookup failure")
        if not self.user_exists:
            return None
        return IAMUser(name=username, user_id=f"id-{username}")

    def list_access_keys(self, username: str):
        self.calls.append(("list_access_keys", username))
        if not self.key_exists:
            return []
        return [AccessKey(access_key_id=self.access_key_id, status=self.key_status)]

    def update_access_key_status(self, username: str, access_key_id: str, status: str):
        self.calls.append(("update_access_key_status", username, access_key_id, status))
        self.key_status = status

    def delete_access_key(self, username: str, access_key_id: str):
        self.calls.append(("delete_access_key", username, access_key_id))
        if self.fail_delete_key:
            raise RuntimeError("simulated IAM key cleanup failure")
        self.key_exists = False

    def list_user_policies(self, username: str):
        self.calls.append(("list_user_policies", username))
        return []

    def list_user_inline_policies(self, username: str):
        self.calls.append(("list_user_inline_policies", username))
        return []

    def list_groups_for_user(self, username: str):
        self.calls.append(("list_groups_for_user", username))
        return []

    def delete_user(self, username: str):
        self.calls.append(("delete_user", username))
        self.user_exists = False


def install_portal_revocation_fakes(monkeypatch, fake_iam: FakePortalRevocationIAM) -> None:
    monkeypatch.setattr(
        PortalService,
        "_get_iam_service",
        lambda _service, _account: fake_iam,
    )
    monkeypatch.setattr(
        PortalService,
        "_sync_account_storage_space_bucket_policies",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        PortalService,
        "_sync_portal_server_access_log_bucket_policy_if_present",
        lambda *_args, **_kwargs: None,
    )
