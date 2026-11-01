/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import useAdminListController from "./useAdminListController";

describe("useAdminListController", () => {
  it("loads eagerly, refreshes, and allows local list updates", async () => {
    const loadItems = vi.fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }]);
    const formatError = vi.fn((error: unknown) => String(error));
    const { result } = renderHook(() =>
      useAdminListController({ loadItems, formatError }),
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.items).toEqual([{ id: 1 }]));
    expect(result.current.loading).toBe(false);

    await act(async () => result.current.refresh());
    expect(result.current.items).toEqual([{ id: 2 }]);

    act(() => result.current.setItems([{ id: 3 }]));
    expect(result.current.items).toEqual([{ id: 3 }]);
  });

  it("formats load errors and ignores a failure after unmount", async () => {
    let rejectLoad: ((error: Error) => void) | undefined;
    const loadItems = vi.fn(
      () =>
        new Promise<Array<{ id: number }>>((_, reject) => {
          rejectLoad = reject;
        }),
    );
    const formatError = vi.fn(() => "Unable to load");
    const { result, unmount } = renderHook(() =>
      useAdminListController({ loadItems, formatError }),
    );

    expect(result.current.loading).toBe(true);
    unmount();
    rejectLoad?.(new Error("late failure"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(formatError).not.toHaveBeenCalled();
  });
});
