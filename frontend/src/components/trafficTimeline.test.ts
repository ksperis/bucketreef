import { describe, expect, it } from "vitest";
import type { TrafficSeriesPoint } from "../api/stats";
import { buildTrafficTimeline, trafficTimelineDomain } from "./trafficTimeline";

function point(timestamp: string, ops = 1, bytesIn = 10, bytesOut = 20): TrafficSeriesPoint {
  return {
    timestamp,
    bytes_in: bytesIn,
    bytes_out: bytesOut,
    ops,
    success_ops: ops,
  };
}

describe("trafficTimeline", () => {
  it("aggregates fixed daily slots and fills missing days", () => {
    const timeline = buildTrafficTimeline(
      "week",
      [
        point("2026-10-01T01:00:00Z", 2, 10, 20),
        point("2026-10-01T18:00:00Z", 3, 30, 40),
        point("2026-10-03T12:00:00Z", 4, 50, 60),
      ],
      "2026-10-01T00:00:00Z",
      "2026-10-03T23:59:59Z",
    );

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ bytes_in: 40, bytes_out: 60, ops: 5, success_ops: 5 });
    expect(timeline[1]).toMatchObject({ bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0 });
    expect(timeline[2]).toMatchObject({ bytes_in: 50, bytes_out: 60, ops: 4, success_ops: 4 });
  });

  it("infers sub-hour slots for the hour window", () => {
    const timeline = buildTrafficTimeline(
      "hour",
      [
        point("2026-10-01T10:00:00Z"),
        point("2026-10-01T10:05:00Z"),
        point("2026-10-01T10:15:00Z"),
      ],
      "2026-10-01T10:00:00Z",
      "2026-10-01T10:15:00Z",
    );

    expect(timeline.map((entry) => entry.ops)).toEqual([1, 1, 0, 1]);
    expect(timeline.map((entry) => entry.timestamp)).toEqual([
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T10:05:00.000Z",
      "2026-10-01T10:10:00.000Z",
      "2026-10-01T10:15:00.000Z",
    ]);
  });

  it("drops invalid timestamps and keeps sorted raw data for an invalid range", () => {
    const timeline = buildTrafficTimeline(
      "day",
      [
        point("invalid"),
        point("2026-10-01T12:00:00Z", 2),
        point("2026-10-01T10:00:00Z", 1),
      ],
      "2026-10-02T00:00:00Z",
      "2026-10-01T00:00:00Z",
    );

    expect(timeline.map((entry) => entry.ops)).toEqual([1, 2]);
  });

  it("computes a centered time domain from the normalized timeline", () => {
    const timeline = buildTrafficTimeline(
      "day",
      [point("2026-10-01T10:00:00Z"), point("2026-10-01T11:00:00Z")],
    );
    const first = new Date("2026-10-01T10:00:00Z").getTime();
    const last = new Date("2026-10-01T11:00:00Z").getTime();

    expect(trafficTimelineDomain("day", timeline)).toEqual([
      first - 30 * 60 * 1000,
      last + 30 * 60 * 1000,
    ]);
  });
});
