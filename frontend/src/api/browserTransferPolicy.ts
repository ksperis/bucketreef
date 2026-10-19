/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { S3ExecutionContextSelector } from "./accountParams";
import type { BrowserWorkspaceSurface } from "./browserWorkspace";
import client from "./client";

export type BrowserTransferScope = {
  contextId: S3ExecutionContextSelector;
  workspace: BrowserWorkspaceSurface;
};

export type BrowserTransferPolicy = {
  workspace: BrowserWorkspaceSurface;
  context_id: string | null;
  connect_sources: string[];
  policy_id: string;
};

export async function getBrowserTransferPolicy(scope: BrowserTransferScope): Promise<BrowserTransferPolicy> {
  const { data } = await client.get<BrowserTransferPolicy>("/browser/direct-transfer-policy", {
    params: { workspace: scope.workspace, context_id: scope.contextId },
  });
  return data;
}
