# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from decimal import Decimal
from typing import Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel
from app.models.retention import DataRetentionResult


class CostEndpointCollectionError(ApiModel):
    stage: Literal["endpoint"]
    endpoint_id: int


class CostSubjectCollectionError(ApiModel):
    stage: Literal["usage", "storage"]
    endpoint_id: int
    subject: Literal["account", "s3_user"]
    subject_id: int


CostCollectionError = CostEndpointCollectionError | CostSubjectCollectionError


class CostCollectionResult(ApiModel):
    day: str
    endpoints: int
    usage_records: int
    storage_records: int
    errors: list[CostCollectionError]
    retention: DataRetentionResult


class CostCoverage(ApiModel):
    days_collected: int
    days_in_month: int
    coverage_ratio: float = Field(..., ge=0, le=1)
    storage_days_collected: Optional[int]
    usage_days_collected: Optional[int]


class CostBreakdown(ApiModel):
    currency: Optional[str]
    storage_cost: Optional[float]
    egress_cost: Optional[float]
    ingress_cost: Optional[float]
    requests_cost: Optional[float]
    total_cost: Optional[float]
    pricing_source: Optional[str]


class CostUsageTotals(ApiModel):
    bytes_in: int
    bytes_out: int
    ops_total: int
    ops_breakdown: Optional[dict[str, int]]


class CostStorageTotals(ApiModel):
    avg_bytes: Optional[int]
    avg_gb_month: Optional[float]
    total_objects: Optional[int]


class CostSummary(ApiModel):
    month: str
    storage_endpoint_id: Optional[int]
    usage: CostUsageTotals
    storage: CostStorageTotals
    coverage: CostCoverage
    cost: Optional[CostBreakdown]


class CostSubjectSummary(ApiModel):
    storage_endpoint_id: int
    storage_endpoint_name: str
    subject_type: str
    subject_id: int
    name: str
    rgw_identifier: Optional[str]
    storage: CostStorageTotals
    usage: CostUsageTotals
    cost: Optional[CostBreakdown]


class CostSubjectsResponse(ApiModel):
    items: list[CostSubjectSummary]
    total: int
    page: int
    page_size: int
    has_next: bool


class CostDailySeriesPoint(ApiModel):
    day: str
    storage_bytes: Optional[int]
    bytes_in: Optional[int]
    bytes_out: Optional[int]
    ops_total: Optional[int]


class CostSubjectDetail(ApiModel):
    month: str
    storage_endpoint_id: int
    storage_endpoint_name: str
    subject_type: str
    subject_id: int
    name: str
    rgw_identifier: Optional[str]
    daily: list[CostDailySeriesPoint]
    usage: CostUsageTotals
    storage: CostStorageTotals
    coverage: CostCoverage
    cost: Optional[CostBreakdown]


class CostSubjectHistoryPoint(ApiModel):
    month: str
    coverage: CostCoverage
    cost: Optional[CostBreakdown]


class AdminCostSubjectDetail(CostSubjectDetail):
    history: list[CostSubjectHistoryPoint]


class CostAnalyticsEndpoint(ApiModel):
    storage_endpoint_id: int
    storage_endpoint_name: str
    coverage: CostCoverage
    cost: Optional[CostBreakdown]


class CostAnalyticsHistoryPoint(ApiModel):
    month: str
    coverage: CostCoverage
    cost: Optional[CostBreakdown]


class CostAnalyticsConcentration(ApiModel):
    top_five_cost: float
    other_cost: float
    subject_total_cost: float
    top_five_ratio: float = Field(..., ge=0, le=1)


class CostAnalyticsResponse(ApiModel):
    month: str
    storage_endpoint_id: Optional[int]
    subject_type: str
    summary: CostSummary
    by_endpoint: list[CostAnalyticsEndpoint]
    top_subjects: list[CostSubjectSummary]
    concentration: CostAnalyticsConcentration
    history: list[CostAnalyticsHistoryPoint]


class CostRateValues(ApiModel):
    storage_gb_month_price: Decimal = Field(..., ge=0, max_digits=12, decimal_places=6)
    egress_gb_price: Decimal = Field(..., ge=0, max_digits=12, decimal_places=6)
    ingress_gb_price: Decimal = Field(..., ge=0, max_digits=12, decimal_places=6)
    requests_per_1000_price: Decimal = Field(..., ge=0, max_digits=12, decimal_places=6)


class CostGlobalModel(CostRateValues):
    currency: str = Field(..., min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().upper()
        return value


class CostEndpointOverride(CostRateValues):
    storage_endpoint_id: int = Field(..., ge=1)


class CostSettings(ApiModel):
    model: Optional[CostGlobalModel]
    endpoint_overrides: list[CostEndpointOverride]

    @model_validator(mode="after")
    def validate_configuration(self) -> "CostSettings":
        if self.model is None and self.endpoint_overrides:
            raise ValueError("Endpoint overrides require a global cost model")
        endpoint_ids = [item.storage_endpoint_id for item in self.endpoint_overrides]
        if len(endpoint_ids) != len(set(endpoint_ids)):
            raise ValueError("Only one cost override is allowed per endpoint")
        return self
