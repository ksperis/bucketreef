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


class BillingUsageDaily(Base):
    __tablename__ = "billing_usage_daily"
    __table_args__ = (
        UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name="uq_billing_usage_daily",
        ),
        Index(
            "ix_billing_usage_daily_endpoint_day_account",
            "storage_endpoint_id",
            "day",
            "s3_account_id",
        ),
        Index(
            "uq_billing_usage_daily_account",
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "source",
            unique=True,
            postgresql_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        ),
        Index(
            "ix_billing_usage_daily_endpoint_day_user",
            "storage_endpoint_id",
            "day",
            "s3_user_id",
        ),
        Index(
            "uq_billing_usage_daily_user",
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


class BillingStorageDaily(Base):
    __tablename__ = "billing_storage_daily"
    __table_args__ = (
        UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name="uq_billing_storage_daily",
        ),
        Index(
            "ix_billing_storage_daily_endpoint_day_account",
            "storage_endpoint_id",
            "day",
            "s3_account_id",
        ),
        Index(
            "uq_billing_storage_daily_account",
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "source",
            unique=True,
            postgresql_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        ),
        Index(
            "ix_billing_storage_daily_endpoint_day_user",
            "storage_endpoint_id",
            "day",
            "s3_user_id",
        ),
        Index(
            "uq_billing_storage_daily_user",
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


class BillingRatePlan(Base):
    __tablename__ = "billing_rate_plans"
    __table_args__ = (
        Index(
            "uq_billing_rate_plans_global_name",
            "name",
            unique=True,
            sqlite_where=text("storage_endpoint_id IS NULL"),
            postgresql_where=text("storage_endpoint_id IS NULL"),
        ),
        Index(
            "uq_billing_rate_plans_endpoint_name",
            "storage_endpoint_id",
            "name",
            unique=True,
            sqlite_where=text("storage_endpoint_id IS NOT NULL"),
            postgresql_where=text("storage_endpoint_id IS NOT NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    versions = relationship(
        "BillingRateCard",
        back_populates="rate_plan",
        cascade="all, delete-orphan",
        order_by="BillingRateCard.effective_from",
    )


class BillingRateCard(Base):
    __tablename__ = "billing_rate_cards"
    __table_args__ = (
        CheckConstraint(
            "storage_charge_basis IN ('actual_usage', 'allocated_quota')",
            name="ck_billing_rate_cards_storage_charge_basis",
        ),
        UniqueConstraint("rate_plan_id", "effective_from", name="uq_billing_rate_cards_plan_effective"),
        Index(
            "ix_billing_rate_cards_plan_effective_window",
            "rate_plan_id",
            "effective_from",
            "effective_to",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    rate_plan_id = Column(Integer, ForeignKey("billing_rate_plans.id"), nullable=False, index=True)
    currency = Column(String, nullable=False, default="EUR", server_default="EUR")
    storage_charge_basis = Column(
        String,
        nullable=False,
        default="actual_usage",
        server_default="actual_usage",
    )
    storage_gb_month_price = Column(Numeric(12, 6), nullable=True)
    egress_gb_price = Column(Numeric(12, 6), nullable=True)
    ingress_gb_price = Column(Numeric(12, 6), nullable=True)
    requests_per_1000_price = Column(Numeric(12, 6), nullable=True)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)

    rate_plan = relationship("BillingRatePlan", back_populates="versions")


class BillingAssignment(Base):
    __tablename__ = "billing_assignments"
    __table_args__ = (
        Index(
            "ix_billing_assignments_endpoint_account_effective",
            "storage_endpoint_id",
            "s3_account_id",
            "effective_from",
            "effective_to",
        ),
        Index(
            "ix_billing_assignments_endpoint_user_effective",
            "storage_endpoint_id",
            "s3_user_id",
            "effective_from",
            "effective_to",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    storage_endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id"), nullable=False, index=True)
    s3_account_id = Column(Integer, ForeignKey("s3_accounts.id"), nullable=True, index=True)
    s3_user_id = Column(Integer, ForeignKey("s3_users.id"), nullable=True, index=True)
    rate_plan_id = Column(Integer, ForeignKey("billing_rate_plans.id"), nullable=False, index=True)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)

    storage_endpoint = relationship("StorageEndpoint")
    account = relationship("S3Account")
    s3_user = relationship("S3User")
    rate_plan = relationship("BillingRatePlan")
