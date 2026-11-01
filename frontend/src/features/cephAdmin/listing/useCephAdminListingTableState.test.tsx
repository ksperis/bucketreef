import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { persistCephAdminVisibleColumns } from "./cephAdminListingViewState";
import { useCephAdminListingTableState } from "./useCephAdminListingTableState";

const options = {
  storageKey: "ceph-admin.test.table.columns",
  allowedColumns: ["tenant", "email"] as const,
  defaultVisibleColumns: ["tenant"] as const,
  defaultSort: { field: "uid" as const, direction: "asc" as const },
};

describe("useCephAdminListingTableState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads, updates, resets, and persists visible columns", async () => {
    persistCephAdminVisibleColumns(options.storageKey, ["email"]);
    const { result } = renderHook(() => useCephAdminListingTableState(options));

    expect(result.current.visibleColumns).toEqual(["email"]);
    expect(result.current.columnsCustomized).toBe(true);

    act(() => result.current.resetColumns());
    expect(result.current.visibleColumns).toEqual(["tenant"]);
    expect(result.current.columnsCustomized).toBe(false);
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(options.storageKey) ?? "null")).toEqual(["tenant"]);
    });

    act(() => result.current.toggleColumn("email"));
    expect(result.current.visibleColumns).toEqual(["tenant", "email"]);
    expect(result.current.columnsCustomized).toBe(true);
  });

  it("resets pagination when sort or page size changes", () => {
    const { result } = renderHook(() => useCephAdminListingTableState(options));

    act(() => result.current.setPage(4));
    act(() => result.current.toggleSort("uid"));
    expect(result.current.page).toBe(1);
    expect(result.current.sort).toEqual({ field: "uid", direction: "desc" });

    act(() => result.current.setPage(3));
    act(() => result.current.changePageSize(50));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
  });

  it("exposes explicit resets for endpoint-specific page behavior", () => {
    const { result } = renderHook(() => useCephAdminListingTableState(options));

    act(() => result.current.toggleSort("uid"));
    act(() => result.current.changePageSize(100));
    act(() => {
      result.current.resetSort();
      result.current.resetPageSize();
    });

    expect(result.current.sort).toEqual(options.defaultSort);
    expect(result.current.pageSize).toBe(25);
  });
});
