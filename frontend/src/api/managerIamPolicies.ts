/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3ExecutionContextSelector, withS3ContextParam } from "./accountParams";

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

export async function listIamPolicies(contextId?: S3ExecutionContextSelector): Promise<IamPolicy[]> {
  const { data } = await client.get<IamPolicy[]>("/manager/iam/policies", {
    params: withS3ContextParam(undefined, contextId),
  });
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
    { params: withS3ContextParam(undefined, contextId) }
  );
  return data;
}
