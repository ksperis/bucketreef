/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import useAdminPaginationState from "./useAdminPaginationState";

describe("useAdminPaginationState", () => {
  it("owns shared filter and pagination transitions", () => {
    const { result } = renderHook(() =>
      useAdminPaginationState({ initialFilter: "alice", initialPageSize: 50 }),
    );

    expect(result.current.filter).toBe("alice");
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);

    act(() => result.current.handlePageChange(3));
    act(() => result.current.handleFilterChange("admin"));
    expect(result.current.filter).toBe("admin");
    expect(result.current.page).toBe(1);

    act(() => result.current.handlePageChange(4));
    act(() => result.current.handlePageSizeChange(100));
    expect(result.current.pageSize).toBe(100);
    expect(result.current.page).toBe(1);

    act(() => result.current.handlePageChange(0));
    expect(result.current.page).toBe(1);
  });

  it("moves an out-of-range page to the last available page", () => {
    const { result } = renderHook(() => useAdminPaginationState({ initialPageSize: 25 }));

    act(() => result.current.handlePageChange(5));
    let currentPageWasValid = true;
    act(() => {
      currentPageWasValid = result.current.ensurePageInRange(51);
    });

    expect(currentPageWasValid).toBe(false);
    expect(result.current.page).toBe(3);
    expect(result.current.ensurePageInRange(51)).toBe(true);
  });
});
