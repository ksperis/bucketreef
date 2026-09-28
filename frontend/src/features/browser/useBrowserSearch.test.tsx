import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBrowserSearch } from "./useBrowserSearch";

describe("useBrowserSearch", () => {
  it("derives active whole-bucket search indicators from one state", () => {
    const { result } = renderHook(() =>
      useBrowserSearch({
        isPortalProfile: false,
        scopeKey: "bucket-a:root",
      }),
    );

    act(() => {
      result.current.setFilter("report");
      result.current.changeSearchScope("bucket");
      result.current.setSearchExactMatch(true);
      result.current.setSearchCaseSensitive(true);
      result.current.setTypeFilter("file");
      result.current.setStorageFilter("GLACIER");
    });

    expect(result.current.hasActiveSearchFilters).toBe(true);
    expect(result.current.isSearchingInWholeBucket).toBe(true);
    expect(result.current.activeSearchStatusChips).toEqual([
      { label: "Query", value: "report" },
      { label: "Scope", value: "Whole bucket" },
      { label: "Match", value: "Exact" },
      { label: "Case", value: "Sensitive" },
      { label: "Type", value: "file" },
      { label: "Storage", value: "GLACIER" },
    ]);
  });

  it("preserves scope and options for filters without a text query", () => {
    const { result } = renderHook(() =>
      useBrowserSearch({
        isPortalProfile: false,
        scopeKey: "bucket-a:root",
      }),
    );

    act(() => {
      result.current.setFilter("report");
      result.current.changeSearchScope("bucket");
      result.current.setSearchRecursive(true);
      result.current.setSearchExactMatch(true);
      result.current.setSearchCaseSensitive(true);
      result.current.setTypeFilter("folder");
    });
    act(() => result.current.setFilter(""));

    expect(result.current.searchScope).toBe("bucket");
    expect(result.current.searchRecursive).toBe(true);
    expect(result.current.searchExactMatch).toBe(true);
    expect(result.current.searchCaseSensitive).toBe(true);
    expect(result.current.typeFilter).toBe("folder");
    expect(result.current.hasActiveSearchFilters).toBe(true);
  });

  it("keeps supported filters in Portal and labels the authorized space", () => {
    const { result, rerender } = renderHook(
      ({ isPortalProfile, scopeKey }) =>
        useBrowserSearch({ isPortalProfile, scopeKey }),
      {
        initialProps: {
          isPortalProfile: false,
          scopeKey: "bucket-a:root",
        },
      },
    );

    act(() => {
      result.current.setFilter("report");
      result.current.changeSearchScope("bucket");
      result.current.setSearchRecursive(true);
      result.current.setSearchExactMatch(true);
      result.current.setSearchCaseSensitive(true);
      result.current.setTypeFilter("file");
      result.current.setStorageFilter("STANDARD_IA");
      result.current.setShowSearchOptionsMenu(true);
    });

    rerender({ isPortalProfile: true, scopeKey: "bucket-a:root" });

    expect(result.current.searchScope).toBe("bucket");
    expect(result.current.searchRecursive).toBe(true);
    expect(result.current.searchExactMatch).toBe(true);
    expect(result.current.searchCaseSensitive).toBe(true);
    expect(result.current.typeFilter).toBe("file");
    expect(result.current.storageFilter).toBe("STANDARD_IA");
    expect(result.current.activeSearchStatusChips).toContainEqual({ label: "Scope", value: "Whole space" });
  });

  it("closes the options menu when the browsing scope changes", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useBrowserSearch({ isPortalProfile: false, scopeKey }),
      { initialProps: { scopeKey: "bucket-a:root" } },
    );

    act(() => result.current.setShowSearchOptionsMenu(true));
    rerender({ scopeKey: "bucket-a:archive" });

    expect(result.current.showSearchOptionsMenu).toBe(false);
  });
});
