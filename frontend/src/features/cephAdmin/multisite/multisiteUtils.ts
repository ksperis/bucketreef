/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type {
  MultisiteObservation,
  MultisiteTopology,
} from "../../../api/cephMultisite";

export type MultisiteText = (message: string, values?: Record<string, string | number>) => string;

export type MultisiteEndpointOption = {
  endpointId: number;
  endpointName: string;
  zoneId: string;
  zoneName: string;
  zonegroupId: string;
  zonegroupName: string;
};

export function getDeclaredEndpointOptions(topology: MultisiteTopology | null): MultisiteEndpointOption[] {
  const zones = topology?.period.data?.zones ?? [];
  const options: MultisiteEndpointOption[] = [];
  for (const zone of zones) {
    const declaredIds = new Set<number>();
    if (zone.diagnostic_endpoint_id != null) declaredIds.add(zone.diagnostic_endpoint_id);
    for (const endpoint of zone.endpoints) {
      if (endpoint.diagnostic) declaredIds.add(endpoint.id);
    }
    for (const endpoint of zone.endpoints) {
      if (!declaredIds.has(endpoint.id)) continue;
      options.push({
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        zoneId: zone.id,
        zoneName: zone.name,
        zonegroupId: zone.zonegroup_id,
        zonegroupName: zone.zonegroup_name,
      });
    }
  }
  return options;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "—";
  return value;
}

export function observationAvailabilityLabel(
  observation: Pick<MultisiteObservation<unknown>, "availability" | "stale">,
  text: MultisiteText,
): string {
  const labels = {
    available: text("Available"),
    not_observed: text("Not observed"),
    not_applicable: text("Not applicable"),
    not_found: text("Not found"),
    denied: text("Access denied"),
    unsupported: text("Unsupported"),
    unavailable: text("Unavailable"),
    misconfigured: text("Misconfigured"),
  } as const;
  const base = labels[observation.availability];
  return observation.stale ? text("{status} · stale", { status: base }) : base;
}

export function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, nested) => {
        if (typeof nested === "bigint") return nested.toString();
        if (nested && typeof nested === "object") {
          if (seen.has(nested)) return "[Circular]";
          seen.add(nested);
        }
        return nested;
      },
      2,
    ) ?? "null";
  } catch {
    return "null";
  }
}

export function lookupRecordValue(record: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    let value: unknown = record;
    let found = true;
    for (const part of path.split(".")) {
      if (!value || typeof value !== "object" || Array.isArray(value) || !(part in value)) {
        found = false;
        break;
      }
      value = (value as Record<string, unknown>)[part];
    }
    if (found && value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function displayRecordValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return safeJson(value).replace(/\s+/g, " ").trim();
}

export function matchesLoadedEntry(entry: Record<string, unknown>, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return safeJson(entry).toLocaleLowerCase().includes(normalized);
}

function neutralizeSpreadsheetFormula(value: string): string {
  const leftTrimmed = value.replace(/^\s+/, "");
  return /^[=+\-@]/.test(leftTrimmed) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const safe = neutralizeSpreadsheetFormula(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

export function recordsToCsv(records: Record<string, unknown>[]): string {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  if (keys.length === 0) return "";
  const header = keys.map((key) => csvCell(key)).join(",");
  const rows = records.map((record) =>
    keys.map((key) => {
      const value = record[key];
      const rendered =
        value === null || value === undefined
          ? ""
          : typeof value === "object"
            ? safeJson(value).replace(/\r?\n/g, " ")
            : String(value);
      return csvCell(rendered);
    }).join(","),
  );
  return [header, ...rows].join("\n");
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildMultisiteHref(path: string, currentSearch: URLSearchParams, extra: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  const endpoint = currentSearch.get("ep");
  if (endpoint) params.set("ep", endpoint);
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseNonNegativeInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
