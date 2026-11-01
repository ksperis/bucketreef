/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import useAdminPaginatedListController from "./useAdminPaginatedListController";

describe("useAdminPaginatedListController", () => {
  it("loads a page, exposes totals, and updates a loaded item", async () => {
    const loadPage = vi.fn().mockResolvedValue({ items: [{ id: 7, name: "before" }], total: 3 });
    const ensurePageInRange = vi.fn().mockReturnValue(true);
    const formatError = vi.fn((error: unknown) => String(error));
    const onLoaded = vi.fn();
    const { result } = renderHook(() =>
      useAdminPaginatedListController({ loadPage, ensurePageInRange, formatError, onLoaded }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([{ id: 7, name: "before" }]);
    expect(result.current.total).toBe(3);
    expect(ensurePageInRange).toHaveBeenCalledWith(3);
    expect(onLoaded).toHaveBeenCalledTimes(1);

    act(() => result.current.updateItem(7, (item) => ({ ...item, name: "after" })));
    expect(result.current.items).toEqual([{ id: 7, name: "after" }]);

    act(() => result.current.setError("Action failed"));
    expect(result.current.error).toBe("Action failed");
  });

  it("keeps the current page when pagination redirects and reports load errors", async () => {
    const ensurePageInRange = vi.fn().mockReturnValue(true);
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 1, name: "current" }], total: 1 })
      .mockResolvedValueOnce({ items: [{ id: 2, name: "ignored" }], total: 0 })
      .mockRejectedValueOnce(new Error("unavailable"));
    const formatError = vi.fn(() => "Unable to load");
    const onLoaded = vi.fn();
    const { result } = renderHook(() =>
      useAdminPaginatedListController({ loadPage, ensurePageInRange, formatError, onLoaded }),
    );

    await waitFor(() => expect(result.current.items).toEqual([{ id: 1, name: "current" }]));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    ensurePageInRange.mockReturnValueOnce(false);
    await act(async () => result.current.refresh());
    expect(result.current.items).toEqual([{ id: 1, name: "current" }]);
    expect(result.current.total).toBe(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);

    await act(async () => result.current.refresh());
    expect(result.current.error).toBe("Unable to load");
    expect(formatError).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("ignores an obsolete page after the loader changes", async () => {
    let resolveFirst: ((value: { items: Array<{ id: number; name: string }>; total: number }) => void) | undefined;
    const firstLoader = vi.fn(
      () => new Promise<{ items: Array<{ id: number; name: string }>; total: number }>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const secondLoader = vi.fn().mockResolvedValue({ items: [{ id: 2, name: "new" }], total: 1 });
    const ensurePageInRange = vi.fn().mockReturnValue(true);
    const formatError = vi.fn(() => "Unable to load");
    const { result, rerender } = renderHook(
      ({ loadPage }) => useAdminPaginatedListController({ loadPage, ensurePageInRange, formatError }),
      { initialProps: { loadPage: firstLoader } },
    );

    rerender({ loadPage: secondLoader });
    await waitFor(() => expect(result.current.items).toEqual([{ id: 2, name: "new" }]));

    await act(async () => resolveFirst?.({ items: [{ id: 1, name: "stale" }], total: 1 }));
    expect(result.current.items).toEqual([{ id: 2, name: "new" }]);
    expect(result.current.total).toBe(1);
    expect(result.current.error).toBeNull();
  });
});
