# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from app.core.domain_errors import BrowserFavoriteConflictError, BrowserFavoriteNotFoundError
from app.core.database import get_db
from app.db import User
from app.models.browser_favorites import BrowserFavoriteInput, BrowserFavoriteOut
from app.routers.dependencies import get_current_account_user
from app.services.browser_favorites_service import BrowserFavoritesService

router = APIRouter(prefix="/me/browser-favorites")


def _raise_favorite_error(
    exc: BrowserFavoriteNotFoundError | BrowserFavoriteConflictError,
) -> NoReturn:
    status_code = (
        status.HTTP_404_NOT_FOUND
        if isinstance(exc, BrowserFavoriteNotFoundError)
        else status.HTTP_409_CONFLICT
    )
    raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.get("", response_model=list[BrowserFavoriteOut])
def list_favorites(user: User = Depends(get_current_account_user), db: Session = Depends(get_db)) -> list[BrowserFavoriteOut]:
    return BrowserFavoritesService(db).list(user)


@router.post("", response_model=BrowserFavoriteOut, status_code=201)
def create_favorite(payload: BrowserFavoriteInput, user: User = Depends(get_current_account_user), db: Session = Depends(get_db)) -> BrowserFavoriteOut:
    try:
        return BrowserFavoritesService(db).create(user, payload)
    except BrowserFavoriteConflictError as exc:
        _raise_favorite_error(exc)


@router.put("/{favorite_id}", response_model=BrowserFavoriteOut)
def update_favorite(favorite_id: str, payload: BrowserFavoriteInput, revision: int = Query(ge=1), user: User = Depends(get_current_account_user), db: Session = Depends(get_db)) -> BrowserFavoriteOut:
    try:
        return BrowserFavoritesService(db).mutate(user, favorite_id, revision, payload)
    except (BrowserFavoriteNotFoundError, BrowserFavoriteConflictError) as exc:
        _raise_favorite_error(exc)


@router.delete("/{favorite_id}", status_code=204, response_class=Response)
def delete_favorite(favorite_id: str, revision: int = Query(ge=1), user: User = Depends(get_current_account_user), db: Session = Depends(get_db)) -> Response:
    try:
        BrowserFavoritesService(db).mutate(user, favorite_id, revision)
    except (BrowserFavoriteNotFoundError, BrowserFavoriteConflictError) as exc:
        _raise_favorite_error(exc)
    return Response(status_code=204)
