/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { isRecord } from "../../../utils/record";

type JsonObjectArrayErrors = {
  invalidJson: string;
  notArray: string;
  invalidEntry: string;
};

export function parseJsonObjectArray<T extends Record<string, unknown>>(
  text: string,
  errors: JsonObjectArrayErrors,
): { items: T[] | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : [];
  } catch {
    return { items: null, error: errors.invalidJson };
  }
  if (!Array.isArray(parsed)) {
    return { items: null, error: errors.notArray };
  }
  if (parsed.some((entry) => !isRecord(entry))) {
    return { items: null, error: errors.invalidEntry };
  }
  return { items: parsed as T[], error: null };
}
