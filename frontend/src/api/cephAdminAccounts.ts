/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminRgwQuotaConfig } from "./cephAdminRgwTypes";
import {
  listCephAdminEntities,
  streamCephAdminEntities,
  type CephAdminEntityListingParams,
  type CephAdminEntityListingRequestOptions,
  type CephAdminListingStreamOptions,
} from "./cephAdminEntityListing";
import client from "./client";
import type { PaginatedResponse } from "./types";

export type CephAdminRgwAccount = {
  account_id: string;
  tenant: string | null;
  account_name: string | null;
  email: string | null;
  max_users: number | null;
  max_buckets: number | null;
  quota_max_size_bytes: number | null;
  quota_max_objects: number | null;
  used_bytes: number | null;
  object_count: number | null;
  bucket_count: number | null;
  user_count: number | null;
};

export type CephAdminRgwAccountDetail = {
  account_id: string;
  tenant: string | null;
  account_name: string | null;
  email: string | null;
  max_users: number | null;
  max_buckets: number | null;
  max_roles: number | null;
  max_groups: number | null;
  max_access_keys: number | null;
  bucket_count: number | null;
  user_count: number | null;
  quota: CephAdminRgwQuotaConfig | null;
  bucket_quota: CephAdminRgwQuotaConfig | null;
};

export type UpdateCephAdminAccountPayload = {
  account_name?: string | null;
  email?: string | null;
  max_users?: number | null;
  max_buckets?: number | null;
  max_roles?: number | null;
  max_groups?: number | null;
  max_access_keys?: number | null;
  quota_enabled?: boolean | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  bucket_quota_enabled?: boolean | null;
  bucket_quota_max_size_bytes?: number | null;
  bucket_quota_max_objects?: number | null;
  extra_params?: Record<string, unknown>;
};

export type CreateCephAdminAccountPayload = {
  account_id?: string | null;
  account_name: string;
  tenant?: string | null;
  email?: string | null;
  max_users?: number | null;
  max_buckets?: number | null;
  max_roles?: number | null;
  max_groups?: number | null;
  max_access_keys?: number | null;
  quota_enabled?: boolean | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  bucket_quota_enabled?: boolean | null;
  bucket_quota_max_size_bytes?: number | null;
  bucket_quota_max_objects?: number | null;
  extra_params?: Record<string, unknown>;
};

type CreateCephAdminAccountResponse = {
  account: CephAdminRgwAccountDetail;
};

type PaginatedCephAdminAccountsResponse = PaginatedResponse<CephAdminRgwAccount>;

type ListCephAdminAccountsParams = CephAdminEntityListingParams;

export async function listCephAdminAccounts(
  endpointId: number,
  params?: ListCephAdminAccountsParams,
  options?: CephAdminEntityListingRequestOptions,
): Promise<PaginatedCephAdminAccountsResponse> {
  return listCephAdminEntities<PaginatedCephAdminAccountsResponse>(
    endpointId,
    "accounts",
    params,
    options,
  );
}

export async function streamCephAdminAccounts(
  endpointId: number,
  params?: ListCephAdminAccountsParams,
  options?: CephAdminListingStreamOptions,
): Promise<PaginatedCephAdminAccountsResponse> {
  return streamCephAdminEntities<PaginatedCephAdminAccountsResponse>(
    endpointId,
    "accounts",
    params,
    options,
  );
}

export async function getCephAdminAccountDetail(
  endpointId: number,
  accountId: string,
): Promise<CephAdminRgwAccountDetail> {
  const { data } = await client.get<CephAdminRgwAccountDetail>(
    `/ceph-admin/endpoints/${endpointId}/accounts/${encodeURIComponent(accountId)}/detail`,
  );
  return data;
}

export async function createCephAdminAccount(
  endpointId: number,
  payload: CreateCephAdminAccountPayload,
): Promise<CreateCephAdminAccountResponse> {
  const { data } = await client.post<CreateCephAdminAccountResponse>(
    `/ceph-admin/endpoints/${endpointId}/accounts`,
    payload,
  );
  return data;
}

export async function updateCephAdminAccountConfig(
  endpointId: number,
  accountId: string,
  payload: UpdateCephAdminAccountPayload,
): Promise<CephAdminRgwAccountDetail> {
  const { data } = await client.patch<CephAdminRgwAccountDetail>(
    `/ceph-admin/endpoints/${endpointId}/accounts/${encodeURIComponent(accountId)}/config`,
    payload,
  );
  return data;
}
