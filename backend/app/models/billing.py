# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel
from app.models.tagging import TagDefinitionSummary


class BillingCoverage(ApiModel):
    days_collected: int
    days_in_month: int
    coverage_ratio: float = Field(..., ge=0, le=1)
    storage_days_collected: Optional[int] = None
    usage_days_collected: Optional[int] = None


class BillingCost(ApiModel):
    currency: Optional[str] = None
    storage_cost: Optional[Decimal] = None
    egress_cost: Optional[Decimal] = None
    ingress_cost: Optional[Decimal] = None
    requests_cost: Optional[Decimal] = None
    total_cost: Optional[Decimal] = None
    rate_card_name: Optional[str] = None
    storage_quantity: Optional["BillingStorageChargeQuantity"] = None
    complete: bool = True


class BillingStorageChargeQuantity(ApiModel):
    basis: Literal["actual_usage", "allocated_quota"]
    quantity_gib_month: Optional[Decimal] = None
    observations_collected: int
    observations_expected: int
    calendar_days: int
    coverage_ratio: Decimal = Field(..., ge=0, le=1)
    status: Literal["complete", "partial", "blocked"]
    issues: list[str] = Field(default_factory=list)


class BillingUsageTotals(ApiModel):
    bytes_in: int = 0
    bytes_out: int = 0
    ops_total: int = 0
    ops_breakdown: Optional[dict[str, int]] = None


class BillingStorageTotals(ApiModel):
    avg_bytes: Optional[int] = None
    avg_gb_month: Optional[Decimal] = None
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
    quota_size_bytes: Optional[int] = None
    quota_state: Optional[Literal["valid", "missing", "disabled", "unlimited", "invalid"]] = None
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
    storage_gb_month_price: Optional[Decimal] = Field(default=None, ge=0)
    egress_gb_price: Optional[Decimal] = Field(default=None, ge=0)
    ingress_gb_price: Optional[Decimal] = Field(default=None, ge=0)
    requests_per_1000_price: Optional[Decimal] = Field(default=None, ge=0)
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
    storage_gb_month_price: Optional[Decimal] = Field(default=None, ge=0)
    egress_gb_price: Optional[Decimal] = Field(default=None, ge=0)
    ingress_gb_price: Optional[Decimal] = Field(default=None, ge=0)
    requests_per_1000_price: Optional[Decimal] = Field(default=None, ge=0)
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
    storage_gb_month_price: Optional[Decimal] = None
    egress_gb_price: Optional[Decimal] = None
    ingress_gb_price: Optional[Decimal] = None
    requests_per_1000_price: Optional[Decimal] = None
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


BillingSubjectType = Literal["account", "s3_user"]


class BillingEntitySubjectReference(ApiModel):
    subject_type: BillingSubjectType
    subject_id: int
    name: str
    rgw_identifier: str
    storage_endpoint_id: int
    storage_endpoint_name: str


class BillingEntityRateAssignmentInput(ApiModel):
    rate_plan_id: int = Field(..., ge=1)
    effective_from: date
    effective_to: Optional[date] = None

    @model_validator(mode="after")
    def validate_period(self):
        if self.effective_from.day != 1:
            raise ValueError("effective_from must be the first day of a month")
        if self.effective_to is not None:
            last_day = monthrange(self.effective_to.year, self.effective_to.month)[1]
            if self.effective_to.day != last_day:
                raise ValueError("effective_to must be the last day of a month")
            if self.effective_to < self.effective_from:
                raise ValueError("effective_to must not be before effective_from")
        return self


class BillingEntityRateAssignmentItem(BillingEntityRateAssignmentInput):
    id: int
    rate_plan_name: str
    created_at: datetime
    updated_at: datetime


class BillingEntityPayload(ApiModel):
    name: str = Field(..., min_length=1, max_length=160)
    code: Optional[str] = Field(default=None, max_length=80)
    external_id: Optional[str] = Field(default=None, max_length=160)
    subject_type: BillingSubjectType
    include_tag_ids: list[int] = Field(default_factory=list)
    explicit_include_ids: list[int] = Field(default_factory=list)
    explicit_exclude_ids: list[int] = Field(default_factory=list)
    rate_assignments: list[BillingEntityRateAssignmentInput] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def normalize_entity_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Billing Entity name is required")
        return normalized

    @field_validator("code", "external_id")
    @classmethod
    def normalize_optional_identifier(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("include_tag_ids", "explicit_include_ids", "explicit_exclude_ids")
    @classmethod
    def normalize_id_lists(cls, value: list[int]) -> list[int]:
        normalized = sorted(set(int(item) for item in value))
        if any(item <= 0 for item in normalized):
            raise ValueError("IDs must be positive integers")
        return normalized


class BillingEntityAdminItem(ApiModel):
    id: int
    name: str
    code: Optional[str] = None
    external_id: Optional[str] = None
    subject_type: BillingSubjectType
    active: bool
    include_tags: list[TagDefinitionSummary] = Field(default_factory=list)
    explicit_includes: list[BillingEntitySubjectReference] = Field(default_factory=list)
    explicit_excludes: list[BillingEntitySubjectReference] = Field(default_factory=list)
    rate_assignments: list[BillingEntityRateAssignmentItem] = Field(default_factory=list)
    member_count: int = 0
    conflict_count: int = 0
    created_at: datetime
    updated_at: datetime


class BillingEntityMembershipReason(ApiModel):
    kind: Literal["tag", "explicit_include", "explicit_exclude"]
    tag_definition_id: Optional[int] = None
    label: Optional[str] = None


class BillingEntityResolvedSubject(BillingEntitySubjectReference):
    reasons: list[BillingEntityMembershipReason] = Field(default_factory=list)


class BillingEntityResolution(ApiModel):
    entity_id: Optional[int] = None
    entity_name: str
    subject_type: BillingSubjectType
    members: list[BillingEntityResolvedSubject] = Field(default_factory=list)
    excluded: list[BillingEntityResolvedSubject] = Field(default_factory=list)


class BillingEntityConflictEntity(ApiModel):
    entity_id: Optional[int] = None
    entity_name: str


class BillingEntityConflict(ApiModel):
    subject: BillingEntitySubjectReference
    entities: list[BillingEntityConflictEntity]


class BillingEntityResolutionResult(ApiModel):
    entities: list[BillingEntityResolution]
    unassigned: list[BillingEntitySubjectReference]
    conflicts: list[BillingEntityConflict]


class BillingEntityGroupMembershipInput(ApiModel):
    billing_entity_id: int = Field(..., ge=1)
    effective_from: date
    effective_to: Optional[date] = None

    @model_validator(mode="after")
    def validate_period(self):
        if self.effective_from.day != 1:
            raise ValueError("effective_from must be the first day of a month")
        if self.effective_to is not None:
            last_day = monthrange(self.effective_to.year, self.effective_to.month)[1]
            if self.effective_to.day != last_day:
                raise ValueError("effective_to must be the last day of a month")
            if self.effective_to < self.effective_from:
                raise ValueError("effective_to must not be before effective_from")
        return self


class BillingEntityGroupMembershipItem(BillingEntityGroupMembershipInput):
    id: int
    billing_entity_name: str
    billing_entity_code: Optional[str] = None
    billing_entity_active: bool
    status: Literal["historical", "current", "future"]
    created_at: datetime
    updated_at: datetime


class BillingEntityGroupPayload(ApiModel):
    name: str = Field(..., min_length=1, max_length=160)
    code: Optional[str] = Field(default=None, max_length=80)
    external_id: Optional[str] = Field(default=None, max_length=160)
    description: Optional[str] = Field(default=None, max_length=2000)
    memberships: list[BillingEntityGroupMembershipInput] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def normalize_group_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Billing Entity Group name is required")
        return normalized

    @field_validator("code", "external_id", "description")
    @classmethod
    def normalize_group_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class BillingEntityGroupAdminItem(ApiModel):
    id: int
    name: str
    code: Optional[str] = None
    external_id: Optional[str] = None
    description: Optional[str] = None
    active: bool
    memberships: list[BillingEntityGroupMembershipItem] = Field(default_factory=list)
    current_member_count: int = 0
    scheduled_membership_count: int = 0
    created_at: datetime
    updated_at: datetime


class BillingEntityGroupPreviewAmount(ApiModel):
    billing_entity_id: int = Field(..., ge=1)
    currency: str = Field(..., min_length=3, max_length=3)
    total_cost: Decimal
    complete: bool = True

    @field_validator("currency")
    @classmethod
    def normalize_group_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("currency must be a 3-letter ISO code")
        return normalized


class BillingEntityGroupPreviewCurrencyTotal(ApiModel):
    currency: str
    total_cost: Decimal
    billing_entity_ids: list[int]
    complete: bool


class BillingEntityGroupPreviewAggregation(ApiModel):
    billing_entity_group_id: int
    billing_entity_group_name: str
    month: str
    member_entity_ids: list[int]
    currency_totals: list[BillingEntityGroupPreviewCurrencyTotal]
    missing_entity_ids: list[int]
    complete: bool
