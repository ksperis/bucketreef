/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3ExecutionContextSelector, withS3ContextParam } from "./accountParams";
import type { AccessKeyMetadata, AccessKeyMetadataInput } from "./accessKeyContracts";
import { IamPolicy, InlinePolicy } from "./managerIamPolicies";
import {
  attachEntityPolicy,
  createIamEntity,
  deleteEntityInlinePolicy,
  deleteIamEntity,
  detachEntityPolicy,
  listEntityInlinePolicies,
  listEntityPolicies,
  listIamEntities,
  putEntityInlinePolicy,
} from "./managerIamEntityClient";

export type AccessKey = AccessKeyMetadata & {
  access_key_id: string;
  status: string | null;
  created_at: string | null;
  secret_access_key: string | null;
  is_private_access_managed: boolean;
  managed_connection_id: number | null;
};

export type IAMUser = {
  name: string;
  arn?: string;
  path?: string;
  groups?: string[];
  policies?: string[];
  inline_policies?: string[];
  has_keys?: boolean;
  is_private_access_managed?: boolean;
  managed_connection_id?: number | null;
  is_bucketreef_managed?: boolean;
  management_source?: string | null;
};

type IAMUserWithKey = IAMUser & { access_key?: AccessKey };

export async function listIamUsers(contextId?: S3ExecutionContextSelector): Promise<IAMUser[]> {
  return listIamEntities<IAMUser>("users", contextId);
}

export async function getIamUser(contextId: S3ExecutionContextSelector, userName: string): Promise<IAMUser> {
  const { data } = await client.get<IAMUser>(`/manager/iam/users/${encodeURIComponent(userName)}`, {
    params: withS3ContextParam(undefined, contextId),
  });
  return data;
}

export async function updateIamUser(
  contextId: S3ExecutionContextSelector,
  userName: string,
  payload: { name?: string; path?: string },
): Promise<IAMUser> {
  const { data } = await client.put<IAMUser>(`/manager/iam/users/${encodeURIComponent(userName)}`, payload, {
    params: withS3ContextParam(undefined, contextId),
  });
  return data;
}

export async function createIamUser(
  contextId: S3ExecutionContextSelector,
  name: string,
  createKey = false,
  groups?: string[],
  policies?: string[],
  inlinePolicies?: InlinePolicy[]
): Promise<IAMUserWithKey> {
  return createIamEntity<IAMUserWithKey>("users", contextId, {
    name,
    create_key: createKey,
    groups,
    policies,
    inline_policies: inlinePolicies,
  });
}

export async function deleteIamUser(contextId: S3ExecutionContextSelector, name: string): Promise<void> {
  await deleteIamEntity("users", contextId, name);
}

export async function listIamAccessKeys(contextId: S3ExecutionContextSelector, userName: string): Promise<AccessKey[]> {
  const { data } = await client.get<AccessKey[]>(`/manager/iam/users/${encodeURIComponent(userName)}/keys`, {
    params: withS3ContextParam(undefined, contextId),
  });
  return data;
}

export async function createIamAccessKey(
  contextId: S3ExecutionContextSelector,
  userName: string,
  metadata?: AccessKeyMetadataInput,
): Promise<AccessKey> {
  const { data } = await client.post<AccessKey>(
    `/manager/iam/users/${encodeURIComponent(userName)}/keys`,
    metadata ?? {},
    { params: withS3ContextParam(undefined, contextId) }
  );
  return data;
}

export async function updateIamAccessKeyMetadata(
  contextId: S3ExecutionContextSelector,
  userName: string,
  accessKeyId: string,
  metadata: AccessKeyMetadataInput,
): Promise<AccessKeyMetadata> {
  const { data } = await client.put<AccessKeyMetadata>(
    `/manager/iam/users/${encodeURIComponent(userName)}/keys/${encodeURIComponent(accessKeyId)}/metadata`,
    metadata,
    { params: withS3ContextParam(undefined, contextId) },
  );
  return data;
}

export async function deleteIamAccessKey(
  contextId: S3ExecutionContextSelector,
  userName: string,
  accessKeyId: string
): Promise<void> {
  await client.delete(`/manager/iam/users/${encodeURIComponent(userName)}/keys/${encodeURIComponent(accessKeyId)}`, {
    params: withS3ContextParam(undefined, contextId),
  });
}

export async function updateIamAccessKeyStatus(
  contextId: S3ExecutionContextSelector,
  userName: string,
  accessKeyId: string,
  active: boolean
): Promise<AccessKey> {
  const { data } = await client.put<AccessKey>(
    `/manager/iam/users/${encodeURIComponent(userName)}/keys/${encodeURIComponent(accessKeyId)}/status`,
    { active },
    { params: withS3ContextParam(undefined, contextId) }
  );
  return data;
}

export async function listUserPolicies(contextId: S3ExecutionContextSelector, userName: string): Promise<IamPolicy[]> {
  return listEntityPolicies("users", contextId, userName);
}

export async function attachUserPolicy(contextId: S3ExecutionContextSelector, userName: string, policy: IamPolicy): Promise<IamPolicy> {
  return attachEntityPolicy("users", contextId, userName, policy);
}

export async function detachUserPolicy(contextId: S3ExecutionContextSelector, userName: string, policyArn: string): Promise<void> {
  await detachEntityPolicy("users", contextId, userName, policyArn);
}

export async function listUserInlinePolicies(contextId: S3ExecutionContextSelector, userName: string): Promise<InlinePolicy[]> {
  return listEntityInlinePolicies("users", contextId, userName);
}

export async function putUserInlinePolicy(
  contextId: S3ExecutionContextSelector,
  userName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  return putEntityInlinePolicy("users", contextId, userName, policyName, document);
}

export async function deleteUserInlinePolicy(contextId: S3ExecutionContextSelector, userName: string, policyName: string): Promise<void> {
  await deleteEntityInlinePolicy("users", contextId, userName, policyName);
}
