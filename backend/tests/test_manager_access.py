# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import HTTPException
import pytest

from app.routers.manager.access import require_bucket_management_context
from tests.execution_context_factory import make_s3_execution_context


def test_bucket_management_context_accepts_explicitly_capable_context():
    require_bucket_management_context(make_s3_execution_context(can_manage_buckets=True))


def test_bucket_management_context_rejects_missing_capability():
    account = make_s3_execution_context()

    with pytest.raises(HTTPException) as exc_info:
        require_bucket_management_context(account)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Bucket management is not allowed for this context"
