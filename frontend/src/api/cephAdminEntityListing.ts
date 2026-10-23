/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { resolveApiBaseUrl, streamBucketsWithSse } from "./sseBucketsStream";

export type CephAdminEntityResource = "accounts" | "users";

export type CephAdminEntityListingParams = {
  page?: number;
  page_size?: number;
  search?: string;
  advanced_filter?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
};

export type CephAdminEntityListingRequestOptions = {
  signal?: AbortSignal;
};

export type CephAdminListingStreamProgress = {
  request_id: string;
  percent: number;
  stage: string;
  processed: number;
  total: number;
  message?: string;
};

export type CephAdminListingStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: CephAdminListingStreamProgress) => void;
};

export function buildCephAdminEntityListingQuery(
  params?: CephAdminEntityListingParams,
): URLSearchParams {
  const query = new URLSearchParams();
  if (!params) return query;
  if (typeof params.page === "number") query.set("page", String(params.page));
  if (typeof params.page_size === "number") {
    query.set("page_size", String(params.page_size));
  }
  if (typeof params.search === "string" && params.search.trim()) {
    query.set("search", params.search);
  }
  if (
    typeof params.advanced_filter === "string" &&
    params.advanced_filter.trim()
  ) {
    query.set("advanced_filter", params.advanced_filter);
  }
  if (typeof params.sort_by === "string" && params.sort_by.trim()) {
    query.set("sort_by", params.sort_by);
  }
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);
  if (params.include && params.include.length > 0) {
    query.set("include", params.include.join(","));
  }
  return query;
}

export async function listCephAdminEntities<TResult>(
  endpointId: number,
  resource: CephAdminEntityResource,
  params?: CephAdminEntityListingParams,
  options?: CephAdminEntityListingRequestOptions,
): Promise<TResult> {
  const { data } = await client.get<TResult>(
    `/ceph-admin/endpoints/${endpointId}/${resource}`,
    {
      params: {
        ...params,
        include: params?.include?.join(","),
      },
      signal: options?.signal,
    },
  );
  return data;
}

export async function streamCephAdminEntities<TResult>(
  endpointId: number,
  resource: CephAdminEntityResource,
  params?: CephAdminEntityListingParams,
  options?: CephAdminListingStreamOptions,
): Promise<TResult> {
  const baseUrl = resolveApiBaseUrl();
  const queryText = buildCephAdminEntityListingQuery(params).toString();
  const url = `${baseUrl}/ceph-admin/endpoints/${endpointId}/${resource}/stream${queryText ? `?${queryText}` : ""}`;
  return streamBucketsWithSse<CephAdminListingStreamProgress, TResult>({
    url,
    options,
    streamFailedLabel: "Advanced search stream failed",
    missingResultMessage: "Advanced search stream ended without a result payload",
  });
}
