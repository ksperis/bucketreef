/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export function lastNonEmptyPathSegment(
  value: string | null | undefined,
  fallback: string,
): string {
  return value?.split("/").filter(Boolean).at(-1) ?? fallback;
}
