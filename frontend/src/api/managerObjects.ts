/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3ExecutionContextSelector, withS3ContextParam } from "./accountParams";

export type ManagerObject = {
  key: string;
  size: number;
  last_modified?: string;
  storage_class?: string | null;
};

type ManagerObjectListingResponse = {
  prefix: string;
  objects: ManagerObject[];
  prefixes: string[];
  is_truncated: boolean;
  next_continuation_token: string | null;
};

export async function listManagerObjects(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  prefix = "",
  continuationToken?: string,
): Promise<ManagerObjectListingResponse> {
  const { data } = await client.get<ManagerObjectListingResponse>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/objects`,
    {
      params: withS3ContextParam(
        {
          prefix,
          continuation_token: continuationToken,
        },
        contextId,
      ),
    },
  );
  return data;
}
