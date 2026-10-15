# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from .base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('success', 'failure', 'partial')",
            name="ck_audit_logs_status",
        ),
        Index("ix_audit_logs_scope_id", "scope", "id"),
        Index("ix_audit_logs_context_kind_id_id", "context_kind", "context_id", "id"),
        Index("ix_audit_logs_user_id_id", "user_id", "id"),
        Index("ix_audit_logs_user_role_id", "user_role", "id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_email = Column(String, nullable=False)
    user_role = Column(String, nullable=False)
    scope = Column(String, nullable=False)  # e.g. admin / manager
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    context_kind = Column(String, nullable=True)
    context_id = Column(String, nullable=True)
    context_name = Column(String, nullable=True)
    status = Column(String, nullable=False, default="success")
    message = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)
    request_id = Column(String, nullable=True, index=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)

    user = relationship("User", lazy="joined")
