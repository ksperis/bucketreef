/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3ExecutionContextSelector } from "./accountParams";
import type { StsCredentials, StsStatus } from "./browserContracts";
import { buildBrowserRequestConfig } from "./browserRequestHeaders";
import type { BrowserRequestOptions } from "./browserWorkspace";
import client from "./client";

export async function getBrowserStsStatus(
  contextId: S3ExecutionContextSelector,
  options?: BrowserRequestOptions,
): Promise<StsStatus> {
  const { data } = await client.get<StsStatus>(
    "/browser/sts",
    buildBrowserRequestConfig(contextId, options),
  );
  return data;
}

export async function getBrowserStsCredentials(
  contextId: S3ExecutionContextSelector,
  options?: BrowserRequestOptions,
): Promise<StsCredentials> {
  const { data } = await client.get<StsCredentials>(
    "/browser/sts/credentials",
    buildBrowserRequestConfig(contextId, options),
  );
  return data;
}
