/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type S3AccountSelector = number | string | null | undefined;

function withS3SelectorParam(
  key: "account_id" | "context_id",
  params?: Record<string, unknown> | null,
  selector?: S3AccountSelector
): Record<string, unknown> | undefined {
  if (selector == null) {
    return params ?? undefined;
  }
  if (typeof selector === "number" && selector <= 0) {
    return params ?? undefined;
  }
  if (typeof selector === "string" && selector.trim() === "") {
    return params ?? undefined;
  }
  return { ...(params ?? {}), [key]: selector };
}

export function normalizeS3AccountSelectorId(
  accountId: S3AccountSelector,
): string | null {
  return accountId == null ? null : String(accountId);
}

export function withS3AccountParam(
  params?: Record<string, unknown> | null,
  accountId?: S3AccountSelector
): Record<string, unknown> | undefined {
  return withS3SelectorParam("account_id", params, accountId);
}

export function withS3ContextParam(
  params?: Record<string, unknown> | null,
  contextId?: S3AccountSelector
): Record<string, unknown> | undefined {
  return withS3SelectorParam("context_id", params, contextId);
}
