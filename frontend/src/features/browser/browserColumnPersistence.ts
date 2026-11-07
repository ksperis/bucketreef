/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { isRecord } from "../../utils/record";

export const normalizePersistedBrowserColumns = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

export const normalizePersistedBrowserColumnWidths = (
  value: unknown,
): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, number>>(
    (acc, [key, entry]) => {
      if (
        !key.trim() ||
        typeof entry !== "number" ||
        !Number.isFinite(entry) ||
        entry <= 0
      ) {
        return acc;
      }
      acc[key] = Math.round(entry);
      return acc;
    },
    {},
  );
};
