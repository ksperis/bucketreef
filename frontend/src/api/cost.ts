/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { LONG_RUNNING_REQUEST_TIMEOUT_MS } from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type CostCoverage = {
  days_collected: number;
  days_in_month: number;
  coverage_ratio: number;
  storage_days_collected?: number | null;
  usage_days_collected?: number | null;
};

export type CostBreakdown = {
  currency?: string | null;
  storage_cost?: number | null;
  egress_cost?: number | null;
  ingress_cost?: number | null;
  requests_cost?: number | null;
  total_cost?: number | null;
  pricing_source?: "global" | "endpoint_override" | "mixed" | null;
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
  model?: CostGlobalModel | null;
  endpoint_overrides: CostEndpointOverride[];
};

export type CostUsageTotals = {
  bytes_in: number;
  bytes_out: number;
  ops_total: number;
  ops_breakdown?: Record<string, number> | null;
};

export type CostStorageTotals = {
  avg_bytes?: number | null;
  avg_gb_month?: number | null;
  total_objects?: number | null;
};

export type CostSummary = {
  month: string;
  storage_endpoint_id?: number | null;
  usage: CostUsageTotals;
  storage: CostStorageTotals;
  coverage: CostCoverage;
  cost?: CostBreakdown | null;
};

export type CostSubjectSummary = {
  subject_type: string;
  subject_id: number;
  name: string;
  rgw_identifier?: string | null;
  storage: CostStorageTotals;
  usage: CostUsageTotals;
  cost?: CostBreakdown | null;
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
  storage_bytes?: number | null;
  bytes_in?: number | null;
  bytes_out?: number | null;
  ops_total?: number | null;
};

export type CostSubjectDetail = {
  month: string;
  subject_type: string;
  subject_id: number;
  name: string;
  rgw_identifier?: string | null;
  daily: CostDailySeriesPoint[];
  usage: CostUsageTotals;
  storage: CostStorageTotals;
  coverage: CostCoverage;
  cost?: CostBreakdown | null;
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
  endpointId: number,
  subjectType: "account" | "s3_user",
  page = 1,
  pageSize = 25,
  sortBy = "name",
  sortDir: "asc" | "desc" = "asc",
): Promise<CostSubjectsResponse> {
  const params: Record<string, string | number> = {
    month,
    endpoint_id: endpointId,
    type: subjectType,
    page,
    page_size: pageSize,
    sort_by: sortBy,
    sort_dir: sortDir,
  };
  const { data } = await client.get<CostSubjectsResponse>("/admin/cost/subjects", { params });
  return data;
}

export async function getCostSubjectDetail(
  month: string,
  endpointId: number,
  subjectType: "account" | "s3_user",
  subjectId: number,
): Promise<CostSubjectDetail> {
  const params: Record<string, string | number> = { month, endpoint_id: endpointId };
  const { data } = await client.get<CostSubjectDetail>(`/admin/cost/subject/${subjectType}/${subjectId}`, {
    params,
  });
  return data;
}

export async function downloadCostCsv(month: string, endpointId: number): Promise<Blob> {
  const params: Record<string, string | number> = { month, endpoint_id: endpointId };
  const response = await client.get("/admin/cost/export.csv", {
    params,
    responseType: "blob",
    timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
  });
  return response.data as Blob;
}

export async function collectCostDaily(day: string): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { day };
  const { data } = await client.post<Record<string, unknown>>("/admin/cost/collect/daily", null, { params });
  return data;
}

export async function getPortalCostMe(month: string, accountId?: S3AccountSelector): Promise<CostSubjectDetail> {
  const params: Record<string, string> = { month };
  const { data } = await client.get<CostSubjectDetail>("/portal/cost/me", {
    params: withS3AccountParam(params, accountId),
  });
  return data;
}
