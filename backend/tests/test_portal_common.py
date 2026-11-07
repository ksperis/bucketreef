# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from fastapi import HTTPException

from app.core.domain_errors import ResourceConflictError, ResourceNotFoundError
from app.routers.portal_common import raise_portal_error
from app.services.portal.exceptions import (
    PortalBadRequestError,
    PortalConflictError,
    PortalForbiddenError,
    PortalGoneError,
    PortalNotFoundError,
)


@pytest.mark.parametrize(
    ("error", "status_code"),
    [
        (PortalBadRequestError("invalid request"), 400),
        (PortalForbiddenError("forbidden"), 403),
        (PortalNotFoundError("missing"), 404),
        (PortalConflictError("conflict"), 409),
        (PortalGoneError("gone"), 410),
    ],
)
def test_raise_portal_error_preserves_client_status_contract(error: RuntimeError, status_code: int) -> None:
    with pytest.raises(HTTPException) as raised:
        raise_portal_error(error)

    assert raised.value.status_code == status_code
    assert raised.value.detail == str(error)


def test_portal_resource_errors_keep_portal_and_shared_domain_semantics() -> None:
    not_found = PortalNotFoundError("missing")
    conflict = PortalConflictError("conflict")

    assert isinstance(not_found, ResourceNotFoundError)
    assert isinstance(not_found, RuntimeError)
    assert isinstance(conflict, ResourceConflictError)
    assert isinstance(conflict, RuntimeError)
