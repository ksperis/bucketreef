# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.db import User
from app.models.browser_presets import BrowserPresetInput, BrowserPresetOut, BrowserPresetSurface
from app.routers.dependencies import get_current_account_user
from app.services.browser_presets_service import BrowserPresetsService

router = APIRouter(prefix="/me/browser-presets")


@router.get("", response_model=list[BrowserPresetOut])
def list_presets(surface: BrowserPresetSurface = "browser", user: User = Depends(get_current_account_user), db: Session = Depends(get_db)):
    return BrowserPresetsService(db).list(user, surface)


@router.post("", response_model=BrowserPresetOut, status_code=201)
def create_preset(payload: BrowserPresetInput, user: User = Depends(get_current_account_user), db: Session = Depends(get_db)):
    return BrowserPresetsService(db).create(user, payload)


@router.put("/{preset_id}", response_model=BrowserPresetOut)
def update_preset(preset_id: str, payload: BrowserPresetInput, revision: int = Query(ge=1), user: User = Depends(get_current_account_user), db: Session = Depends(get_db)):
    return BrowserPresetsService(db).mutate(user, preset_id, revision, payload)


@router.delete("/{preset_id}", status_code=204)
def delete_preset(preset_id: str, revision: int = Query(ge=1), user: User = Depends(get_current_account_user), db: Session = Depends(get_db)):
    BrowserPresetsService(db).mutate(user, preset_id, revision)
    return Response(status_code=204)
