/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import type { HealthCheckStatus } from "../../api/healthchecks";
import type { UiLanguage } from "../../components/language";
import { endpointStatusText, useEndpointStatusText } from "./endpointStatusMessages";
import { adminIntlLocale } from "./adminI18n";

export function formatStatusLabel(status: HealthCheckStatus, locale: UiLanguage = "en") {
  return endpointStatusText(`status_${status}`, locale);
}

export function StatusPill({ status }: { status: HealthCheckStatus }) {
  const { locale } = useEndpointStatusText();
  const classes =
    status === "up"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
      : status === "degraded"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
        : status === "down"
          ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-100"
          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 ui-caption font-semibold ${classes}`}>{formatStatusLabel(status, locale)}</span>;
}

export function formatLatency(value?: number | null) {
  if (value == null) return "-";
  return `${value} ms`;
}

export function formatTimestamp(value: string, locale?: UiLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(adminIntlLocale(locale ?? "en"));
}

export function formatChartTime(value: number, locale?: UiLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(adminIntlLocale(locale ?? "en"), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatChartDay(value: number | string, locale?: UiLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(adminIntlLocale(locale ?? "en"), { day: "2-digit", month: "2-digit" }).format(date);
}

export function formatPercent(value?: number | null) {
  if (value == null) return "-";
  return `${value.toFixed(1)}%`;
}

export function formatCheckMode(mode?: string | null) {
  return (mode || "http").toUpperCase();
}

export function toTimestampMs(value: string) {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function statusSegmentClass(status: HealthCheckStatus) {
  if (status === "up") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "down") return "bg-rose-500";
  return "bg-slate-300 dark:bg-slate-700";
}

export function statusTextClass(status: HealthCheckStatus) {
  if (status === "up") return "text-emerald-700 dark:text-emerald-300";
  if (status === "degraded") return "text-amber-700 dark:text-amber-300";
  if (status === "down") return "text-rose-700 dark:text-rose-300";
  return "text-slate-700 dark:text-slate-300";
}

type TimelinePoint = {
  timestamp: string;
  end_timestamp?: string | null;
  status: HealthCheckStatus;
  latency_ms?: number | null;
  reason?: string | null;
};

type TimelineSegment = {
  status: HealthCheckStatus;
  startMs: number;
  endMs: number;
  latencyMs?: number | null;
  reason?: string | null;
};

type TimelineSegmentDetail = TimelineSegment & {
  key: string;
  durationMs: number;
  cause?: string | null;
  startTimestamp: string;
  endTimestamp: string;
};

function parseTimestampMs(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

export function formatDurationShort(durationMs: number, locale: UiLanguage = "en") {
  const minutes = Math.max(0, Math.round(durationMs / 60000));
  const minuteUnit = endpointStatusText("minuteUnit", locale);
  const hourUnit = endpointStatusText("hourUnit", locale);
  const dayUnit = endpointStatusText("dayUnit", locale);
  if (minutes < 60) return `${minutes} ${minuteUnit}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours} ${hourUnit} ${remainingMinutes} ${minuteUnit}` : `${hours} ${hourUnit}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days} ${dayUnit} ${remainingHours} ${hourUnit}` : `${days} ${dayUnit}`;
}

function timelineSegmentCause(status: HealthCheckStatus, latencyMs?: number | null, reason?: string | null, locale: UiLanguage = "en") {
  if (reason) return reason;
  if (status === "down") return endpointStatusText("endpointUnavailableCause", locale);
  if (status === "degraded") {
    if (latencyMs != null) return endpointStatusText("elevatedLatencyCause", locale, { latency: latencyMs });
    return endpointStatusText("degradedCause", locale);
  }
  return null;
}

function buildTimelineSegments(points: TimelinePoint[], rangeStart?: string | null, rangeEnd?: string | null): TimelineSegment[] {
  const rangeStartMs = parseTimestampMs(rangeStart);
  const rangeEndMs = parseTimestampMs(rangeEnd);
  if (rangeStartMs == null || rangeEndMs == null || rangeEndMs <= rangeStartMs) return [];

  const sorted = [...points]
    .map((point) => ({ ...point, startMs: parseTimestampMs(point.timestamp) }))
    .filter((point): point is TimelinePoint & { startMs: number } => point.startMs != null)
    .sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return [];

  const segments: TimelineSegment[] = [];
  let cursor = rangeStartMs;
  sorted.forEach((point, index) => {
    const startMs = Math.max(point.startMs, rangeStartMs);
    const pointEndMs = parseTimestampMs(point.end_timestamp);
    const nextStartMs = sorted[index + 1]?.startMs ?? rangeEndMs;
    const endMs = Math.min(pointEndMs ?? nextStartMs, rangeEndMs);
    if (startMs > cursor) {
      segments.push({ status: "unknown", startMs: cursor, endMs: startMs });
    }
    if (endMs > startMs) {
      segments.push({
        status: point.status,
        startMs,
        endMs,
        latencyMs: point.latency_ms,
        reason: point.reason,
      });
      cursor = endMs;
    }
  });
  if (cursor < rangeEndMs) {
    segments.push({ status: "unknown", startMs: cursor, endMs: rangeEndMs });
  }
  const merged: TimelineSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push({ ...segment });
      continue;
    }
    const contiguous = segment.startMs <= previous.endMs + 1;
    if (contiguous && previous.status === segment.status) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      if (previous.latencyMs == null && segment.latencyMs != null) {
        previous.latencyMs = segment.latencyMs;
      }
      if (!previous.reason && segment.reason) {
        previous.reason = segment.reason;
      }
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

export function buildTimelineSegmentDetails(
  points: TimelinePoint[],
  rangeStart?: string | null,
  rangeEnd?: string | null,
  locale: UiLanguage = "en"
): TimelineSegmentDetail[] {
  const segments = buildTimelineSegments(points, rangeStart, rangeEnd);
  return segments.map((segment, index) => {
    const durationMs = Math.max(1, segment.endMs - segment.startMs);
    const cause = timelineSegmentCause(segment.status, segment.latencyMs, segment.reason, locale);
    return {
      ...segment,
      key: `${segment.status}-${segment.startMs}-${segment.endMs}-${index}`,
      durationMs,
      cause,
      startTimestamp: new Date(segment.startMs).toISOString(),
      endTimestamp: new Date(segment.endMs).toISOString(),
    };
  });
}

export function EndpointTimelineBar({
  points,
  rangeStart,
  rangeEnd,
  className = "mt-2 h-3",
  selectedSegmentKey,
  onSegmentSelect,
}: {
  points: TimelinePoint[];
  rangeStart?: string | null;
  rangeEnd?: string | null;
  className?: string;
  selectedSegmentKey?: string | null;
  onSegmentSelect?: (segment: TimelineSegmentDetail) => void;
}) {
  const { text, locale } = useEndpointStatusText();
  const [hoveredSegmentKey, setHoveredSegmentKey] = useState<string | null>(null);
  const segments = useMemo(() => buildTimelineSegmentDetails(points, rangeStart, rangeEnd, locale), [points, rangeStart, rangeEnd, locale]);
  const rangeStartMs = parseTimestampMs(rangeStart);
  const rangeEndMs = parseTimestampMs(rangeEnd);
  const hasRange = rangeStartMs != null && rangeEndMs != null && rangeEndMs > rangeStartMs;
  if (!hasRange || segments.length === 0 || rangeStartMs == null || rangeEndMs == null) {
    return <div className={`${className} w-full rounded-md border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700`} />;
  }

  const rangeDurationMs = rangeEndMs - rangeStartMs;
  return (
    <div className={`${className} flex overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800`}>
      {segments.map((segmentDetail) => {
        const widthPct = (segmentDetail.durationMs / rangeDurationMs) * 100;
        const isHovered = hoveredSegmentKey === segmentDetail.key;
        const isSelected = selectedSegmentKey === segmentDetail.key;
        const lines = [
          formatStatusLabel(segmentDetail.status, locale),
          text("timelineStart", { timestamp: formatTimestamp(segmentDetail.startTimestamp, locale) }),
          text("timelineEnd", { timestamp: formatTimestamp(segmentDetail.endTimestamp, locale) }),
          text("timelineDuration", { duration: formatDurationShort(segmentDetail.durationMs, locale) }),
        ];
        if (segmentDetail.cause) lines.push(text("timelineCause", { cause: segmentDetail.cause }));
        return (
          <div
            key={segmentDetail.key}
            role={onSegmentSelect ? "button" : undefined}
            tabIndex={onSegmentSelect ? 0 : undefined}
            onMouseEnter={() => {
              setHoveredSegmentKey(segmentDetail.key);
            }}
            onMouseLeave={() => {
              setHoveredSegmentKey(null);
            }}
            onClick={() => onSegmentSelect?.(segmentDetail)}
            onKeyDown={(event) => {
              if (!onSegmentSelect) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSegmentSelect(segmentDetail);
              }
            }}
            className={`h-full transition-all duration-150 ${statusSegmentClass(segmentDetail.status)} ${
              onSegmentSelect ? "cursor-pointer" : "cursor-default"
            } ${
              isHovered ? "brightness-125 ring-2 ring-inset ring-white/95 dark:ring-slate-100/90" : ""
            } ${isSelected ? "brightness-125 ring-2 ring-inset ring-white/95 dark:ring-slate-100/90" : ""}`}
            style={{ width: `${widthPct}%`, minWidth: "1px" }}
            title={lines.join("\n")}
          />
        );
      })}
    </div>
  );
}
