/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { S3ExecutionContextSelector } from "./accountParams";
import { withS3ContextParam } from "./accountParams";
import type { IamPolicy, InlinePolicy } from "./managerIamPolicies";

type IamEntitySegment = "users" | "groups" | "roles";

export type IamCursorPage<T> = {
  items: T[];
  next_marker: string | null;
};

export type IamCursorQuery = {
  marker?: string | null;
  page_size?: number;
  search?: string;
  include_details?: boolean;
};

function segmentBasePath(segment: IamEntitySegment): string {
  return `/manager/iam/${segment}`;
}

function entityPath(segment: IamEntitySegment, entityName: string): string {
  return `${segmentBasePath(segment)}/${encodeURIComponent(entityName)}`;
}

export function buildIamRequestConfig(
  contextId?: S3ExecutionContextSelector,
  params?: Record<string, unknown> | null,
) {
  return { params: withS3ContextParam(params, contextId) };
}

export async function listIamEntityPage<T>(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  query: IamCursorQuery = {},
): Promise<IamCursorPage<T>> {
  const requestConfig = buildIamRequestConfig(
    contextId,
    {
      ...(query.marker ? { marker: query.marker } : {}),
      ...(query.page_size ? { page_size: query.page_size } : {}),
      ...(query.search?.trim() ? { search: query.search.trim() } : {}),
      ...(query.include_details ? { include_details: true } : {}),
    },
  );
  const { data } = await client.get<IamCursorPage<T>>(
    `${segmentBasePath(segment)}/page`,
    requestConfig,
  );
  return data;
}

export async function getIamEntity<T>(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  entityName: string,
): Promise<T> {
  const { data } = await client.get<T>(
    entityPath(segment, entityName),
    buildIamRequestConfig(contextId),
  );
  return data;
}

export async function createIamEntity<T, Payload extends object = object>(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector | undefined,
  payload: Payload,
): Promise<T> {
  const { data } = await client.post<T>(
    segmentBasePath(segment),
    payload,
    buildIamRequestConfig(contextId),
  );
  return data;
}

export async function updateIamEntity<T, Payload extends object>(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  entityName: string,
  payload: Payload,
): Promise<T> {
  const { data } = await client.patch<T>(
    entityPath(segment, entityName),
    payload,
    buildIamRequestConfig(contextId),
  );
  return data;
}

export async function deleteIamEntity(segment: IamEntitySegment, contextId: S3ExecutionContextSelector, entityName: string): Promise<void> {
  await client.delete(entityPath(segment, entityName), buildIamRequestConfig(contextId));
}

export async function listEntityPolicies(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  entityName: string
): Promise<IamPolicy[]> {
  const { data } = await client.get<IamPolicy[]>(
    `${entityPath(segment, entityName)}/policies`,
    buildIamRequestConfig(contextId),
  );
  return data;
}

export async function attachEntityPolicy(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  entityName: string,
  policy: IamPolicy
): Promise<IamPolicy> {
  const { data } = await client.post<IamPolicy>(
    `${entityPath(segment, entityName)}/policies`,
    policy,
    buildIamRequestConfig(contextId),
  );
  return data;
}

export async function detachEntityPolicy(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  entityName: string,
  policyArn: string
): Promise<void> {
  await client.delete(
    `${entityPath(segment, entityName)}/policies/${encodeURIComponent(policyArn)}`,
    buildIamRequestConfig(contextId),
  );
}

export async function listEntityInlinePolicies(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  entityName: string
): Promise<InlinePolicy[]> {
  const { data } = await client.get<InlinePolicy[]>(
    `${entityPath(segment, entityName)}/inline-policies`,
    buildIamRequestConfig(contextId),
  );
  return data;
}

export async function putEntityInlinePolicy(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  entityName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  const { data } = await client.put<InlinePolicy>(
    `${entityPath(segment, entityName)}/inline-policies/${encodeURIComponent(policyName)}`,
    { name: policyName, document },
    buildIamRequestConfig(contextId)
  );
  return data;
}

export async function deleteEntityInlinePolicy(
  segment: IamEntitySegment,
  contextId: S3ExecutionContextSelector,
  entityName: string,
  policyName: string
): Promise<void> {
  await client.delete(
    `${entityPath(segment, entityName)}/inline-policies/${encodeURIComponent(policyName)}`,
    buildIamRequestConfig(contextId),
  );
}
