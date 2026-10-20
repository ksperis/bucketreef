# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel


class CostCoverage(ApiModel):
    days_collected: int
    days_in_month: int
    coverage_ratio: float = Field(..., ge=0, le=1)
    storage_days_collected: Optional[int] = None
    usage_days_collected: Optional[int] = None


class CostBreakdown(ApiModel):
    currency: Optional[str] = None
    storage_cost: Optional[float] = None
    egress_cost: Optional[float] = None
    ingress_cost: Optional[float] = None
    requests_cost: Optional[float] = None
    total_cost: Optional[float] = None
    pricing_source: Optional[str] = None


class CostUsageTotals(ApiModel):
    bytes_in: int = 0
    bytes_out: int = 0
    ops_total: int = 0
    ops_breakdown: Optional[dict[str, int]] = None


class CostStorageTotals(ApiModel):
    avg_bytes: Optional[int] = None
    avg_gb_month: Optional[float] = None
    total_objects: Optional[int] = None


class CostSummary(ApiModel):
    month: str
    storage_endpoint_id: Optional[int] = None
    usage: CostUsageTotals
    storage: CostStorageTotals
    coverage: CostCoverage
    cost: Optional[CostBreakdown] = None


class CostSubjectSummary(ApiModel):
    subject_type: str
    subject_id: int
    name: str
    rgw_identifier: Optional[str] = None
    storage: CostStorageTotals
    usage: CostUsageTotals
    cost: Optional[CostBreakdown] = None


class CostSubjectsResponse(ApiModel):
    items: list[CostSubjectSummary]
    total: int
    page: int
    page_size: int
    has_next: bool


class CostDailySeriesPoint(ApiModel):
    day: str
    storage_bytes: Optional[int] = None
    bytes_in: Optional[int] = None
    bytes_out: Optional[int] = None
    ops_total: Optional[int] = None


class CostSubjectDetail(ApiModel):
    month: str
    subject_type: str
    subject_id: int
    name: str
    rgw_identifier: Optional[str] = None
    daily: list[CostDailySeriesPoint]
    usage: CostUsageTotals
    storage: CostStorageTotals
    coverage: CostCoverage
    cost: Optional[CostBreakdown] = None


class CostRateValues(ApiModel):
    storage_gb_month_price: Decimal = Field(..., ge=0, max_digits=12, decimal_places=6)
    egress_gb_price: Decimal = Field(..., ge=0, max_digits=12, decimal_places=6)
    ingress_gb_price: Decimal = Field(..., ge=0, max_digits=12, decimal_places=6)
    requests_per_1000_price: Decimal = Field(..., ge=0, max_digits=12, decimal_places=6)


class CostGlobalModel(CostRateValues):
    currency: str = Field(default="EUR", min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().upper()
        return value


class CostEndpointOverride(CostRateValues):
    storage_endpoint_id: int = Field(..., ge=1)


class CostSettings(ApiModel):
    model: Optional[CostGlobalModel] = None
    endpoint_overrides: list[CostEndpointOverride] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_configuration(self) -> "CostSettings":
        if self.model is None and self.endpoint_overrides:
            raise ValueError("Endpoint overrides require a global cost model")
        endpoint_ids = [item.storage_endpoint_id for item in self.endpoint_overrides]
        if len(endpoint_ids) != len(set(endpoint_ids)):
            raise ValueError("Only one cost override is allowed per endpoint")
        return self
