import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import useLazyListLoader from "./useLazyListLoader";

describe("useLazyListLoader", () => {
  it("deduplicates concurrent ensure calls and caches the loaded list", async () => {
    let resolveLoad: ((items: string[]) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const { result } = renderHook(() => useLazyListLoader(loader));

    let firstLoad: Promise<void> | undefined;
    await act(async () => {
      firstLoad = result.current.ensure();
      await result.current.ensure();
      expect(loader).toHaveBeenCalledTimes(1);
      resolveLoad?.(["one", "two"]);
      await firstLoad;
    });

    expect(result.current.items).toEqual(["one", "two"]);
    expect(result.current.loaded).toBe(true);

    await act(async () => {
      await result.current.ensure();
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("retries a failed load only when requested", async () => {
    const loadError = new Error("unavailable");
    const loader = vi.fn().mockRejectedValueOnce(loadError).mockResolvedValueOnce(["recovered"]);
    const onError = vi.fn();
    const { result } = renderHook(() => useLazyListLoader<string>(loader, onError));

    await act(async () => {
      await result.current.ensure();
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(loadError);

    await act(async () => {
      await result.current.ensure();
    });
    expect(loader).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.ensure({ retryOnError: true });
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.current.items).toEqual(["recovered"]);
    expect(result.current.loaded).toBe(true);
  });

  it("ignores a load failure after the consumer unmounts", async () => {
    let rejectLoad: ((error: Error) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<string[]>((_, reject) => {
          rejectLoad = reject;
        }),
    );
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useLazyListLoader<string>(loader, onError));

    let pendingLoad: Promise<void> | undefined;
    act(() => {
      pendingLoad = result.current.ensure();
    });
    unmount();
    rejectLoad?.(new Error("late failure"));
    await pendingLoad;

    expect(onError).not.toHaveBeenCalled();
  });
});
