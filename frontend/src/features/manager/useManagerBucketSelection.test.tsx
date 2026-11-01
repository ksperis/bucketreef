import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../../api/executionContexts";
import { buildExecutionContext } from "../../test/executionContexts";
import { useManagerBucketSelection } from "./useManagerBucketSelection";

const listBucketOptionsMock = vi.fn();

const primaryContext = buildExecutionContext("context-1", {
  display_name: "Primary account",
  endpoint_name: "Primary endpoint",
  endpoint_is_default: true,
  endpoint_url: "https://primary.example.test",
}) satisfies ExecutionContext;

const secondaryContext = {
  ...primaryContext,
  id: "context-2",
  display_name: "Secondary account",
} satisfies ExecutionContext;

let accountContext = {
  contexts: [primaryContext, secondaryContext],
  selectedContextId: primaryContext.id as string | null,
  requiresContextSelection: true,
};

vi.mock("../../api/managerBuckets", () => ({
  listBucketOptions: (...args: unknown[]) => listBucketOptionsMock(...args),
}));

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => accountContext,
}));

describe("useManagerBucketSelection", () => {
  beforeEach(() => {
    listBucketOptionsMock.mockReset();
    accountContext = {
      contexts: [primaryContext, secondaryContext],
      selectedContextId: primaryContext.id,
      requiresContextSelection: true,
    };
  });

  it("loads, sorts, filters, and selects bucket targets for the active context", async () => {
    listBucketOptionsMock.mockImplementation(async (_contextId: string, query: { search?: string; page?: number; page_size?: number }) => {
      const allItems = [{ name: "alpha" }, { name: "zeta" }];
      const term = query.search?.trim().toLowerCase() ?? "";
      const items = allItems.filter((bucket) => !term || bucket.name.includes(term));
      return { items, total: items.length, page: query.page ?? 1, page_size: query.page_size ?? 25, has_next: false };
    });
    const { result } = renderHook(() => useManagerBucketSelection());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listBucketOptionsMock).toHaveBeenCalledWith(primaryContext.id, { page: 1, page_size: 25 });
    expect(result.current.filteredBuckets.map((bucket) => bucket.name)).toEqual(["alpha", "zeta"]);

    act(() => result.current.setFilter("ALP"));
    await waitFor(() => expect(listBucketOptionsMock).toHaveBeenLastCalledWith(
      primaryContext.id,
      { page: 1, page_size: 25, search: "ALP" },
    ));
    await waitFor(() => expect(result.current.filteredBuckets.map((bucket) => bucket.name)).toEqual(["alpha"]));

    act(() => result.current.selectAllFiltered());
    expect([...result.current.selectedBuckets]).toEqual(["alpha"]);
    expect(result.current.selectedBucketList).toEqual(["alpha"]);
    expect(result.current.selectedTargets).toEqual([
      {
        bucketName: "alpha",
        contextId: primaryContext.id,
        contextName: primaryContext.display_name,
      },
    ]);

    act(() => result.current.clearSelection());
    expect(result.current.selectedBuckets.size).toBe(0);
  });

  it("clears selections when the execution context changes", async () => {
    listBucketOptionsMock
      .mockResolvedValueOnce({ items: [{ name: "alpha" }, { name: "shared" }], total: 2, page: 1, page_size: 25, has_next: false })
      .mockResolvedValueOnce({ items: [{ name: "shared" }, { name: "zeta" }], total: 2, page: 1, page_size: 25, has_next: false });
    const { result, rerender } = renderHook(() => useManagerBucketSelection());

    await waitFor(() => expect(result.current.filteredBuckets).toHaveLength(2));
    act(() => {
      result.current.toggleBucket("alpha");
      result.current.toggleBucket("shared");
    });

    accountContext = {
      ...accountContext,
      selectedContextId: secondaryContext.id,
    };
    rerender();

    await waitFor(() => expect(listBucketOptionsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.selectedBuckets.size).toBe(0));
    expect(result.current.selectedTargets).toEqual([]);
  });

  it("clears buckets and reports the canonical load error", async () => {
    listBucketOptionsMock.mockRejectedValue(new Error("network failure"));
    const { result, rerender } = renderHook(() => useManagerBucketSelection());

    await waitFor(() => expect(result.current.error).toBe("network failure"));
    expect(result.current.filteredBuckets).toEqual([]);

    accountContext = {
      ...accountContext,
      selectedContextId: null,
    };
    rerender();
    expect(result.current.filteredBuckets).toEqual([]);
    expect(result.current.selectedBuckets.size).toBe(0);
  });
});
