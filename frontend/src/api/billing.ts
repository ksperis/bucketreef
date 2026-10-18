/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { LONG_RUNNING_REQUEST_TIMEOUT_MS } from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type BillingDecimal = string | number;

export type BillingCoverage = {
  days_collected: number;
  days_in_month: number;
  coverage_ratio: number;
  storage_days_collected?: number | null;
  usage_days_collected?: number | null;
};

export type BillingCost = {
  currency?: string | null;
  storage_cost?: BillingDecimal | null;
  egress_cost?: BillingDecimal | null;
  ingress_cost?: BillingDecimal | null;
  requests_cost?: BillingDecimal | null;
  total_cost?: BillingDecimal | null;
  rate_card_name?: string | null;
  storage_quantity?: BillingStorageChargeQuantity | null;
  complete: boolean;
};

export type BillingStorageChargeQuantity = {
  basis: "actual_usage" | "allocated_quota";
  quantity_gib_month?: BillingDecimal | null;
  observations_collected: number;
  observations_expected: number;
  calendar_days: number;
  coverage_ratio: BillingDecimal;
  status: "complete" | "partial" | "blocked";
  issues: string[];
};

export type BillingUsageTotals = {
  bytes_in: number;
  bytes_out: number;
  ops_total: number;
  ops_breakdown?: Record<string, number> | null;
};

export type BillingStorageTotals = {
  avg_bytes?: number | null;
  avg_gb_month?: BillingDecimal | null;
  total_objects?: number | null;
};

export type BillingSummary = {
  month: string;
  storage_endpoint_id?: number | null;
  usage: BillingUsageTotals;
  storage: BillingStorageTotals;
  coverage: BillingCoverage;
  cost?: BillingCost | null;
};

export type BillingSubjectSummary = {
  subject_type: string;
  subject_id: number;
  name: string;
  rgw_identifier?: string | null;
  storage: BillingStorageTotals;
  usage: BillingUsageTotals;
  cost?: BillingCost | null;
};

type BillingSubjectsResponse = {
  items: BillingSubjectSummary[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
};

export type BillingDailySeriesPoint = {
  day: string;
  storage_bytes?: number | null;
  quota_size_bytes?: number | null;
  quota_state?: "valid" | "missing" | "disabled" | "unlimited" | "invalid" | null;
  bytes_in?: number | null;
  bytes_out?: number | null;
  ops_total?: number | null;
};

export type BillingSubjectDetail = {
  month: string;
  subject_type: string;
  subject_id: number;
  name: string;
  rgw_identifier?: string | null;
  daily: BillingDailySeriesPoint[];
  usage: BillingUsageTotals;
  storage: BillingStorageTotals;
  coverage: BillingCoverage;
  cost?: BillingCost | null;
};

export async function getBillingSummary(month: string, endpointId?: number | null): Promise<BillingSummary> {
  const params: Record<string, string | number> = { month };
  if (endpointId != null) {
    params.endpoint_id = endpointId;
  }
  const { data } = await client.get<BillingSummary>("/admin/billing/summary", { params });
  return data;
}

export async function getBillingSubjects(
  month: string,
  endpointId: number,
  subjectType: "account" | "s3_user",
  page = 1,
  pageSize = 25,
  sortBy = "name",
  sortDir: "asc" | "desc" = "asc",
): Promise<BillingSubjectsResponse> {
  const params: Record<string, string | number> = {
    month,
    endpoint_id: endpointId,
    type: subjectType,
    page,
    page_size: pageSize,
    sort_by: sortBy,
    sort_dir: sortDir,
  };
  const { data } = await client.get<BillingSubjectsResponse>("/admin/billing/subjects", { params });
  return data;
}

export async function getBillingSubjectDetail(
  month: string,
  endpointId: number,
  subjectType: "account" | "s3_user",
  subjectId: number,
): Promise<BillingSubjectDetail> {
  const params: Record<string, string | number> = { month, endpoint_id: endpointId };
  const { data } = await client.get<BillingSubjectDetail>(`/admin/billing/subject/${subjectType}/${subjectId}`, {
    params,
  });
  return data;
}

export async function downloadBillingCsv(month: string, endpointId: number): Promise<Blob> {
  const params: Record<string, string | number> = { month, endpoint_id: endpointId };
  const response = await client.get("/admin/billing/export.csv", {
    params,
    responseType: "blob",
    timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
  });
  return response.data as Blob;
}

export async function collectBillingDaily(day: string): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { day };
  const { data } = await client.post<Record<string, unknown>>("/admin/billing/collect/daily", null, { params });
  return data;
}

export async function getPortalBillingMe(month: string, accountId?: S3AccountSelector): Promise<BillingSubjectDetail> {
  const params: Record<string, string> = { month };
  const { data } = await client.get<BillingSubjectDetail>("/portal/billing/me", {
    params: withS3AccountParam(params, accountId),
  });
  return data;
}

export type BillingRateCardStatus = "future" | "active" | "expired";

export type BillingRateCard = {
  id: number;
  rate_plan_id: number;
  name: string;
  currency: string;
  storage_charge_basis: "actual_usage" | "allocated_quota";
  storage_gb_month_price?: BillingDecimal | null;
  egress_gb_price?: BillingDecimal | null;
  ingress_gb_price?: BillingDecimal | null;
  requests_per_1000_price?: BillingDecimal | null;
  effective_from: string;
  effective_to?: string | null;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  status: BillingRateCardStatus;
  editable: boolean;
  identity_editable: boolean;
  deletable: boolean;
  created_at: string;
  updated_at: string;
};

export type BillingRateCardPayload = {
  name: string;
  currency: string;
  storage_charge_basis: "actual_usage" | "allocated_quota";
  storage_gb_month_price?: string | null;
  egress_gb_price?: string | null;
  ingress_gb_price?: string | null;
  requests_per_1000_price?: string | null;
  effective_from: string;
  effective_to?: string | null;
  storage_endpoint_id?: number | null;
};

export type BillingRateCardVersionPayload = Omit<
  BillingRateCardPayload,
  "name" | "storage_endpoint_id" | "effective_to"
>;

export async function listBillingRateCards(): Promise<BillingRateCard[]> {
  const { data } = await client.get<BillingRateCard[]>("/admin/billing/rate-cards");
  return data;
}

export async function createBillingRateCard(payload: BillingRateCardPayload): Promise<BillingRateCard> {
  const { data } = await client.post<BillingRateCard>("/admin/billing/rate-cards", payload);
  return data;
}

export async function updateBillingRateCard(id: number, payload: BillingRateCardPayload): Promise<BillingRateCard> {
  const { data } = await client.put<BillingRateCard>("/admin/billing/rate-cards/" + id, payload);
  return data;
}

export async function createBillingRateCardVersion(
  id: number,
  payload: BillingRateCardVersionPayload,
): Promise<BillingRateCard> {
  const { data } = await client.post<BillingRateCard>("/admin/billing/rate-cards/" + id + "/versions", payload);
  return data;
}

export async function deleteBillingRateCard(id: number): Promise<void> {
  await client.delete("/admin/billing/rate-cards/" + id);
}

export type BillingSubjectType = "account" | "s3_user";

export type BillingEntitySubjectReference = {
  subject_type: BillingSubjectType;
  subject_id: number;
  name: string;
  rgw_identifier: string;
  storage_endpoint_id: number;
  storage_endpoint_name: string;
};

export type BillingEntityRateAssignmentInput = {
  rate_plan_id: number;
  effective_from: string;
  effective_to?: string | null;
};

export type BillingEntityRateAssignment = BillingEntityRateAssignmentInput & {
  id: number;
  rate_plan_name: string;
  created_at: string;
  updated_at: string;
};

export type BillingEntityPayload = {
  name: string;
  code?: string | null;
  external_id?: string | null;
  subject_type: BillingSubjectType;
  include_tag_ids: number[];
  explicit_include_ids: number[];
  explicit_exclude_ids: number[];
  rate_assignments: BillingEntityRateAssignmentInput[];
};

export type BillingEntityAdminItem = {
  id: number;
  name: string;
  code?: string | null;
  external_id?: string | null;
  subject_type: BillingSubjectType;
  active: boolean;
  include_tags: Array<{
    id: number;
    label: string;
    color_key: string;
    scope: "administrative" | "standard";
  }>;
  explicit_includes: BillingEntitySubjectReference[];
  explicit_excludes: BillingEntitySubjectReference[];
  rate_assignments: BillingEntityRateAssignment[];
  member_count: number;
  conflict_count: number;
  created_at: string;
  updated_at: string;
};

export type BillingEntityMembershipReason = {
  kind: "tag" | "explicit_include" | "explicit_exclude";
  tag_definition_id?: number | null;
  label?: string | null;
};

export type BillingEntityResolvedSubject = BillingEntitySubjectReference & {
  reasons: BillingEntityMembershipReason[];
};

export type BillingEntityResolution = {
  entity_id?: number | null;
  entity_name: string;
  subject_type: BillingSubjectType;
  members: BillingEntityResolvedSubject[];
  excluded: BillingEntityResolvedSubject[];
};

export type BillingEntityConflict = {
  subject: BillingEntitySubjectReference;
  entities: Array<{
    entity_id?: number | null;
    entity_name: string;
  }>;
};

export type BillingEntityResolutionResult = {
  entities: BillingEntityResolution[];
  unassigned: BillingEntitySubjectReference[];
  conflicts: BillingEntityConflict[];
};

export async function listBillingEntities(
  search = "",
  includeInactive = true,
): Promise<BillingEntityAdminItem[]> {
  const { data } = await client.get<BillingEntityAdminItem[]>("/admin/billing/entities", {
    params: {
      search,
      include_inactive: includeInactive,
    },
  });
  return data;
}

export async function createBillingEntity(payload: BillingEntityPayload): Promise<BillingEntityAdminItem> {
  const { data } = await client.post<BillingEntityAdminItem>("/admin/billing/entities", payload);
  return data;
}

export async function updateBillingEntity(
  id: number,
  payload: BillingEntityPayload,
): Promise<BillingEntityAdminItem> {
  const { data } = await client.put<BillingEntityAdminItem>("/admin/billing/entities/" + id, payload);
  return data;
}

export async function deactivateBillingEntity(id: number): Promise<BillingEntityAdminItem> {
  const { data } = await client.post<BillingEntityAdminItem>(
    "/admin/billing/entities/" + id + "/deactivate",
  );
  return data;
}

export async function previewBillingEntity(
  payload: BillingEntityPayload,
  entityId?: number,
): Promise<BillingEntityResolutionResult> {
  const { data } = await client.post<BillingEntityResolutionResult>(
    "/admin/billing/entities/preview",
    payload,
    { params: entityId == null ? undefined : { entity_id: entityId } },
  );
  return data;
}

export async function searchBillingEntitySubjects(
  subjectType: BillingSubjectType,
  search = "",
  limit = 20,
): Promise<BillingEntitySubjectReference[]> {
  const { data } = await client.get<BillingEntitySubjectReference[]>(
    "/admin/billing/entity-subjects",
    {
      params: {
        subject_type: subjectType,
        search,
        limit,
      },
    },
  );
  return data;
}

export type BillingEntityGroupMembershipInput = {
  billing_entity_id: number;
  effective_from: string;
  effective_to?: string | null;
};

export type BillingEntityGroupMembership = BillingEntityGroupMembershipInput & {
  id: number;
  billing_entity_name: string;
  billing_entity_code?: string | null;
  billing_entity_active: boolean;
  status: "historical" | "current" | "future";
  created_at: string;
  updated_at: string;
};

export type BillingEntityGroupPayload = {
  name: string;
  code?: string | null;
  external_id?: string | null;
  description?: string | null;
  memberships: BillingEntityGroupMembershipInput[];
};

export type BillingEntityGroupAdminItem = {
  id: number;
  name: string;
  code?: string | null;
  external_id?: string | null;
  description?: string | null;
  active: boolean;
  memberships: BillingEntityGroupMembership[];
  current_member_count: number;
  scheduled_membership_count: number;
  created_at: string;
  updated_at: string;
};

export async function listBillingEntityGroups(
  search = "",
  includeInactive = true,
): Promise<BillingEntityGroupAdminItem[]> {
  const { data } = await client.get<BillingEntityGroupAdminItem[]>("/admin/billing/groups", {
    params: {
      search,
      include_inactive: includeInactive,
    },
  });
  return data;
}

export async function createBillingEntityGroup(
  payload: BillingEntityGroupPayload,
): Promise<BillingEntityGroupAdminItem> {
  const { data } = await client.post<BillingEntityGroupAdminItem>("/admin/billing/groups", payload);
  return data;
}

export async function updateBillingEntityGroup(
  id: number,
  payload: BillingEntityGroupPayload,
): Promise<BillingEntityGroupAdminItem> {
  const { data } = await client.put<BillingEntityGroupAdminItem>("/admin/billing/groups/" + id, payload);
  return data;
}

export async function deactivateBillingEntityGroup(id: number): Promise<BillingEntityGroupAdminItem> {
  const { data } = await client.post<BillingEntityGroupAdminItem>(
    "/admin/billing/groups/" + id + "/deactivate",
  );
  return data;
}
