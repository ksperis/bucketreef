# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text

from app.db.base import Base
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow


class OnboardingPreference(Base):
    __tablename__ = "onboarding_preferences"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    dismissed = Column(Boolean, nullable=False, default=False)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)


class OnboardingJourney(Base):
    """Secret-free progress; resource credentials remain in their existing stores."""

    __tablename__ = "onboarding_journeys"

    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    revision = Column(Integer, nullable=False, default=1)
    draft_json = Column(Text, nullable=False)
    resources_json = Column(Text, nullable=False, default="{}")
    evidence_json = Column(Text, nullable=False, default="{}")
    readiness_json = Column(Text, nullable=False, default="{}")
    pending_step = Column(String(40), nullable=True)
    configured_at = Column(UTCDateTime(), nullable=True)
    validated_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)
