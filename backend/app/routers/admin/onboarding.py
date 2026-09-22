# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from uuid import UUID

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.onboarding import (
    OnboardingApply, OnboardingAttestation, OnboardingJourneyOut,
    OnboardingSave, OnboardingStatus, OnboardingVerify,
    OnboardingDraft, OnboardingPreview,
)
from app.routers.dependencies import get_current_super_admin, get_current_ui_superadmin
from app.services.identity_security_policy import require_admin_interactive_session, require_admin_sensitive_action
from app.services.onboarding_service import OnboardingError, OnboardingService
from app.services.rgw_admin import RGWAdminError


class _OnboardingRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError:
                # Validation runs before _run and may contain the entire raw
                # request, including malformed credentials and URL userinfo.
                raise HTTPException(status_code=422, detail={"code": "invalid_configuration"}) from None

        return handle


router = APIRouter(prefix="/admin/onboarding", tags=["admin-onboarding"], route_class=_OnboardingRoute)


def _run(action):
    try:
        return action()
    except OnboardingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=sanitize_error_detail({"code": exc.code})) from None
    except ClientError as exc:
        denied = exc.response.get("Error", {}).get("Code") in {"AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken"}
        raise HTTPException(status_code=400, detail={"code": "storage_access_denied" if denied else "storage_unavailable"}) from None
    except (BotoCoreError, RGWAdminError):
        raise HTTPException(status_code=400, detail={"code": "storage_unavailable"}) from None
    except (ValueError, RuntimeError):
        # Storage SDK errors and model reprs must never echo submitted keys.
        raise HTTPException(status_code=400, detail={"code": "configuration_failed"}) from None


@router.get("", response_model=OnboardingStatus)
def get_onboarding_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_super_admin)):
    return _run(lambda: OnboardingService(db).status(current_user))


@router.post("/dismiss", response_model=OnboardingStatus)
def dismiss_onboarding(db: Session = Depends(get_db), current_user: User = Depends(get_current_super_admin)):
    return _run(lambda: OnboardingService(db).dismiss(current_user))


@router.post("/preview", response_model=OnboardingPreview)
def preview_onboarding(payload: OnboardingDraft, journey_id: UUID | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_super_admin)):
    return _run(lambda: OnboardingService(db).preview_draft(current_user, payload, journey_id))


@router.post("/resume", response_model=OnboardingStatus)
def resume_onboarding(db: Session = Depends(get_db), current_user: User = Depends(get_current_super_admin)):
    return _run(lambda: OnboardingService(db).dismiss(current_user, False))


@router.put("/journeys/{journey_id}", response_model=OnboardingJourneyOut)
def save_onboarding_journey(journey_id: UUID, payload: OnboardingSave, db: Session = Depends(get_db), current_user: User = Depends(get_current_ui_superadmin)):
    return _run(lambda: OnboardingService(db).save(current_user, journey_id, payload))


@router.post("/journeys/{journey_id}/apply", response_model=OnboardingJourneyOut)
def apply_onboarding_journey(journey_id: UUID, payload: OnboardingApply, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_ui_superadmin)):
    require_admin_sensitive_action(request, db, current_user)
    return _run(lambda: OnboardingService(db).apply(current_user, journey_id, payload))


@router.post("/journeys/{journey_id}/verify", response_model=OnboardingJourneyOut)
def verify_onboarding_journey(journey_id: UUID, payload: OnboardingVerify, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_ui_superadmin)):
    # An admin:write API token must not acquire S3/Ceph execution through a
    # different surface's stored credentials. This guide runs in the UI session.
    require_admin_interactive_session(request, db, current_user)
    return _run(lambda: OnboardingService(db).verify(current_user, journey_id, payload.revision))


@router.post("/journeys/{journey_id}/attest", response_model=OnboardingJourneyOut)
def attest_onboarding_journey(journey_id: UUID, payload: OnboardingAttestation, db: Session = Depends(get_db), current_user: User = Depends(get_current_ui_superadmin)):
    return _run(lambda: OnboardingService(db).attest(current_user, journey_id, payload))
