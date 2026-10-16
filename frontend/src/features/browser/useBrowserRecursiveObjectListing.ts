/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { listBrowserObjects } from "../../api/browserObjects";
import type { BrowserObject } from "../../api/browserContracts";

const RECURSIVE_LIST_PAGE_SIZE = 1000;

export type ListAllBrowserObjectsForPrefix = (
  prefix: string,
  bucketName?: string,
  contextId?: S3ExecutionContextSelector,
  signal?: AbortSignal,
) => Promise<BrowserObject[]>;

type UseBrowserRecursiveObjectListingOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName: string;
  enabled: boolean;
  requestOptions?: BrowserRequestOptions;
};

export function useBrowserRecursiveObjectListing({
  contextId,
  bucketName,
  enabled,
  requestOptions,
}: UseBrowserRecursiveObjectListingOptions): ListAllBrowserObjectsForPrefix {
  return useCallback(
    async (
      prefix: string,
      targetBucketName?: string,
      targetContextId?: S3ExecutionContextSelector,
      signal?: AbortSignal,
    ) => {
      const resolvedBucketName = targetBucketName ?? bucketName;
      if (!resolvedBucketName || !enabled) return [];

      const objects: BrowserObject[] = [];
      let continuationToken: string | null = null;
      let hasMore = true;
      while (hasMore) {
        const page = await listBrowserObjects(
          targetContextId ?? contextId,
          resolvedBucketName,
          {
            prefix,
            continuationToken,
            maxKeys: RECURSIVE_LIST_PAGE_SIZE,
            type: "file",
            recursive: true,
            includeFolderMarkers: true,
            signal,
            ...requestOptions,
          },
        );
        objects.push(...page.objects);
        continuationToken = page.next_continuation_token ?? null;
        hasMore = Boolean(page.is_truncated && continuationToken);
      }
      return objects;
    },
    [contextId, bucketName, enabled, requestOptions],
  );
}
