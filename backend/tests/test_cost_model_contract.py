# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.cost import (
    AdminCostSubjectDetail,
    CostAnalyticsConcentration,
    CostAnalyticsEndpoint,
    CostAnalyticsHistoryPoint,
    CostAnalyticsResponse,
    CostBreakdown,
    CostCoverage,
    CostDailySeriesPoint,
    CostGlobalModel,
    CostSettings,
    CostStorageTotals,
    CostSubjectDetail,
    CostSubjectHistoryPoint,
    CostSubjectSummary,
    CostSummary,
    CostUsageTotals,
)


def test_cost_responses_require_complete_canonical_payloads() -> None:
    assert set(CostCoverage.model_json_schema()["required"]) == {
        "days_collected",
        "days_in_month",
        "coverage_ratio",
        "storage_days_collected",
        "usage_days_collected",
    }
    assert set(CostBreakdown.model_json_schema()["required"]) == {
        "currency",
        "storage_cost",
        "egress_cost",
        "ingress_cost",
        "requests_cost",
        "total_cost",
        "pricing_source",
    }
    assert set(CostUsageTotals.model_json_schema()["required"]) == {
        "bytes_in",
        "bytes_out",
        "ops_total",
        "ops_breakdown",
    }
    assert set(CostStorageTotals.model_json_schema()["required"]) == {
        "avg_bytes",
        "avg_gb_month",
        "total_objects",
    }
    assert set(CostSummary.model_json_schema()["required"]) == {
        "month",
        "storage_endpoint_id",
        "usage",
        "storage",
        "coverage",
        "cost",
    }
    assert set(CostSubjectSummary.model_json_schema()["required"]) == {
        "storage_endpoint_id",
        "storage_endpoint_name",
        "subject_type",
        "subject_id",
        "name",
        "rgw_identifier",
        "storage",
        "usage",
        "cost",
    }
    assert set(CostDailySeriesPoint.model_json_schema()["required"]) == {
        "day",
        "storage_bytes",
        "bytes_in",
        "bytes_out",
        "ops_total",
    }
    assert set(CostSubjectDetail.model_json_schema()["required"]) == {
        "month",
        "storage_endpoint_id",
        "storage_endpoint_name",
        "subject_type",
        "subject_id",
        "name",
        "rgw_identifier",
        "daily",
        "usage",
        "storage",
        "coverage",
        "cost",
    }
    assert set(CostSubjectHistoryPoint.model_json_schema()["required"]) == {
        "month",
        "coverage",
        "cost",
    }
    assert set(AdminCostSubjectDetail.model_json_schema()["required"]) == {
        *CostSubjectDetail.model_json_schema()["required"],
        "history",
    }
    assert set(CostAnalyticsEndpoint.model_json_schema()["required"]) == {
        "storage_endpoint_id",
        "storage_endpoint_name",
        "coverage",
        "cost",
    }
    assert set(CostAnalyticsHistoryPoint.model_json_schema()["required"]) == {
        "month",
        "coverage",
        "cost",
    }
    assert set(CostAnalyticsConcentration.model_json_schema()["required"]) == {
        "top_five_cost",
        "other_cost",
        "subject_total_cost",
        "top_five_ratio",
    }
    assert set(CostAnalyticsResponse.model_json_schema()["required"]) == {
        "month",
        "storage_endpoint_id",
        "subject_type",
        "summary",
        "by_endpoint",
        "top_subjects",
        "concentration",
        "history",
    }


def test_cost_settings_require_the_complete_internal_api_payload() -> None:
    assert set(CostGlobalModel.model_json_schema()["required"]) == {
        "storage_gb_month_price",
        "egress_gb_price",
        "ingress_gb_price",
        "requests_per_1000_price",
        "currency",
    }
    assert set(CostSettings.model_json_schema()["required"]) == {
        "model",
        "endpoint_overrides",
    }
