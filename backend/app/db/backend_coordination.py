# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import BigInteger, Boolean, Column, JSON, String

from .base import Base


class BackendOperationLease(Base):
    __tablename__ = "backend_operation_leases"

    operation_name = Column(String, primary_key=True)
    lease_owner = Column(String, nullable=False)
    lease_until = Column(UTCDateTime(), nullable=False, index=True)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    lease_context = Column(JSON, nullable=True)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    payload = Column(JSON, nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)


class DeploymentConfiguration(Base):
    __tablename__ = "deployment_configuration"

    key = Column(String, primary_key=True)
    revision = Column(BigInteger, nullable=False, default=0)
    manifest_digest = Column(String(64), nullable=True)
    storage_endpoints_managed = Column(Boolean, nullable=False, default=False)
    locked_features = Column(JSON, nullable=False, default=list)
