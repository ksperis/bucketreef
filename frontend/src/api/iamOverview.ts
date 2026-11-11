/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { S3ExecutionContextSelector } from "./accountParams";
import { buildS3ContextRequestConfig } from "./accountParams";

export type IamOverview = {
  iam_users: number;
  iam_groups: number;
  iam_roles: number;
  iam_policies: number;
  warnings: string[];
};

export async function fetchIamOverview(contextId?: S3ExecutionContextSelector): Promise<IamOverview> {
  const { data } = await client.get<IamOverview>(
    "/manager/iam/overview",
    buildS3ContextRequestConfig(contextId),
  );
  return data;
}
