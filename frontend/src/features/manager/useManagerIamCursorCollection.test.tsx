import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { IamCursorQuery } from "../../api/managerIamEntityClient";
import { useManagerIamCursorCollection } from "./useManagerIamCursorCollection";

describe("useManagerIamCursorCollection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets the cursor only when the debounced search becomes active", async () => {
    vi.useFakeTimers();
    const listPage = vi.fn(async (_contextId: S3ExecutionContextSelector, query?: IamCursorQuery) => ({
      items: [query?.search ?? query?.marker ?? "first"],
      next_marker: query?.marker ? null : "next-1",
    }));
    const { result } = renderHook(() => useManagerIamCursorCollection<string>(listPage));

    act(() => result.current.load("acc-1"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listPage).toHaveBeenLastCalledWith("acc-1", { marker: null, page_size: 25 });

    act(() => result.current.nextPage());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.page).toBe(2);
    expect(listPage).toHaveBeenLastCalledWith("acc-1", { marker: "next-1", page_size: 25 });
    const callsBeforeSearch = listPage.mock.calls.length;

    act(() => result.current.setSearch("  archive  "));
    expect(result.current.page).toBe(2);
    expect(listPage).toHaveBeenCalledTimes(callsBeforeSearch);

    act(() => vi.advanceTimersByTime(249));
    expect(listPage).toHaveBeenCalledTimes(callsBeforeSearch);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.page).toBe(1);
    expect(listPage).toHaveBeenCalledTimes(callsBeforeSearch + 1);
    expect(listPage).toHaveBeenLastCalledWith("acc-1", {
      marker: null,
      page_size: 25,
      search: "archive",
    });
  });
});
