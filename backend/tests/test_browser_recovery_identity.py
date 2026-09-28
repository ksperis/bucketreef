# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import replace
from types import SimpleNamespace

from app.models.session import ManagerSessionPrincipal, SessionCapabilities
from app.services import browser_recovery_identity as module


def test_recovery_partition_survives_login_without_exposing_s3_identifiers(monkeypatch):
    monkeypatch.setattr(module, "get_settings", lambda: SimpleNamespace(credential_keys=["test-signing-key"]))
    principal = ManagerSessionPrincipal("session-1", "access-id", "secret", "unknown", None, None, None,
                                        SessionCapabilities(endpoint_url="https://storage.example.test"))
    reference = module.browser_recovery_identity(principal)
    assert len(reference) == 64
    assert "access-id" not in reference and "secret" not in reference
    assert reference == module.browser_recovery_identity(replace(principal, session_id="session-2"))
    assert reference != module.browser_recovery_identity(replace(principal, access_key="other-id"))
    assert reference != module.browser_recovery_identity(replace(principal, capabilities=SessionCapabilities(endpoint_url="https://other.example.test")))
