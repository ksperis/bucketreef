/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3ExecutionContextSelector, withS3ContextParam } from "./accountParams";
import { IamPolicy, InlinePolicy } from "./managerIamPolicies";
import {
  attachEntityPolicy,
  createIamEntity,
  deleteEntityInlinePolicy,
  deleteIamEntity,
  detachEntityPolicy,
  getIamEntity,
  listEntityInlinePolicies,
  listEntityPolicies,
  listIamEntities,
  putEntityInlinePolicy,
  updateIamEntity,
} from "./managerIamEntityClient";

export type IAMRole = {
  name: string;
  arn?: string;
  path?: string;
  policies?: string[];
  assume_role_policy_document?: Record<string, unknown> | string;
  max_session_duration?: number;
  tags?: IAMTag[];
};

export type IAMTag = { key: string; value: string };

type CreateRolePayload = {
  name: string;
  path?: string;
  assume_role_policy_document?: Record<string, unknown> | string;
  max_session_duration?: number;
  tags?: IAMTag[];
  inline_policies?: InlinePolicy[];
};

type UpdateRolePayload = {
  path?: string;
  assume_role_policy_document?: Record<string, unknown> | string;
  max_session_duration?: number;
};

export async function listIamRoles(contextId?: S3ExecutionContextSelector): Promise<IAMRole[]> {
  return listIamEntities<IAMRole>("roles", contextId);
}

export async function getIamRole(contextId: S3ExecutionContextSelector, roleName: string): Promise<IAMRole> {
  return getIamEntity<IAMRole>("roles", contextId, roleName);
}

export async function createIamRole(contextId: S3ExecutionContextSelector, payload: CreateRolePayload): Promise<IAMRole> {
  return createIamEntity<IAMRole, CreateRolePayload>("roles", contextId, payload);
}

export async function updateIamRole(contextId: S3ExecutionContextSelector, roleName: string, payload: UpdateRolePayload): Promise<IAMRole> {
  return updateIamEntity<IAMRole, UpdateRolePayload>("roles", contextId, roleName, payload);
}

export async function putRoleTags(contextId: S3ExecutionContextSelector, roleName: string, tags: IAMTag[]): Promise<IAMTag[]> {
  const { data } = await client.put<IAMTag[]>(`/manager/iam/roles/${encodeURIComponent(roleName)}/tags`, tags, {
    params: withS3ContextParam(undefined, contextId),
  });
  return data;
}

export async function deleteRoleTag(contextId: S3ExecutionContextSelector, roleName: string, tagKey: string): Promise<IAMTag[]> {
  const { data } = await client.delete<IAMTag[]>(
    `/manager/iam/roles/${encodeURIComponent(roleName)}/tags/${encodeURIComponent(tagKey)}`,
    { params: withS3ContextParam(undefined, contextId) },
  );
  return data;
}

export async function deleteIamRole(contextId: S3ExecutionContextSelector, name: string): Promise<void> {
  await deleteIamEntity("roles", contextId, name);
}

export async function listRolePolicies(contextId: S3ExecutionContextSelector, roleName: string): Promise<IamPolicy[]> {
  return listEntityPolicies("roles", contextId, roleName);
}

export async function attachRolePolicy(contextId: S3ExecutionContextSelector, roleName: string, policy: IamPolicy): Promise<IamPolicy> {
  return attachEntityPolicy("roles", contextId, roleName, policy);
}

export async function detachRolePolicy(contextId: S3ExecutionContextSelector, roleName: string, policyArn: string): Promise<void> {
  await detachEntityPolicy("roles", contextId, roleName, policyArn);
}

export async function listRoleInlinePolicies(contextId: S3ExecutionContextSelector, roleName: string): Promise<InlinePolicy[]> {
  return listEntityInlinePolicies("roles", contextId, roleName);
}

export async function putRoleInlinePolicy(
  contextId: S3ExecutionContextSelector,
  roleName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  return putEntityInlinePolicy("roles", contextId, roleName, policyName, document);
}

export async function deleteRoleInlinePolicy(contextId: S3ExecutionContextSelector, roleName: string, policyName: string): Promise<void> {
  await deleteEntityInlinePolicy("roles", contextId, roleName, policyName);
}
