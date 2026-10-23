/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3ExecutionContextSelector, withS3ContextParam } from "./accountParams";
import { IAMUser } from "./managerIamUsers";
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

export type IAMGroup = {
  name: string;
  arn?: string;
  path?: string;
  policies?: string[];
  is_bucketreef_managed?: boolean;
  management_source?: string | null;
};

export async function listIamGroups(contextId?: S3ExecutionContextSelector): Promise<IAMGroup[]> {
  return listIamEntities<IAMGroup>("groups", contextId);
}

export async function getIamGroup(contextId: S3ExecutionContextSelector, groupName: string): Promise<IAMGroup> {
  return getIamEntity<IAMGroup>("groups", contextId, groupName);
}

export async function updateIamGroup(
  contextId: S3ExecutionContextSelector,
  groupName: string,
  payload: { name?: string; path?: string },
): Promise<IAMGroup> {
  return updateIamEntity<IAMGroup, typeof payload>("groups", contextId, groupName, payload);
}

export async function createIamGroup(
  contextId: S3ExecutionContextSelector,
  name: string,
  inlinePolicies?: InlinePolicy[]
): Promise<IAMGroup> {
  return createIamEntity<IAMGroup>("groups", contextId, { name, inline_policies: inlinePolicies });
}

export async function deleteIamGroup(contextId: S3ExecutionContextSelector, name: string): Promise<void> {
  await deleteIamEntity("groups", contextId, name);
}

export async function listIamGroupUsers(contextId: S3ExecutionContextSelector, groupName: string): Promise<IAMUser[]> {
  const { data } = await client.get<IAMUser[]>(`/manager/iam/groups/${encodeURIComponent(groupName)}/users`, {
    params: withS3ContextParam(undefined, contextId),
  });
  return data;
}

export async function addIamGroupUser(contextId: S3ExecutionContextSelector, groupName: string, userName: string): Promise<IAMUser> {
  const { data } = await client.post<IAMUser>(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/users`,
    { name: userName },
    { params: withS3ContextParam(undefined, contextId) }
  );
  return data;
}

export async function removeIamGroupUser(contextId: S3ExecutionContextSelector, groupName: string, userName: string): Promise<void> {
  await client.delete(`/manager/iam/groups/${encodeURIComponent(groupName)}/users/${encodeURIComponent(userName)}`, {
    params: withS3ContextParam(undefined, contextId),
  });
}

export async function listGroupPolicies(contextId: S3ExecutionContextSelector, groupName: string): Promise<IamPolicy[]> {
  return listEntityPolicies("groups", contextId, groupName);
}

export async function attachGroupPolicy(
  contextId: S3ExecutionContextSelector,
  groupName: string,
  policy: IamPolicy
): Promise<IamPolicy> {
  return attachEntityPolicy("groups", contextId, groupName, policy);
}

export async function detachGroupPolicy(contextId: S3ExecutionContextSelector, groupName: string, policyArn: string): Promise<void> {
  await detachEntityPolicy("groups", contextId, groupName, policyArn);
}

export async function listGroupInlinePolicies(contextId: S3ExecutionContextSelector, groupName: string): Promise<InlinePolicy[]> {
  return listEntityInlinePolicies("groups", contextId, groupName);
}

export async function putGroupInlinePolicy(
  contextId: S3ExecutionContextSelector,
  groupName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  return putEntityInlinePolicy("groups", contextId, groupName, policyName, document);
}

export async function deleteGroupInlinePolicy(contextId: S3ExecutionContextSelector, groupName: string, policyName: string): Promise<void> {
  await deleteEntityInlinePolicy("groups", contextId, groupName, policyName);
}
