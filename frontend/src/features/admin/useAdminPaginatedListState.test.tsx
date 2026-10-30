/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import useAdminPaginatedListState from "./useAdminPaginatedListState";

describe("useAdminPaginatedListState", () => {
  it("owns the shared filter, sorting, and pagination transitions", () => {
    const { result } = renderHook(() =>
      useAdminPaginatedListState<"name" | "role">({
        initialFilter: "alice",
        initialSort: { field: "name", direction: "asc" },
      }),
    );

    expect(result.current.filter).toBe("alice");
    expect(result.current.sort).toEqual({ field: "name", direction: "asc" });
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);

    act(() => result.current.setPage(3));
    act(() => result.current.handleFilterChange("admin"));
    expect(result.current.filter).toBe("admin");
    expect(result.current.page).toBe(1);

    act(() => result.current.setPage(4));
    act(() => result.current.handleSort("role"));
    expect(result.current.sort).toEqual({ field: "role", direction: "desc" });
    expect(result.current.page).toBe(1);

    act(() => result.current.handleSort("role"));
    expect(result.current.sort).toEqual({ field: "role", direction: "asc" });

    act(() => result.current.setPage(5));
    act(() => result.current.handlePageSizeChange(50));
    expect(result.current.pageSize).toBe(50);
    expect(result.current.page).toBe(1);

    act(() => result.current.handlePageChange(0));
    expect(result.current.page).toBe(1);
  });
});
