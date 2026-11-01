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

  it("does not load while disabled and invalidates an in-flight response when disabled", async () => {
    let resolveLoad: ((value: { id: number }) => void) | undefined;
    const loadResource = vi.fn(
      () => new Promise<{ id: number }>((resolve) => { resolveLoad = resolve; }),
    );
    const formatError = vi.fn(() => "Unable to load");
    const { result, rerender } = renderHook(
      ({ enabled }) => useAdminResourceController({
        loadResource,
        initialResource: null as { id: number } | null,
        formatError,
        enabled,
      }),
      { initialProps: { enabled: false } },
    );

    expect(result.current.loading).toBe(false);
    expect(loadResource).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(loadResource).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => resolveLoad?.({ id: 1 }));

    expect(result.current.resource).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("keeps the raw load failure alongside the formatted error", async () => {
    const failure = new Error("request failed");
    const loadResource = vi.fn().mockRejectedValue(failure);
    const formatError = vi.fn(() => "Unable to load");
    const { result } = renderHook(() =>
      useAdminResourceController({
        loadResource,
        initialResource: null,
        formatError,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Unable to load");
    expect(result.current.errorCause).toBe(failure);
  });

  it("reloads when the reload token changes and can reset while loading", async () => {
    let resolveSecond: ((value: { id: number }) => void) | undefined;
    const loadResource = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockImplementationOnce(
        () => new Promise<{ id: number }>((resolve) => { resolveSecond = resolve; }),
      );
    const formatError = vi.fn(() => "Unable to load");
    const { result, rerender } = renderHook(
      ({ reloadToken }) => useAdminResourceController({
        loadResource,
        initialResource: null as { id: number } | null,
        formatError,
        reloadToken,
        resetResourceOnLoad: true,
      }),
      { initialProps: { reloadToken: 0 } },
    );

    await waitFor(() => expect(result.current.resource).toEqual({ id: 1 }));
    rerender({ reloadToken: 1 });

    await waitFor(() => expect(result.current.resource).toBeNull());
    expect(result.current.loading).toBe(true);
    await act(async () => resolveSecond?.({ id: 2 }));
    expect(result.current.resource).toEqual({ id: 2 });
    expect(result.current.loading).toBe(false);
  });

  it("can reset resources after failures and when disabled", async () => {
    const failure = new Error("request failed");
    const loadResource = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(failure);
    const formatError = vi.fn(() => "Unable to load");
    const { result, rerender } = renderHook(
      ({ enabled }) => useAdminResourceController({
        loadResource,
        initialResource: null as { id: number } | null,
        formatError,
        enabled,
        resetResourceOnError: true,
        resetResourceWhenDisabled: true,
      }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.resource).toEqual({ id: 1 }));
    await act(async () => result.current.refresh());
    expect(result.current.resource).toBeNull();
    expect(result.current.error).toBe("Unable to load");
    expect(result.current.errorCause).toBe(failure);

    act(() => result.current.setResource({ id: 3 }));
    rerender({ enabled: false });
    await waitFor(() => expect(result.current.resource).toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.errorCause).toBeNull();
  });
});
