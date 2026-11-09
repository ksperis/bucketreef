# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.admin_ldap_import import LDAPImportRequest
from app.routers.admin import users as users_router


class _ImportService:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error

    def import_user(self, payload, *, actor, session):
        if self.error is not None:
            raise self.error
        return SimpleNamespace(id=42), "corp"


class _AuditService:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error

    def record_action(self, **kwargs) -> None:
        if self.error is not None:
            raise self.error


def _call_import_route(monkeypatch, *, service: _ImportService, audit_service: _AuditService):
    current_user = SimpleNamespace(id=1, role="ui_admin")
    output_service = SimpleNamespace(to_out=lambda user: user)
    monkeypatch.setattr(users_router, "_require_user", lambda *_: SimpleNamespace(id=2))
    monkeypatch.setattr(users_router, "ensure_actor_can_manage_user", lambda *args, **kwargs: None)
    monkeypatch.setattr(users_router, "require_admin_sensitive_action", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        users_router,
        "require_admin_interactive_session",
        lambda *args, **kwargs: SimpleNamespace(id="admin-session"),
    )
    monkeypatch.setattr(users_router, "_ldap_import_service", lambda *args: service)

    return users_router.import_ldap_user(
        request=SimpleNamespace(),
        payload=LDAPImportRequest(
            selection_token="selection",
            action="link",
            target_user_id=2,
        ),
        output_service=output_service,
        user_query_service=SimpleNamespace(),
        associations_service=SimpleNamespace(),
        current_user=current_user,
        audit_service=audit_service,
        db=SimpleNamespace(),
    )


def test_ldap_import_maps_service_value_errors(monkeypatch):
    with pytest.raises(HTTPException) as exc_info:
        _call_import_route(
            monkeypatch,
            service=_ImportService(error=ValueError("selection invalid")),
            audit_service=_AuditService(),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "selection invalid"


def test_ldap_import_does_not_reclassify_audit_value_errors(monkeypatch):
    with pytest.raises(ValueError, match="audit failed"):
        _call_import_route(
            monkeypatch,
            service=_ImportService(),
            audit_service=_AuditService(error=ValueError("audit failed")),
        )
