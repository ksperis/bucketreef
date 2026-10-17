# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import S3Account, User, UserS3Account
from app.models.access_context import EffectiveAccountLink
from app.services import effective_access_service

from .auth_session import settings


def resolve_workspace_surface(request: Optional[Request]) -> str:
    if not request:
        return "manager"
    path = str(request.url.path)
    browser_prefix = f"{settings.api_v1_prefix}/browser"
    if path.startswith(browser_prefix):
        if (request.headers.get("X-S3-Workspace") or "").strip().lower() == "manager-browser":
            return "manager-browser"
        return "browser"
    return "manager"


def _resolve_default_account_id(db: Session, user: User) -> int:
    links = effective_access_service.EffectiveAccessService(db).resolve_user(user).account_links
    if len(links) == 1:
        return links[0].account_id
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")


def resolve_account_by_id(db: Session, account_id: int) -> S3Account:
    account = db.query(S3Account).filter(S3Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    return account


def resolve_user_account_link(
    db: Session,
    user: User,
    account_id: Optional[int],
    allow_default: bool,
) -> tuple[S3Account, UserS3Account | EffectiveAccountLink]:
    if account_id is None or account_id <= 0:
        if not allow_default:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")
        account_id = _resolve_default_account_id(db, user)
    account = resolve_account_by_id(db, account_id)
    link = effective_access_service.EffectiveAccessService(db).resolve_user(user).account_link_for(account.id)
    if not link:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return account, link
