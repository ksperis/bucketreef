/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type S3AccountId = number;
export type S3ExecutionContextId = string;
export type S3AccountSelector = S3AccountId | null | undefined;
export type S3ExecutionContextSelector = S3ExecutionContextId | null | undefined;

export function normalizeS3AccountId(
  accountId: S3AccountSelector,
): string | null {
  return accountId == null || accountId <= 0 ? null : String(accountId);
}

export function normalizeS3ExecutionContextId(
  contextId: S3ExecutionContextSelector,
): string | null {
  return contextId == null || contextId.trim() === "" ? null : contextId;
}

export function withS3AccountParam(
  params?: Record<string, unknown> | null,
  accountId?: S3AccountSelector
): Record<string, unknown> | undefined {
  if (accountId == null || accountId <= 0) {
    return params ?? undefined;
  }
  return { ...(params ?? {}), account_id: accountId };
}

export function withS3ContextParam(
  params?: Record<string, unknown> | null,
  contextId?: S3ExecutionContextSelector
): Record<string, unknown> | undefined {
  if (contextId == null || contextId.trim() === "") {
    return params ?? undefined;
  }
  return { ...(params ?? {}), context_id: contextId };
}
