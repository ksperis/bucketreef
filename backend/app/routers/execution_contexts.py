# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.execution_context import ExecutionContext, WorkspaceAccess
from app.routers.dependencies import get_current_account_user
from app.services.execution_context_catalog_service import ExecutionContextCatalogService

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/execution-contexts", response_model=list[ExecutionContext])
def list_execution_contexts(
    workspace: Optional[str] = Query(default=None, pattern="^(manager|browser)$"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[ExecutionContext]:
    return ExecutionContextCatalogService(db).list_contexts(
        user,
        workspace=workspace,
    )


@router.get("/workspace-access", response_model=WorkspaceAccess)
def get_workspace_access(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> WorkspaceAccess:
    return ExecutionContextCatalogService(db).workspace_access(user)
