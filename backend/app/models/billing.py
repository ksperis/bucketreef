# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel


class BillingCoverage(ApiModel):
    days_collected: int
    days_in_month: int
    coverage_ratio: float = Field(..., ge=0, le=1)
    storage_days_collected: Optional[int] = None
    usage_days_collected: Optional[int] = None


class BillingCost(ApiModel):
    currency: Optional[str] = None
    storage_cost: Optional[float] = None
    egress_cost: Optional[float] = None
    ingress_cost: Optional[float] = None
    requests_cost: Optional[float] = None
    total_cost: Optional[float] = None
    rate_card_name: Optional[str] = None


class BillingUsageTotals(ApiModel):
    bytes_in: int = 0
    bytes_out: int = 0
    ops_total: int = 0
    ops_breakdown: Optional[dict[str, int]] = None


class BillingStorageTotals(ApiModel):
    avg_bytes: Optional[int] = None
    avg_gb_month: Optional[float] = None
    total_objects: Optional[int] = None


class BillingSummary(ApiModel):
    month: str
    storage_endpoint_id: Optional[int] = None
    usage: BillingUsageTotals
    storage: BillingStorageTotals
    coverage: BillingCoverage
    cost: Optional[BillingCost] = None


class BillingSubjectSummary(ApiModel):
    subject_type: str
    subject_id: int
    name: str
    rgw_identifier: Optional[str] = None
    storage: BillingStorageTotals
    usage: BillingUsageTotals
    cost: Optional[BillingCost] = None


class BillingSubjectsResponse(ApiModel):
    items: list[BillingSubjectSummary]
    total: int
    page: int
    page_size: int
    has_next: bool


class BillingDailySeriesPoint(ApiModel):
    day: str
    storage_bytes: Optional[int] = None
    bytes_in: Optional[int] = None
    bytes_out: Optional[int] = None
    ops_total: Optional[int] = None


class BillingSubjectDetail(ApiModel):
    month: str
    subject_type: str
    subject_id: int
    name: str
    rgw_identifier: Optional[str] = None
    daily: list[BillingDailySeriesPoint]
    usage: BillingUsageTotals
    storage: BillingStorageTotals
    coverage: BillingCoverage
    cost: Optional[BillingCost] = None


class BillingRateCardPayload(ApiModel):
    name: str = Field(..., min_length=1, max_length=128)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    storage_charge_basis: Literal["actual_usage", "allocated_quota"] = "actual_usage"
    storage_gb_month_price: Optional[float] = Field(default=None, ge=0)
    egress_gb_price: Optional[float] = Field(default=None, ge=0)
    ingress_gb_price: Optional[float] = Field(default=None, ge=0)
    requests_per_1000_price: Optional[float] = Field(default=None, ge=0)
    effective_from: date
    effective_to: Optional[date] = None
    storage_endpoint_id: Optional[int] = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Rate card name is required")
        return normalized

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("Currency must be a 3-letter ISO code")
        return normalized

    @model_validator(mode="after")
    def validate_period(self):
        if self.effective_from.day != 1:
            raise ValueError("effective_from must be the first day of a month")
        if self.effective_to is not None:
            from calendar import monthrange
            if self.effective_to.day != monthrange(self.effective_to.year, self.effective_to.month)[1]:
                raise ValueError("effective_to must be the last day of a month")
            if self.effective_to < self.effective_from:
                raise ValueError("effective_to must not be before effective_from")
        if all(
            value is None
            for value in (
                self.storage_gb_month_price,
                self.egress_gb_price,
                self.ingress_gb_price,
                self.requests_per_1000_price,
            )
        ):
            raise ValueError("At least one billing price must be configured")
        return self


class BillingRateCardVersionCreate(ApiModel):
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    storage_charge_basis: Literal["actual_usage", "allocated_quota"] = "actual_usage"
    storage_gb_month_price: Optional[float] = Field(default=None, ge=0)
    egress_gb_price: Optional[float] = Field(default=None, ge=0)
    ingress_gb_price: Optional[float] = Field(default=None, ge=0)
    requests_per_1000_price: Optional[float] = Field(default=None, ge=0)
    effective_from: date

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("Currency must be a 3-letter ISO code")
        return normalized

    @model_validator(mode="after")
    def validate_payload(self):
        if self.effective_from.day != 1:
            raise ValueError("effective_from must be the first day of a month")
        if all(
            value is None
            for value in (
                self.storage_gb_month_price,
                self.egress_gb_price,
                self.ingress_gb_price,
                self.requests_per_1000_price,
            )
        ):
            raise ValueError("At least one billing price must be configured")
        return self


class BillingRateCardAdminItem(ApiModel):
    id: int
    rate_plan_id: int
    name: str
    currency: str
    storage_charge_basis: Literal["actual_usage", "allocated_quota"]
    storage_gb_month_price: Optional[float] = None
    egress_gb_price: Optional[float] = None
    ingress_gb_price: Optional[float] = None
    requests_per_1000_price: Optional[float] = None
    effective_from: date
    effective_to: Optional[date] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    status: Literal["future", "active", "expired"]
    editable: bool
    identity_editable: bool
    deletable: bool
    created_at: datetime
    updated_at: datetime
