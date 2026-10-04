# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Encrypted, durable intent for one unfinished RGW credential rotation."""
from sqlalchemy import CheckConstraint, Column, ForeignKey, Integer, String, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from app.db.base import Base
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow


class KeyRotationIntent(Base):
    __tablename__ = "key_rotation_intents"
    __table_args__ = (
        UniqueConstraint("endpoint_id", "key_type", "target_id", name="uq_key_rotation_intent_target"),
        CheckConstraint("phase IN ('prepared', 'activated')", name="ck_key_rotation_intent_phase"),
        CheckConstraint("key_type IN ('endpoint_admin', 'endpoint_runtime', 'endpoint_supervision', 'ceph_admin', 'account', 's3_user')", name="ck_key_rotation_intent_type"),
    )
    id = Column(Integer, primary_key=True)
    endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    key_type = Column(String(32), nullable=False)
    target_id = Column(Integer, nullable=False)
    rgw_uid = Column(String, nullable=False)
    tenant = Column(String, nullable=True)
    rgw_endpoint = Column(String, nullable=False)
    old_access_key = Column(String, nullable=False)
    new_access_key = Column(String, nullable=False)
    new_secret_key = Column(EncryptedString, nullable=False)
    deactivate_only = Column(Boolean, nullable=False, default=False)
    phase = Column(String(16), nullable=False, default="prepared")
    actor_email = Column(String, nullable=False, default="system")
    last_error = Column(String(256), nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)
    endpoint = relationship("StorageEndpoint", back_populates="key_rotation_intents")
