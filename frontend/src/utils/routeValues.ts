/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

export function decodeRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
