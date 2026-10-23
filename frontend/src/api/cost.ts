/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { LONG_RUNNING_REQUEST_TIMEOUT_MS } from "./client";
import {
  S3AccountSelector,
  S3ExecutionContextSelector,
  withS3AccountParam,
  withS3ContextParam,
} from "./accountParams";

export type CostCoverage = {
  days_collected: number;
  days_in_month: number;
  coverage_ratio: number;
  storage_days_collected: number | null;
  usage_days_collected: number | null;
};

export type CostEndpointCollectionError = {
  stage: "endpoint";
  endpoint_id: number;
};

export type CostSubjectCollectionError = {
  stage: "usage" | "storage";
  endpoint_id: number;
  subject: "account" | "s3_user";
  subject_id: number;
};

export type CostCollectionError = CostEndpointCollectionError | CostSubjectCollectionError;

export type DataRetentionResult = {
  quota_history: {
    hourly_retention_days: number;
    daily_retention_days: number;
    deleted_hourly: number;
    deleted_daily: number;
  };
  cost_history: {
    daily_retention_days: number;
    deleted_usage_daily: number;
    deleted_storage_daily: number;
  };
};

export type CostCollectionResult = {
  day: string;
  endpoints: number;
  usage_records: number;
  storage_records: number;
  errors: CostCollectionError[];
  retention: DataRetentionResult;
};

export type CostBreakdown = {
  currency: string | null;
  storage_cost: number | null;
  egress_cost: number | null;
  ingress_cost: number | null;
  requests_cost: number | null;
  total_cost: number | null;
  pricing_source: "global" | "endpoint_override" | "mixed" | null;
};

export type CostRateValues = {
  storage_gb_month_price: number;
  egress_gb_price: number;
  ingress_gb_price: number;
  requests_per_1000_price: number;
};

export type CostGlobalModel = CostRateValues & {
  currency: string;
};

export type CostEndpointOverride = CostRateValues & {
  storage_endpoint_id: number;
};

export type CostSettings = {
  model: CostGlobalModel | null;
  endpoint_overrides: CostEndpointOverride[];
};

export type CostUsageTotals = {
  bytes_in: number;
  bytes_out: number;
  ops_total: number;
  ops_breakdown: Record<string, number> | null;
};

export type CostStorageTotals = {
  avg_bytes: number | null;
  avg_gb_month: number | null;
  total_objects: number | null;
};

export type CostSummary = {
  month: string;
  storage_endpoint_id: number | null;
  usage: CostUsageTotals;
  storage: CostStorageTotals;
  coverage: CostCoverage;
  cost: CostBreakdown | null;
};

export type CostSubjectSummary = {
  storage_endpoint_id: number;
  storage_endpoint_name: string;
  subject_type: string;
  subject_id: number;
  name: string;
  rgw_identifier: string | null;
  storage: CostStorageTotals;
  usage: CostUsageTotals;
  cost: CostBreakdown | null;
};

type CostSubjectsResponse = {
  items: CostSubjectSummary[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
};

export type CostDailySeriesPoint = {
  day: string;
  storage_bytes: number | null;
  bytes_in: number | null;
  bytes_out: number | null;
  ops_total: number | null;
};

export type CostSubjectDetail = {
  month: string;
  storage_endpoint_id: number;
  storage_endpoint_name: string;
  subject_type: string;
  subject_id: number;
  name: string;
  rgw_identifier: string | null;
  daily: CostDailySeriesPoint[];
  usage: CostUsageTotals;
  storage: CostStorageTotals;
  coverage: CostCoverage;
  cost: CostBreakdown | null;
};

export type CostSubjectHistoryPoint = {
  month: string;
  coverage: CostCoverage;
  cost: CostBreakdown | null;
};

export type AdminCostSubjectDetail = CostSubjectDetail & {
  history: CostSubjectHistoryPoint[];
};

export type CostAnalyticsEndpoint = {
  storage_endpoint_id: number;
  storage_endpoint_name: string;
  coverage: CostCoverage;
  cost: CostBreakdown | null;
};

export type CostAnalyticsHistoryPoint = {
  month: string;
  coverage: CostCoverage;
  cost: CostBreakdown | null;
};

export type CostAnalyticsConcentration = {
  top_five_cost: number;
  other_cost: number;
  subject_total_cost: number;
  top_five_ratio: number;
};

export type CostAnalyticsResponse = {
  month: string;
  storage_endpoint_id: number | null;
  subject_type: "all" | "account" | "s3_user";
  summary: CostSummary;
  by_endpoint: CostAnalyticsEndpoint[];
  top_subjects: CostSubjectSummary[];
  concentration: CostAnalyticsConcentration;
  history: CostAnalyticsHistoryPoint[];
};

export async function fetchCostSettings(): Promise<CostSettings> {
  const { data } = await client.get<CostSettings>("/admin/settings/cost");
  return data;
}

export async function updateCostSettings(payload: CostSettings): Promise<CostSettings> {
  const { data } = await client.put<CostSettings>("/admin/settings/cost", payload);
  return data;
}

export async function getCostSummary(month: string, endpointId?: number | null): Promise<CostSummary> {
  const params: Record<string, string | number> = { month };
  if (endpointId != null) {
    params.endpoint_id = endpointId;
  }
  const { data } = await client.get<CostSummary>("/admin/cost/summary", { params });
  return data;
}

export async function getCostSubjects(
  month: string,
  endpointId: number | null,
  subjectType: "all" | "account" | "s3_user",
  page = 1,
  pageSize = 25,
  sortBy = "name",
  sortDir: "asc" | "desc" = "asc",
  search?: string,
): Promise<CostSubjectsResponse> {
  const params: Record<string, string | number> = {
    month,
    subject_type: subjectType,
    page,
    page_size: pageSize,
    sort_by: sortBy,
    sort_dir: sortDir,
  };
  if (endpointId != null) params.endpoint_id = endpointId;
  if (search?.trim()) params.search = search.trim();
  const { data } = await client.get<CostSubjectsResponse>("/admin/cost/subjects", { params });
  return data;
}

export async function getCostAnalytics(
  month: string,
  endpointId: number | null,
  subjectType: "all" | "account" | "s3_user",
): Promise<CostAnalyticsResponse> {
  const params: Record<string, string | number> = { month, subject_type: subjectType };
  if (endpointId != null) params.endpoint_id = endpointId;
  const { data } = await client.get<CostAnalyticsResponse>("/admin/cost/analytics", { params });
  return data;
}

export async function getCostSubjectDetail(
  month: string,
  endpointId: number,
  subjectType: "account" | "s3_user",
  subjectId: number,
): Promise<AdminCostSubjectDetail> {
  const params: Record<string, string | number> = { month, endpoint_id: endpointId };
  const { data } = await client.get<AdminCostSubjectDetail>(`/admin/cost/subject/${subjectType}/${subjectId}`, {
    params,
  });
  return data;
}

export async function downloadCostCsv(
  month: string,
  endpointId: number | null,
  subjectType: "all" | "account" | "s3_user" = "all",
): Promise<Blob> {
  const params: Record<string, string | number> = { month, subject_type: subjectType };
  if (endpointId != null) params.endpoint_id = endpointId;
  const response = await client.get("/admin/cost/export.csv", {
    params,
    responseType: "blob",
    timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
  });
  return response.data as Blob;
}

export async function collectCostDaily(day: string): Promise<CostCollectionResult> {
  const params: Record<string, string> = { day };
  const { data } = await client.post<CostCollectionResult>("/admin/cost/collect/daily", null, { params });
  return data;
}

export async function getPortalCostMe(month: string, accountId?: S3AccountSelector): Promise<CostSubjectDetail> {
  const params: Record<string, string> = { month };
  const { data } = await client.get<CostSubjectDetail>("/portal/cost/me", {
    params: withS3AccountParam(params, accountId),
  });
  return data;
}

export async function getManagerCostMe(
  month: string,
  contextId?: S3ExecutionContextSelector,
): Promise<CostSubjectDetail> {
  const { data } = await client.get<CostSubjectDetail>("/manager/cost/me", {
    params: withS3ContextParam({ month }, contextId),
  });
  return data;
}
