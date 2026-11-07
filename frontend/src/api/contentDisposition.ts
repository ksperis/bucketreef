/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { lastNonEmptyPathSegment } from "../utils/pathSegments";

export function filenameFromContentDisposition(
  value: unknown,
  fallback: string,
): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const extended = value.match(/filename\*\s*=\s*([^;]+)/i);
  if (extended?.[1]) {
    const raw = extended[1].trim().replace(/^"|"$/g, "");
    const encoded = raw.includes("''") ? raw.split("''").at(-1) ?? raw : raw;
    try {
      const decoded = decodeURIComponent(encoded);
      return lastNonEmptyPathSegment(decoded, fallback);
    } catch {
      return lastNonEmptyPathSegment(encoded, fallback);
    }
  }
  const basic = value.match(/filename\s*=\s*"?([^";]+)"?/i);
  return lastNonEmptyPathSegment(basic?.[1], fallback);
}
