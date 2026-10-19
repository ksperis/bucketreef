# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.runtime_surfaces import runtime_surface_enabled
from app.models.access_context import ManagerActor
from app.models.browser_transfer_policy import BrowserTransferPolicy, BrowserTransferWorkspace
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies_internal.auth_session import get_current_actor
from app.routers.dependencies_internal.execution_context import resolve_s3_execution_context
from app.services import app_settings_service
from app.services.auth_session_guards import current_auth_session
from app.services.browser_transfer_policy_service import build_transfer_policy, worker_content_security_policy

router = APIRouter()


@router.get("/direct-transfer-policy", response_model=BrowserTransferPolicy)
def get_direct_transfer_policy(
    request: Request,
    response: Response,
    workspace: BrowserTransferWorkspace = Query(),
    context_id: Optional[str] = Query(default=None, max_length=128),
    policy_id: Optional[str] = Query(default=None, pattern=r"^[a-f0-9]{64}$"),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> BrowserTransferPolicy:
    current_auth_session(request, db)
    general = app_settings_service.load_app_settings().general
    runtime_surface = {"ceph-admin": "ceph_admin", "portal": "portal", "manager": "manager", "browser": "browser"}[workspace]
    enabled = {
        "browser": general.browser_root_enabled,
        "manager": general.manager_enabled and general.browser_manager_enabled,
        "ceph-admin": general.ceph_admin_enabled and general.browser_ceph_admin_enabled,
        "portal": general.portal_enabled and general.browser_portal_enabled,
    }[workspace]
    if not enabled or not runtime_surface_enabled(get_settings(), runtime_surface):
        raise HTTPException(status_code=403, detail="Browser workspace is disabled")
    is_session = isinstance(actor, ManagerSessionPrincipal)
    if is_session and (workspace not in {"browser", "manager"} or not actor.capabilities.access_browser):
        raise HTTPException(status_code=403, detail="Browser workspace is unavailable for this session")
    if workspace == "portal" and (not context_id or not context_id.isdecimal()):
        raise HTTPException(status_code=403, detail="Portal requires an explicit account context")
    if workspace == "ceph-admin" and (not context_id or not context_id.startswith("ceph-admin-")):
        raise HTTPException(status_code=403, detail="Ceph Admin requires an endpoint context")
    if workspace in {"manager", "portal"} and context_id and context_id.startswith("ceph-admin-"):
        raise HTTPException(status_code=403, detail="Ceph Admin context requires its Browser workspace")
    context = resolve_s3_execution_context(request, context_id, actor, db, workspace=workspace, metadata_only=True)
    try:
        policy = build_transfer_policy(context, workspace=workspace, context_id=None if is_session else context.context_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if policy_id is not None and policy_id != policy.policy_id:
        raise HTTPException(status_code=403, detail="Direct transfer policy changed")
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["X-BucketReef-Transfer-CSP"] = worker_content_security_policy(policy)
    return policy
