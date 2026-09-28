# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.db import User
from app.models.browser_favorites import BrowserFavoriteInput, BrowserFavoriteOut, BrowserFavoriteSurface
from app.routers.dependencies import get_current_account_user
from app.services.browser_favorites_service import BrowserFavoritesService

router = APIRouter(prefix="/me/browser-favorites")


@router.get("", response_model=list[BrowserFavoriteOut])
def list_favorites(surface: BrowserFavoriteSurface = "browser", user: User = Depends(get_current_account_user), db: Session = Depends(get_db)):
    return BrowserFavoritesService(db).list(user, surface)


@router.post("", response_model=BrowserFavoriteOut, status_code=201)
def create_favorite(payload: BrowserFavoriteInput, user: User = Depends(get_current_account_user), db: Session = Depends(get_db)):
    return BrowserFavoritesService(db).create(user, payload)


@router.put("/{favorite_id}", response_model=BrowserFavoriteOut)
def update_favorite(favorite_id: str, payload: BrowserFavoriteInput, revision: int = Query(ge=1), user: User = Depends(get_current_account_user), db: Session = Depends(get_db)):
    return BrowserFavoritesService(db).mutate(user, favorite_id, revision, payload)


@router.delete("/{favorite_id}", status_code=204)
def delete_favorite(favorite_id: str, revision: int = Query(ge=1), user: User = Depends(get_current_account_user), db: Session = Depends(get_db)):
    BrowserFavoritesService(db).mutate(user, favorite_id, revision)
    return Response(status_code=204)
