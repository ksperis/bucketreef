/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export function formatLocalDateTime(value?: string | Date | null, locale?: string): string {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : parseBackendDateTime(value);
  if (!parsed) return typeof value === "string" ? value : "-";
  if (Number.isNaN(parsed.getTime())) return typeof value === "string" ? value : "-";
  return parsed.toLocaleString(locale);
}

type BackendElapsedTime = {
  parsed: Date;
  milliseconds: number;
  minutes: number;
  hours: number;
  days: number;
};

export function parseBackendDateTime(value?: string | null): Date | null {
  if (!value) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const parsed = new Date(hasTimezone ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getBackendElapsedTime(
  value?: string | null,
  now = Date.now(),
): BackendElapsedTime | null {
  const parsed = parseBackendDateTime(value);
  if (!parsed) return null;
  const milliseconds = Math.max(0, now - parsed.getTime());
  const minutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return { parsed, milliseconds, minutes, hours, days };
}
