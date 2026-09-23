# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace


def test_runtime_surfaces_are_public_and_follow_instance_kill_switches(client, monkeypatch):
    monkeypatch.setattr(
        "app.routers.settings.get_settings",
        lambda: SimpleNamespace(
            feature_admin_enabled=False,
            feature_ceph_admin_enabled=True,
            feature_storage_ops_enabled=False,
            feature_manager_enabled=True,
            feature_portal_enabled=True,
            feature_browser_enabled=True,
        ),
    )

    response = client.get("/api/settings/runtime-surfaces")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "admin": False,
        "ceph_admin": True,
        "storage_ops": False,
        "manager": True,
        "portal": True,
        "browser": True,
    }
