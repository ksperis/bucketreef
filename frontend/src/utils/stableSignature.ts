/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { isRecord } from "./record";

function shouldSortArray(entries: unknown[]): boolean {
  if (entries.length < 2) return false;
  if (entries.every((entry) => entry === null || ["boolean", "number", "string"].includes(typeof entry))) {
    return true;
  }
  return entries.every(
    (entry) =>
      isRecord(entry) &&
      ("id" in entry || "key" in entry || "name" in entry || "arn" in entry)
  );
}

function normalizeForStableSignature(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeForStableSignature(entry));
    if (shouldSortArray(normalized)) {
      return [...normalized].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return normalized;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, normalizeForStableSignature(entry)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

export function stableSignature(value: unknown): string {
  return JSON.stringify(normalizeForStableSignature(value));
}
