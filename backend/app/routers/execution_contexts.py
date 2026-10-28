# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.execution_context import ExecutionContext, WorkspaceAccess
from app.routers.dependencies import get_current_account_user
from app.services.execution_context_catalog_service import ExecutionContextCatalogService

from app.services.auth_session_guards import current_auth_session

def _ui_session_id(request, db):
    if request and request.cookies and not request.headers.get("authorization"):
        return current_auth_session(request, db).id
    return None


router = APIRouter(prefix="/me", tags=["me"])


@router.get("/execution-contexts", response_model=list[ExecutionContext])
def list_execution_contexts(
    request: Request = None,
    workspace: Optional[str] = Query(default=None, pattern="^(manager|browser)$"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[ExecutionContext]:
    return ExecutionContextCatalogService(db, _ui_session_id(request, db)).list_contexts(
        user,
        workspace=workspace,
    )


@router.get("/workspace-access", response_model=WorkspaceAccess)
def get_workspace_access(
    request: Request = None,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> WorkspaceAccess:
    return ExecutionContextCatalogService(db, _ui_session_id(request, db)).workspace_access(user)
