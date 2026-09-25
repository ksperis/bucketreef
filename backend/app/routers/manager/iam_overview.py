# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging

from fastapi import APIRouter, Depends

from app.models.access_context import ManagerActor
from app.routers.dependencies import get_account_context, require_iam_capable_manager
from app.routers.manager.iam_common import get_iam_service_for_account
from app.services.s3_execution_context import S3ExecutionContext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/manager/iam", tags=["manager-iam-overview"])

@router.get("/overview")
def iam_overview(
    account: S3ExecutionContext = Depends(get_account_context),
    _: ManagerActor = Depends(require_iam_capable_manager),
) -> dict:
    service = get_iam_service_for_account(account)
    warnings: list[str] = []

    def _capture(label: str, func):
        try:
            return func()
        except RuntimeError as exc:
            logger.debug("IAM overview fallback for %s: %s", label, exc)
            warnings.append(f"{label}: {exc}")
            return []

    users = _capture("users", service.list_users)
    groups = _capture("groups", service.list_groups)
    roles = _capture("roles", service.list_roles)
    policies = _capture("policies", service.list_policies)
    return {
        "iam_users": len(users),
        "iam_groups": len(groups),
        "iam_roles": len(roles),
        "iam_policies": len(policies),
        "warnings": warnings,
    }
