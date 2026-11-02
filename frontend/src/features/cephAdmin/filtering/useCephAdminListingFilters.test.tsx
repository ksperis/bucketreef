import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCephAdminListingFilters } from "./useCephAdminListingFilters";

type TestFilterState = {
  name: string;
  suspended: "any" | "active" | "suspended";
};

const defaultAdvancedFilter: TestFilterState = {
  name: "",
  suspended: "any",
};

const serializeAdvancedFilter = (state: TestFilterState | null) => {
  if (!state || (state.name === "" && state.suspended === "any")) return undefined;
  return JSON.stringify(state);
};

describe("useCephAdminListingFilters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces and trims the quick filter while resetting pagination", () => {
    const setPage = vi.fn();
    const { result } = renderHook(() =>
      useCephAdminListingFilters({ endpointId: 1, defaultAdvancedFilter, serializeAdvancedFilter, setPage })
    );
    setPage.mockClear();

    act(() => {
      result.current.setFilter("  alice  ");
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.searchValue).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.searchValue).toBe("alice");
    expect(setPage).toHaveBeenCalledWith(1);
  });

  it("applies a draft and restores field-specific defaults when a filter is removed", () => {
    const setPage = vi.fn();
    const { result } = renderHook(() =>
      useCephAdminListingFilters({ endpointId: 1, defaultAdvancedFilter, serializeAdvancedFilter, setPage })
    );

    act(() => {
      result.current.updateAdvancedField("name", "Alice");
      result.current.updateAdvancedField("suspended", "suspended");
    });
    act(() => {
      result.current.applyAdvancedFilter();
    });
    expect(result.current.advancedApplied).toEqual({ name: "Alice", suspended: "suspended" });

    act(() => {
      result.current.removeActiveFilterItem({ type: "advanced", field: "suspended" });
    });
    expect(result.current.advancedDraft.suspended).toBe("any");
    expect(result.current.advancedApplied?.suspended).toBe("any");
  });

  it("owns quick-filter mode and advanced drawer discard state", () => {
    const setPage = vi.fn();
    const { result } = renderHook(() =>
      useCephAdminListingFilters({ endpointId: 1, defaultAdvancedFilter, serializeAdvancedFilter, setPage })
    );

    act(() => {
      result.current.toggleQuickFilterMode();
    });
    expect(result.current.quickFilterState.modeForDisplay).toBe("exact");

    act(() => {
      result.current.setShowAdvancedFilter(true);
      result.current.updateAdvancedField("name", "Alice");
    });
    expect(result.current.hasPendingAdvancedChanges).toBe(true);
    expect(result.current.hasAnyAdvancedToClear).toBe(true);

    act(() => {
      result.current.advancedFilterCloseGuard.requestClose();
    });
    expect(result.current.showAdvancedFilter).toBe(true);
    expect(result.current.advancedFilterCloseGuard.confirmationDialog).not.toBeNull();

    act(() => {
      result.current.advancedFilterCloseGuard.closeWithoutConfirmation();
    });
    expect(result.current.showAdvancedFilter).toBe(false);
    expect(result.current.advancedDraft).toEqual(defaultAdvancedFilter);
  });

  it("resets quick and advanced filters when the endpoint changes", () => {
    const setPage = vi.fn();
    const { result, rerender } = renderHook(
      ({ endpointId }) =>
        useCephAdminListingFilters({ endpointId, defaultAdvancedFilter, serializeAdvancedFilter, setPage }),
      { initialProps: { endpointId: 1 } }
    );

    act(() => {
      result.current.setFilter("alice");
      result.current.toggleQuickFilterMode();
      result.current.setShowAdvancedFilter(true);
      result.current.updateAdvancedField("name", "Alice");
      result.current.applyAdvancedFilter();
      result.current.setShowAdvancedFilter(true);
    });

    rerender({ endpointId: 2 });

    expect(result.current.filter).toBe("");
    expect(result.current.searchValue).toBe("");
    expect(result.current.quickFilterState.modeForDisplay).toBe("contains");
    expect(result.current.showAdvancedFilter).toBe(false);
    expect(result.current.advancedDraft).toEqual(defaultAdvancedFilter);
    expect(result.current.advancedApplied).toBeNull();
  });
});
