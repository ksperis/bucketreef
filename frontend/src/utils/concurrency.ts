/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const normalizeConcurrencyLimit = (
  limit: number,
  fallback = 1,
  maximum?: number,
): number => {
  if (!Number.isFinite(limit)) return fallback;
  const normalized = Math.max(1, Math.floor(limit));
  return maximum == null ? normalized : Math.min(maximum, normalized);
};

export const runWithConcurrency = async <T>(
  items: readonly T[],
  limit: number,
  handler: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> => {
  let cursor = 0;
  const workerCount = Math.min(
    normalizeConcurrencyLimit(limit),
    items.length,
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (!shouldStop()) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      await handler(items[index], index);
    }
  });
  await Promise.all(workers);
};

export const runWithConcurrencySettled = async <T, R>(
  items: readonly T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
  onSettled?: (result: PromiseSettledResult<R>, index: number) => void,
): Promise<PromiseSettledResult<R>[]> => {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const notifySettled = (
    result: PromiseSettledResult<R>,
    index: number,
  ) => {
    try {
      onSettled?.(result, index);
    } catch (error) {
      console.error("Concurrent settlement callback failed", error);
    }
  };
  const workerCount = Math.min(
    normalizeConcurrencyLimit(limit),
    items.length,
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      try {
        const value = await handler(items[index], index);
        const result: PromiseFulfilledResult<R> = {
          status: "fulfilled",
          value,
        };
        results[index] = result;
        notifySettled(result, index);
      } catch (reason) {
        const result: PromiseRejectedResult = { status: "rejected", reason };
        results[index] = result;
        notifySettled(result, index);
      }
    }
  });
  await Promise.all(workers);
  return results;
};
