import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import usePaginatedOptions from "./usePaginatedOptions";

describe("usePaginatedOptions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets to page one only when the debounced search becomes active", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async ({ page = 1, page_size = 25, search }: { page?: number; page_size?: number; search?: string }) => ({
      items: [`${search ?? "all"}-${page}`],
      total: 100,
      page,
      page_size,
      has_next: page < 4,
    }));
    const { result } = renderHook(() => usePaginatedOptions(loader, { debounceMs: 250 }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loader).toHaveBeenLastCalledWith({ page: 1, page_size: 25 });

    act(() => result.current.setPage(3));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loader).toHaveBeenLastCalledWith({ page: 3, page_size: 25 });
    const callsBeforeInitialDebounce = loader.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.page).toBe(3);
    expect(loader).toHaveBeenCalledTimes(callsBeforeInitialDebounce);
    const callsBeforeSearch = loader.mock.calls.length;

    act(() => result.current.setSearch("  archive  "));
    expect(result.current.page).toBe(3);
    expect(loader).toHaveBeenCalledTimes(callsBeforeSearch);

    act(() => vi.advanceTimersByTime(249));
    expect(loader).toHaveBeenCalledTimes(callsBeforeSearch);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.page).toBe(1);
    expect(loader).toHaveBeenCalledTimes(callsBeforeSearch + 1);
    expect(loader).toHaveBeenLastCalledWith({ page: 1, page_size: 25, search: "archive" });
  });
});
