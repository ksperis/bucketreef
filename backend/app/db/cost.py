# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship

from .base import Base


class CostUsageDaily(Base):
    __tablename__ = "cost_usage_daily"
    __table_args__ = (
        UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name="uq_cost_usage_daily",
        ),
        Index(
            "ix_cost_usage_daily_endpoint_day_account",
            "storage_endpoint_id",
            "day",
            "s3_account_id",
        ),
        Index(
            "uq_cost_usage_daily_account",
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "source",
            unique=True,
            postgresql_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        ),
        Index(
            "ix_cost_usage_daily_endpoint_day_user",
            "storage_endpoint_id",
            "day",
            "s3_user_id",
        ),
        Index(
            "uq_cost_usage_daily_user",
            "day",
            "storage_endpoint_id",
            "s3_user_id",
            "source",
            unique=True,
            postgresql_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
            sqlite_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    day = Column(Date, nullable=False, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    s3_account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=True, index=True)
    bytes_in = Column(BigInteger, nullable=False, default=0, server_default="0")
    bytes_out = Column(BigInteger, nullable=False, default=0, server_default="0")
    ops_total = Column(BigInteger, nullable=False, default=0, server_default="0")
    ops_breakdown = Column(Text, nullable=True)
    source = Column(String, nullable=False, default="rgw_admin_usage")
    collected_at = Column(UTCDateTime(), nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")


class CostStorageDaily(Base):
    __tablename__ = "cost_storage_daily"
    __table_args__ = (
        UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name="uq_cost_storage_daily",
        ),
        Index(
            "ix_cost_storage_daily_endpoint_day_account",
            "storage_endpoint_id",
            "day",
            "s3_account_id",
        ),
        Index(
            "uq_cost_storage_daily_account",
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "source",
            unique=True,
            postgresql_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        ),
        Index(
            "ix_cost_storage_daily_endpoint_day_user",
            "storage_endpoint_id",
            "day",
            "s3_user_id",
        ),
        Index(
            "uq_cost_storage_daily_user",
            "day",
            "storage_endpoint_id",
            "s3_user_id",
            "source",
            unique=True,
            postgresql_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
            sqlite_where=text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    day = Column(Date, nullable=False, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    s3_account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=True, index=True)
    total_bytes = Column(BigInteger, nullable=False, default=0, server_default="0")
    total_objects = Column(BigInteger, nullable=False, default=0, server_default="0")
    by_bucket = Column(Text, nullable=True)
    source = Column(String, nullable=False, default="rgw_admin_bucket_stats")
    collected_at = Column(UTCDateTime(), nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")


class CostModel(Base):
    __tablename__ = "cost_models"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_cost_models_singleton"),
        CheckConstraint("storage_gb_month_price >= 0", name="ck_cost_models_storage_price_nonnegative"),
        CheckConstraint("egress_gb_price >= 0", name="ck_cost_models_egress_price_nonnegative"),
        CheckConstraint("ingress_gb_price >= 0", name="ck_cost_models_ingress_price_nonnegative"),
        CheckConstraint("requests_per_1000_price >= 0", name="ck_cost_models_requests_price_nonnegative"),
    )

    id = Column(Integer, primary_key=True, default=1)
    currency = Column(String, nullable=False, default="EUR", server_default="EUR")
    storage_gb_month_price = Column(Numeric(12, 6), nullable=False)
    egress_gb_price = Column(Numeric(12, 6), nullable=False)
    ingress_gb_price = Column(Numeric(12, 6), nullable=False)
    requests_per_1000_price = Column(Numeric(12, 6), nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)


class CostEndpointOverride(Base):
    __tablename__ = "cost_endpoint_overrides"
    __table_args__ = (
        UniqueConstraint("storage_endpoint_id", name="uq_cost_endpoint_overrides_endpoint"),
        CheckConstraint(
            "storage_gb_month_price >= 0",
            name="ck_cost_endpoint_overrides_storage_price_nonnegative",
        ),
        CheckConstraint("egress_gb_price >= 0", name="ck_cost_endpoint_overrides_egress_price_nonnegative"),
        CheckConstraint("ingress_gb_price >= 0", name="ck_cost_endpoint_overrides_ingress_price_nonnegative"),
        CheckConstraint(
            "requests_per_1000_price >= 0",
            name="ck_cost_endpoint_overrides_requests_price_nonnegative",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(
        Integer,
        ForeignKey("storage_endpoints.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    storage_gb_month_price = Column(Numeric(12, 6), nullable=False)
    egress_gb_price = Column(Numeric(12, 6), nullable=False)
    ingress_gb_price = Column(Numeric(12, 6), nullable=False)
    requests_per_1000_price = Column(Numeric(12, 6), nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
