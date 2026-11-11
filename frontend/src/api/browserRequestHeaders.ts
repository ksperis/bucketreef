/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3ExecutionContextSelector } from "./accountParams";
import { buildS3ContextRequestConfig } from "./accountParams";
import type { BrowserRequestOptions } from "./browserWorkspace";

export function buildBrowserWorkspaceHeaders(
  options?: BrowserRequestOptions,
): Record<string, string> {
  if (options?.workspaceSurface === "portal") {
    return { "X-S3-Workspace": "portal" };
  }
  if (options?.workspaceSurface === "manager") {
    return { "X-S3-Workspace": "manager-browser" };
  }
  return {};
}

function mergeBrowserHeaders(
  ...headers: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged = Object.assign({}, ...headers.filter(Boolean));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function buildBrowserRequestConfig(
  contextId: S3ExecutionContextSelector,
  options?: BrowserRequestOptions,
  params?: Record<string, unknown> | null,
  additionalHeaders?: Record<string, string>,
) {
  return {
    ...buildS3ContextRequestConfig(contextId, params),
    headers:
      mergeBrowserHeaders(
        additionalHeaders,
        buildBrowserWorkspaceHeaders(options),
      ) ?? {},
  };
}
