# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from .base import Base


class ManagerAccessKeyMetadata(Base):
    __tablename__ = "manager_access_key_metadata"
    __table_args__ = (
        CheckConstraint(
            "(account_id IS NOT NULL AND s3_user_id IS NULL AND principal_name IS NOT NULL) OR "
            "(account_id IS NULL AND s3_user_id IS NOT NULL AND principal_name IS NULL)",
            name="ck_manager_access_key_metadata_scope",
        ),
        UniqueConstraint(
            "account_id",
            "principal_name",
            "access_key_id",
            name="uq_manager_access_key_metadata_iam",
        ),
        UniqueConstraint(
            "s3_user_id",
            "access_key_id",
            name="uq_manager_access_key_metadata_s3_user",
        ),
        Index("ix_manager_access_key_metadata_access_key", "access_key_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id", ondelete="CASCADE"), nullable=True)
    principal_name = Column(String(256), nullable=True)
    access_key_id = Column(String(256), nullable=False)
    name = Column(String(128), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)
