# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from app.core.domain_errors import BrowserFavoriteConflictError, BrowserFavoriteNotFoundError
from app.core.database import get_db
from app.db import User
from app.models.browser_favorites import BrowserFavoriteInput, BrowserFavoriteOut
from app.routers.dependencies import get_current_account_user
from app.services.browser_favorites_service import BrowserFavoritesService
from app.utils.http_errors import raise_http_error_from_value_error

router = APIRouter(prefix="/me/browser-favorites")


@router.get("", response_model=list[BrowserFavoriteOut])
def list_favorites(user: User = Depends(get_current_account_user), db: Session = Depends(get_db)) -> list[BrowserFavoriteOut]:
    return BrowserFavoritesService(db).list(user)


@router.post("", response_model=BrowserFavoriteOut, status_code=201)
def create_favorite(payload: BrowserFavoriteInput, user: User = Depends(get_current_account_user), db: Session = Depends(get_db)) -> BrowserFavoriteOut:
    try:
        return BrowserFavoritesService(db).create(user, payload)
    except BrowserFavoriteConflictError as exc:
        raise_http_error_from_value_error(exc)


@router.put("/{favorite_id}", response_model=BrowserFavoriteOut)
def update_favorite(favorite_id: str, payload: BrowserFavoriteInput, revision: int = Query(ge=1), user: User = Depends(get_current_account_user), db: Session = Depends(get_db)) -> BrowserFavoriteOut:
    try:
        return BrowserFavoritesService(db).mutate(user, favorite_id, revision, payload)
    except (BrowserFavoriteNotFoundError, BrowserFavoriteConflictError) as exc:
        raise_http_error_from_value_error(exc)


@router.delete("/{favorite_id}", status_code=204, response_class=Response)
def delete_favorite(favorite_id: str, revision: int = Query(ge=1), user: User = Depends(get_current_account_user), db: Session = Depends(get_db)) -> Response:
    try:
        BrowserFavoritesService(db).mutate(user, favorite_id, revision)
    except (BrowserFavoriteNotFoundError, BrowserFavoriteConflictError) as exc:
        raise_http_error_from_value_error(exc)
    return Response(status_code=204)
