/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import useAdminResourceController from "./useAdminResourceController";

describe("useAdminResourceController", () => {
  it("loads eagerly, refreshes, and allows local resource updates", async () => {
    const loadResource = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });
    const formatError = vi.fn((error: unknown) => String(error));
    const { result } = renderHook(() =>
      useAdminResourceController({
        loadResource,
        initialResource: null as { id: number } | null,
        formatError,
      }),
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.resource).toEqual({ id: 1 }));
    expect(result.current.loading).toBe(false);

    await act(async () => result.current.refresh());
    expect(result.current.resource).toEqual({ id: 2 });

    act(() => result.current.setResource({ id: 3 }));
    expect(result.current.resource).toEqual({ id: 3 });
  });

  it("ignores an obsolete load after the loader changes", async () => {
    let resolveFirst: ((value: { id: number }) => void) | undefined;
    const firstLoader = vi.fn(
      () => new Promise<{ id: number }>((resolve) => { resolveFirst = resolve; }),
    );
    const secondLoader = vi.fn().mockResolvedValue({ id: 2 });
    const formatError = vi.fn(() => "Unable to load");
    const { result, rerender } = renderHook(
      ({ loadResource }) => useAdminResourceController({
        loadResource,
        initialResource: null as { id: number } | null,
        formatError,
      }),
      { initialProps: { loadResource: firstLoader } },
    );

    rerender({ loadResource: secondLoader });
    await waitFor(() => expect(result.current.resource).toEqual({ id: 2 }));

    await act(async () => resolveFirst?.({ id: 1 }));
    expect(result.current.resource).toEqual({ id: 2 });
    expect(result.current.error).toBeNull();
  });
});
