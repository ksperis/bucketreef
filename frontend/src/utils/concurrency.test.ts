import { describe, expect, it, vi } from "vitest";

import {
  normalizeConcurrencyLimit,
  runWithConcurrency,
  runWithConcurrencySettled,
} from "./concurrency";

describe("normalizeConcurrencyLimit", () => {
  it("normalizes finite limits and preserves the requested fallback", () => {
    expect(normalizeConcurrencyLimit(Number.NaN, 4, 20)).toBe(4);
    expect(normalizeConcurrencyLimit(0, 4, 20)).toBe(1);
    expect(normalizeConcurrencyLimit(8.9, 4, 20)).toBe(8);
    expect(normalizeConcurrencyLimit(99, 4, 20)).toBe(20);
  });
});

describe("runWithConcurrency", () => {
  it("bounds workers and stops dequeuing when requested", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let stopped = false;
    const processed: number[] = [];

    await runWithConcurrency(
      [1, 2, 3, 4],
      2,
      async (value) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        processed.push(value);
        if (value === 2) stopped = true;
        await Promise.resolve();
        inFlight -= 1;
      },
      () => stopped,
    );

    expect(maxInFlight).toBe(2);
    expect(processed).toEqual([1, 2]);
  });

  it("propagates worker failures", async () => {
    await expect(
      runWithConcurrency([1], 1, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
  });
});

describe("runWithConcurrencySettled", () => {
  it("bounds concurrency and preserves input order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const settledIndexes: number[] = [];

    const results = await runWithConcurrencySettled(
      [1, 2, 3, 4, 5],
      2,
      async (value) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        if (value === 3) throw new Error("failed");
        return value * 10;
      },
      (_result, index) => settledIndexes.push(index),
    );

    expect(maxInFlight).toBe(2);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[2]).toMatchObject({ status: "rejected" });
    expect(settledIndexes).toHaveLength(5);
  });

  it("isolates settlement observers from the work result", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const results = await runWithConcurrencySettled(
      [1, 2],
      0,
      async (value) => value,
      () => {
        throw new Error("observer failed");
      },
    );

    expect(results).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 2 },
    ]);
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
