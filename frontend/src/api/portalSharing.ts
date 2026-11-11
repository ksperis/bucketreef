/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import { buildS3AccountRequestConfig } from "./accountParams";
import client from "./client";
import type {
  PortalStorageSpaceAccountMemberRole,
  PortalStorageSpaceGrantRole,
} from "./portal";
import type { PaginatedResponse } from "./types";

export type PortalStorageSpaceShare = {
  user_id: number;
  email: string;
  role: PortalStorageSpaceGrantRole;
};

export type PortalStorageSpaceOwner = {
  email: string;
  display_name: string | null;
};

export type PortalStorageSpaceAccessSummary = {
  mode: "private" | "all" | "restricted";
  default_account_member_role: PortalStorageSpaceAccountMemberRole | null;
  owner: PortalStorageSpaceOwner | null;
  effective_member_count: number;
  explicit_shares: PortalStorageSpaceShare[];
  public_link_count: number;
  can_manage_access: boolean;
  can_create_public_links: boolean;
};

export type PortalStorageSpaceShareCandidate = {
  user_id: number;
  email: string;
  display_name: string | null;
  access_source: "direct" | "group" | "direct_and_group";
  already_shared: boolean;
};

type PortalShareCandidatesQuery = {
  page?: number;
  page_size?: number;
  search?: string;
  include_already_shared?: boolean;
};

export type PortalPublicLink = {
  id: number;
  storage_space_id: string;
  storage_space_name: string;
  object_name: string;
  url: string;
  expires_at: string | null;
  status: string;
};

export async function fetchPortalStorageSpaceAccessSummary(
  accountId: S3AccountSelector,
  spaceId: string,
): Promise<PortalStorageSpaceAccessSummary> {
  const { data } = await client.get<PortalStorageSpaceAccessSummary>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/access-summary`,
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function listPortalShareCandidates(
  accountId: S3AccountSelector,
  query: PortalShareCandidatesQuery = {},
): Promise<PaginatedResponse<PortalStorageSpaceShareCandidate>> {
  const { data } = await client.get<PaginatedResponse<PortalStorageSpaceShareCandidate>>(
    "/portal/share-candidates",
    buildS3AccountRequestConfig(accountId, query),
  );
  return data;
}

export async function listPortalStorageSpaceShareCandidates(
  accountId: S3AccountSelector,
  spaceId: string,
  query: PortalShareCandidatesQuery = {},
): Promise<PaginatedResponse<PortalStorageSpaceShareCandidate>> {
  const { data } = await client.get<PaginatedResponse<PortalStorageSpaceShareCandidate>>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/share-candidates`,
    buildS3AccountRequestConfig(accountId, query),
  );
  return data;
}

export async function grantPortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: {
    user_id: number;
    role: PortalStorageSpaceGrantRole;
  },
): Promise<PortalStorageSpaceShare> {
  const { data } = await client.post<PortalStorageSpaceShare>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares`,
    payload,
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function updatePortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  userId: number,
  role: PortalStorageSpaceGrantRole,
): Promise<PortalStorageSpaceShare> {
  const { data } = await client.put<PortalStorageSpaceShare>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares/${userId}`,
    { role },
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function revokePortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  userId: number,
): Promise<PortalStorageSpaceShare[]> {
  const { data } = await client.delete<PortalStorageSpaceShare[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares/${userId}`,
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function listPortalStorageSpacePublicLinks(
  accountId: S3AccountSelector,
  spaceId: string,
  options?: { objectKey?: string; includeRevoked?: boolean },
): Promise<PortalPublicLink[]> {
  const baseParams: Record<string, string | boolean> = {};
  if (options?.objectKey) {
    baseParams.object_key = options.objectKey;
  }
  if (options?.includeRevoked) {
    baseParams.include_revoked = true;
  }
  const { data } = await client.get<PortalPublicLink[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links`,
    buildS3AccountRequestConfig(accountId, baseParams),
  );
  return data;
}

export async function createPortalStorageSpacePublicLink(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: {
    object_key: string;
    label?: string | null;
    expires_at?: string | null;
  },
): Promise<PortalPublicLink> {
  const { data } = await client.post<PortalPublicLink>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links`,
    payload,
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function revokePortalStorageSpacePublicLink(
  accountId: S3AccountSelector,
  spaceId: string,
  linkId: number,
): Promise<PortalPublicLink[]> {
  const { data } = await client.delete<PortalPublicLink[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links/${linkId}`,
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}
