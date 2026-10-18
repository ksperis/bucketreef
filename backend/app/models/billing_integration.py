# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel


BillingIntegrationSubjectType = Literal["account", "s3_user"]
BillingIntegrationStorageBasis = Literal["actual_usage", "allocated_quota"]


class BillingIntegrationEntityV1(ApiModel):
    id: int
    name: str
    code: Optional[str] = None
    external_id: Optional[str] = None
    subject_type: BillingIntegrationSubjectType
    active: bool


class BillingIntegrationGroupMembershipV1(ApiModel):
    billing_entity_id: int
    billing_entity_name: str
    billing_entity_code: Optional[str] = None
    billing_entity_external_id: Optional[str] = None
    billing_entity_active: bool
    effective_from: date
    effective_to: Optional[date] = None


class BillingIntegrationGroupV1(ApiModel):
    id: int
    name: str
    code: Optional[str] = None
    external_id: Optional[str] = None
    description: Optional[str] = None
    active: bool
    membership_month: Optional[str] = None
    memberships: list[BillingIntegrationGroupMembershipV1] = Field(default_factory=list)


class BillingIntegrationCoverageV1(ApiModel):
    member_count: int
    expected_daily_observations: int
    storage_observations: int
    usage_observations: int
    storage_coverage_ratio: Decimal
    usage_coverage_ratio: Decimal
    quota_observations_collected: int
    quota_observations_expected: int
    quota_coverage_ratio: Optional[Decimal] = None


class BillingIntegrationStatementSummaryV1(ApiModel):
    statement_id: int
    statement_public_id: str
    billing_entity_id: int
    billing_entity_name: str
    billing_entity_code: Optional[str] = None
    billing_entity_external_id: Optional[str] = None
    subject_type: BillingIntegrationSubjectType
    period_start: date
    period_end: date
    currency: str
    member_count: int
    coverage: BillingIntegrationCoverageV1
    storage_charge_bases: list[BillingIntegrationStorageBasis] = Field(default_factory=list)
    subtotal: Decimal
    total: Decimal
    revision: int
    generated_at: datetime
    finalized_at: datetime


class BillingIntegrationMembershipReasonV1(ApiModel):
    kind: Literal["tag", "explicit_include", "explicit_exclude"]
    tag_definition_id: Optional[int] = None
    label: Optional[str] = None


class BillingIntegrationUsageV1(ApiModel):
    bytes_in: int
    bytes_out: int
    ops_total: int
    ops_breakdown: Optional[dict[str, int]] = None


class BillingIntegrationStorageV1(ApiModel):
    avg_bytes: Optional[int] = None
    measured_gib_month: Optional[Decimal] = None
    total_objects: Optional[int] = None


class BillingIntegrationLineCoverageV1(ApiModel):
    days_collected: int
    days_in_month: int
    coverage_ratio: float
    storage_days_collected: Optional[int] = None
    usage_days_collected: Optional[int] = None


class BillingIntegrationPricedStorageQuantityV1(ApiModel):
    basis: BillingIntegrationStorageBasis
    quantity_gib_month: Optional[Decimal] = None
    observations_collected: int
    observations_expected: int
    calendar_days: int
    coverage_ratio: Decimal
    status: Literal["complete", "partial", "blocked"]
    issues: list[str] = Field(default_factory=list)


class BillingIntegrationRateResolutionV1(ApiModel):
    status: Literal["resolved", "missing", "conflict"]
    layer: Optional[Literal["direct", "billing_entity", "endpoint", "global"]] = None
    rate_plan_id: Optional[int] = None
    rate_plan_name: Optional[str] = None
    rate_card_id: Optional[int] = None
    rate_card_effective_from: Optional[date] = None
    rate_card_effective_to: Optional[date] = None
    source_assignment_id: Optional[int] = None
    billing_entity_id: Optional[int] = None
    billing_entity_name: Optional[str] = None
    conflicting_billing_entity_ids: list[int] = Field(default_factory=list)
    conflicting_billing_entity_names: list[str] = Field(default_factory=list)
    currency: Optional[str] = None
    storage_charge_basis: Optional[BillingIntegrationStorageBasis] = None
    issues: list[str] = Field(default_factory=list)


class BillingIntegrationUnitPricesV1(ApiModel):
    storage_gb_month_price: Optional[Decimal] = None
    egress_gb_price: Optional[Decimal] = None
    ingress_gb_price: Optional[Decimal] = None
    requests_per_1000_price: Optional[Decimal] = None


class BillingIntegrationAmountsV1(ApiModel):
    storage_cost: Optional[Decimal] = None
    egress_cost: Optional[Decimal] = None
    ingress_cost: Optional[Decimal] = None
    requests_cost: Optional[Decimal] = None
    total_cost: Optional[Decimal] = None


class BillingIntegrationStatementLineV1(ApiModel):
    line_index: int
    subject_type: BillingIntegrationSubjectType
    subject_id: int
    subject_name: str
    rgw_identifier: str
    membership_reasons: list[BillingIntegrationMembershipReasonV1] = Field(default_factory=list)
    membership_conflict: bool
    included_in_total: bool
    storage_endpoint_id: int
    storage_endpoint_name: str
    usage: BillingIntegrationUsageV1
    storage: BillingIntegrationStorageV1
    coverage: BillingIntegrationLineCoverageV1
    storage_charge_basis: Optional[BillingIntegrationStorageBasis] = None
    priced_storage_quantity: Optional[BillingIntegrationPricedStorageQuantityV1] = None
    rate_resolution: BillingIntegrationRateResolutionV1
    unit_prices: BillingIntegrationUnitPricesV1
    amounts: BillingIntegrationAmountsV1
    complete: bool
    issues: list[str] = Field(default_factory=list)


class BillingIntegrationStatementDetailV1(BillingIntegrationStatementSummaryV1):
    lines: list[BillingIntegrationStatementLineV1] = Field(default_factory=list)


class BillingIntegrationStatementPageV1(ApiModel):
    items: list[BillingIntegrationStatementSummaryV1] = Field(default_factory=list)
    limit: int
    has_more: bool
    next_cursor: Optional[str] = None


class BillingIntegrationCurrencyTotalV1(ApiModel):
    currency: str
    storage_cost: Decimal
    egress_cost: Decimal
    ingress_cost: Decimal
    requests_cost: Decimal
    total: Decimal
    statement_ids: list[int] = Field(default_factory=list)
    statement_public_ids: list[str] = Field(default_factory=list)
    statement_months: list[str] = Field(default_factory=list)
    storage_charge_bases: list[BillingIntegrationStorageBasis] = Field(default_factory=list)


class BillingIntegrationEntityContributionV1(ApiModel):
    billing_entity_id: int
    billing_entity_name: str
    billing_entity_code: Optional[str] = None
    billing_entity_external_id: Optional[str] = None
    statement_ids: list[int] = Field(default_factory=list)
    currency_totals: list[BillingIntegrationCurrencyTotalV1] = Field(default_factory=list)


class BillingIntegrationPeriodMonthV1(ApiModel):
    month: str
    member_entity_ids: list[int] = Field(default_factory=list)
    finalized_entity_ids: list[int] = Field(default_factory=list)
    missing_entity_ids: list[int] = Field(default_factory=list)
    unfinalized_entity_ids: list[int] = Field(default_factory=list)
    statement_ids: list[int] = Field(default_factory=list)
    currency_totals: list[BillingIntegrationCurrencyTotalV1] = Field(default_factory=list)
    entity_contributions: list[BillingIntegrationEntityContributionV1] = Field(default_factory=list)
    complete: bool


class BillingIntegrationPeriodV1(ApiModel):
    period_type: Literal["month", "year", "range"]
    scope_type: Literal["entity", "group"]
    scope_id: int
    scope_name: str
    scope_code: Optional[str] = None
    scope_external_id: Optional[str] = None
    start_month: str
    end_month: str
    expected_months: list[str] = Field(default_factory=list)
    finalized_months: list[str] = Field(default_factory=list)
    missing_months: list[str] = Field(default_factory=list)
    unfinalized_months: list[str] = Field(default_factory=list)
    currency_totals: list[BillingIntegrationCurrencyTotalV1] = Field(default_factory=list)
    months: list[BillingIntegrationPeriodMonthV1] = Field(default_factory=list)
    complete: bool
