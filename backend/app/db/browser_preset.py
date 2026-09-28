# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow


class BrowserPreset(Base):
    __tablename__ = "browser_presets"
    __table_args__ = (Index("ix_browser_presets_user_surface", "user_id", "surface"),)
    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    surface = Column(String(24), nullable=False)
    payload_json = Column(Text, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    user = relationship("User", back_populates="browser_presets")
