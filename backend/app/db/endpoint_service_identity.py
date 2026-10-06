# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from app.db.base import Base
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow


class EndpointServiceIdentity(Base):
    __tablename__ = "endpoint_service_identities"
    __table_args__ = (
        UniqueConstraint("endpoint_id", "kind", name="uq_endpoint_service_identity_kind"),
        CheckConstraint("kind IN ('runtime', 'supervision', 'ceph_admin')", name="ck_endpoint_service_identity_kind"),
        CheckConstraint("mode IN ('managed', 'external')", name="ck_endpoint_service_identity_mode"),
        CheckConstraint("kind != 'ceph_admin' OR mode = 'external'", name="ck_endpoint_service_identity_ceph_admin_external"),
        CheckConstraint("status IN ('not_provisioned', 'missing', 'provisioning', 'ready', 'error', 'revocation_pending', 'disabled')", name="ck_endpoint_service_identity_status"),
    )
    id = Column(Integer, primary_key=True)
    endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(24), nullable=False)
    mode = Column(String(16), nullable=False, default="external")
    rgw_uid = Column(String(128), nullable=True)
    access_key = Column(String, nullable=True)
    secret_key = Column(EncryptedString, nullable=True)
    provenance = Column(String(128), nullable=True)
    legacy_system_compat = Column(Boolean, nullable=False, default=False, server_default="0")
    status = Column(String(24), nullable=False, default="missing")
    last_error = Column(String(256), nullable=True)
    last_reconciled_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)
    endpoint = relationship("StorageEndpoint", back_populates="service_identities")
