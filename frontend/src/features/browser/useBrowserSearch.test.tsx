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

  it("drops query-only options when the query is cleared", () => {
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

    expect(result.current.searchScope).toBe("prefix");
    expect(result.current.searchRecursive).toBe(false);
    expect(result.current.searchExactMatch).toBe(false);
    expect(result.current.searchCaseSensitive).toBe(false);
    expect(result.current.typeFilter).toBe("folder");
    expect(result.current.hasActiveSearchFilters).toBe(true);
  });

  it("enforces the Portal search contract and closes its options", () => {
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
      result.current.toggleSearchOptionsMenu();
    });

    rerender({ isPortalProfile: true, scopeKey: "bucket-a:root" });

    expect(result.current.searchScope).toBe("prefix");
    expect(result.current.searchRecursive).toBe(false);
    expect(result.current.searchExactMatch).toBe(false);
    expect(result.current.searchCaseSensitive).toBe(false);
    expect(result.current.typeFilter).toBe("all");
    expect(result.current.storageFilter).toBe("all");
    expect(result.current.showSearchOptionsMenu).toBe(false);
  });

  it("closes the options menu when the browsing scope changes", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useBrowserSearch({ isPortalProfile: false, scopeKey }),
      { initialProps: { scopeKey: "bucket-a:root" } },
    );

    act(() => result.current.toggleSearchOptionsMenu());
    rerender({ scopeKey: "bucket-a:archive" });

    expect(result.current.showSearchOptionsMenu).toBe(false);
  });

  it("owns dismissing search options and restores focus on Escape", () => {
    const { result } = renderHook(() =>
      useBrowserSearch({
        isPortalProfile: false,
        scopeKey: "bucket-a:root",
      }),
    );
    const root = document.createElement("div");
    const button = document.createElement("button");
    const menu = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(root, button, menu, outside);
    result.current.searchControlRef.current = root;
    result.current.searchOptionsButtonRef.current = button;
    result.current.searchOptionsMenuRef.current = menu;

    act(() => result.current.toggleSearchOptionsMenu());
    outside.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(result.current.showSearchOptionsMenu).toBe(false);
    expect(document.activeElement).toBe(button);
    root.remove();
    button.remove();
    menu.remove();
    outside.remove();
  });
});
