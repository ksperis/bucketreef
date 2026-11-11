/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { S3ExecutionContextSelector } from "./accountParams";
import {
  buildIamRequestConfig,
  type IamCursorPage,
  type IamCursorQuery,
} from "./managerIamEntityClient";

export type IamPolicy = {
  name: string;
  arn: string;
  path?: string;
  default_version_id?: string;
  document?: Record<string, unknown>;
};

export type InlinePolicy = {
  name: string;
  document: Record<string, unknown>;
};

export async function listIamPoliciesPage(
  contextId: S3ExecutionContextSelector,
  query: IamCursorQuery = {},
): Promise<IamCursorPage<IamPolicy>> {
  const requestConfig = buildIamRequestConfig(
    contextId,
    {
      ...(query.marker ? { marker: query.marker } : {}),
      ...(query.page_size ? { page_size: query.page_size } : {}),
      ...(query.search?.trim() ? { search: query.search.trim() } : {}),
    },
  );
  const { data } = await client.get<IamCursorPage<IamPolicy>>(
    "/manager/iam/policies/page",
    requestConfig,
  );
  return data;
}

export async function createIamPolicy(
  contextId: S3ExecutionContextSelector,
  name: string,
  document: Record<string, unknown>
): Promise<IamPolicy> {
  const { data } = await client.post<IamPolicy>(
    "/manager/iam/policies",
    { name, document },
    buildIamRequestConfig(contextId)
  );
  return data;
}
