/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type S3Selector = number | string | null | undefined;

export type S3AccountSelector = S3Selector;
export type S3ExecutionContextSelector = S3Selector;

function withS3SelectorParam(
  key: "account_id" | "context_id",
  params?: Record<string, unknown> | null,
  selector?: S3Selector
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

export function normalizeS3SelectorId(
  selector: S3Selector,
): string | null {
  return selector == null ? null : String(selector);
}

export function withS3AccountParam(
  params?: Record<string, unknown> | null,
  accountId?: S3AccountSelector
): Record<string, unknown> | undefined {
  return withS3SelectorParam("account_id", params, accountId);
}

export function withS3ContextParam(
  params?: Record<string, unknown> | null,
  contextId?: S3ExecutionContextSelector
): Record<string, unknown> | undefined {
  return withS3SelectorParam("context_id", params, contextId);
}
