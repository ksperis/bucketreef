import type { TrafficSeriesPoint, TrafficWindow } from "../api/stats";

type TrafficTimelinePoint = TrafficSeriesPoint & { timestampMs: number };

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function expectedTrafficStepMs(window: TrafficWindow): number {
  if (window === "week" || window === "month") return DAY_MS;
  if (window === "day") return HOUR_MS;
  return MINUTE_MS;
}

function inferTrafficStepMs(window: TrafficWindow, points: TrafficTimelinePoint[]): number {
  const expected = expectedTrafficStepMs(window);
  if (points.length < 2 || window !== "hour") return expected;

  const diffs: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const diff = points[index].timestampMs - points[index - 1].timestampMs;
    if (diff > 0) diffs.push(diff);
  }
  if (diffs.length === 0) return expected;

  const smallestDiff = Math.min(...diffs);
  return Number.isFinite(smallestDiff) && smallestDiff > 0 ? smallestDiff : expected;
}

function slotTimestamp(timestamp: number, step: number): number {
  return step > 0 ? Math.floor(timestamp / step) * step : timestamp;
}

export function buildTrafficTimeline(
  window: TrafficWindow,
  series: TrafficSeriesPoint[],
  start?: string | null,
  end?: string | null,
): TrafficTimelinePoint[] {
  const raw = series
    .map((point) => ({ ...point, timestampMs: new Date(point.timestamp).getTime() }))
    .filter((point) => Number.isFinite(point.timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  if (!start || !end) return raw;

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return raw;

  const step = inferTrafficStepMs(window, raw);
  const startBoundary = slotTimestamp(startMs, step);
  const endBoundary = slotTimestamp(endMs, step);
  const entries = new Map<number, TrafficTimelinePoint>();

  raw.forEach((point) => {
    const key = slotTimestamp(point.timestampMs, step);
    const existing = entries.get(key);
    if (existing) {
      entries.set(key, {
        ...existing,
        bytes_in: existing.bytes_in + point.bytes_in,
        bytes_out: existing.bytes_out + point.bytes_out,
        ops: existing.ops + point.ops,
        success_ops: existing.success_ops + point.success_ops,
      });
      return;
    }
    entries.set(key, { ...point, timestampMs: key, timestamp: new Date(key).toISOString() });
  });

  const filled: TrafficTimelinePoint[] = [];
  for (let timestamp = startBoundary; timestamp <= endBoundary; timestamp += step) {
    filled.push(entries.get(timestamp) ?? {
      timestamp: new Date(timestamp).toISOString(),
      timestampMs: timestamp,
      bytes_in: 0,
      bytes_out: 0,
      ops: 0,
      success_ops: 0,
    });
  }
  return filled;
}

export function trafficTimelineDomain(
  window: TrafficWindow,
  points: TrafficTimelinePoint[],
): [number, number] | undefined {
  if (!points.length) return undefined;

  const minTimestamp = points[0]?.timestampMs;
  const maxTimestamp = points[points.length - 1]?.timestampMs;
  if (!Number.isFinite(minTimestamp) || !Number.isFinite(maxTimestamp)) return undefined;

  const halfStep = Math.max(inferTrafficStepMs(window, points) / 2, 1);
  return [minTimestamp - halfStep, maxTimestamp + halfStep];
}
