import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserFavoriteDefaultName, useBrowserFavorites } from "./useBrowserFavorites";
import type { BrowserFavorite, BrowserFavoriteInput } from "../../api/browserFavorites";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  buckets: vi.fn(),
  objects: vi.fn(),
}));

vi.mock("../../api/browserFavorites", () => ({
  listBrowserFavorites: mocks.list,
  saveBrowserFavorite: mocks.save,
  deleteBrowserFavorite: mocks.remove,
}));
vi.mock("../../api/browserBuckets", () => ({
  searchBrowserBuckets: mocks.buckets,
}));
vi.mock("../../api/browserObjects", () => ({
  listBrowserObjects: mocks.objects,
}));

const current: BrowserFavoriteInput = {
  name: "reports",
  surface: "browser",
  workspace: "browser",
  context: "101",
  bucket: "archive",
  prefix: "reports/",
};
const saved: BrowserFavorite = {
  ...current,
  id: "saved",
  revision: 1,
  created_at: "2026-09-29T00:00:00Z",
  updated_at: "2026-09-29T00:00:00Z",
};
const duplicate: BrowserFavorite = {
  ...saved,
  id: "duplicate",
  name: "Custom duplicate",
};

const options = (overrides: Partial<Parameters<typeof useBrowserFavorites>[0]> = {}) => ({
  accountUser: true,
  availableContexts: ["101"],
  current,
  enabled: true,
  onApply: vi.fn(),
  onStatus: vi.fn(),
  onWarning: vi.fn(),
  ...overrides,
});

describe("useBrowserFavorites", () => {
  it("derives a concise default name from the path or Storage Space", () => {
    expect(
      browserFavoriteDefaultName({
        bucketName: "technical-bucket",
        bucketLabel: "Research Data",
        prefix: "reports/2026/",
      }),
    ).toBe("2026");
    expect(
      browserFavoriteDefaultName({
        bucketName: "technical-bucket",
        bucketLabel: "Research Data",
        prefix: "",
      }),
    ).toBe("Research Data");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([]);
    mocks.save.mockResolvedValue(saved);
    mocks.remove.mockResolvedValue(undefined);
    mocks.buckets.mockResolvedValue({ items: [{ name: "archive" }] });
    mocks.objects.mockResolvedValue({ objects: [], prefixes: [] });
  });

  it("deduplicates exact locations and marks the current path as favorite", async () => {
    mocks.list.mockResolvedValue([saved, duplicate]);
    const { result } = renderHook(() => useBrowserFavorites(options()));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.favorites).toEqual([saved]);
    expect(result.current.isCurrentFavorite).toBe(true);
  });

  it("removes every duplicate for the current exact location with one toggle", async () => {
    mocks.list
      .mockResolvedValueOnce([saved, duplicate])
      .mockResolvedValueOnce([]);
    const onStatus = vi.fn();
    const { result } = renderHook(() =>
      useBrowserFavorites(options({ onStatus })),
    );

    await waitFor(() => expect(result.current.isCurrentFavorite).toBe(true));
    await act(async () => {
      await result.current.toggleCurrent();
    });

    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.remove).toHaveBeenCalledWith(saved);
    expect(mocks.remove).toHaveBeenCalledWith(duplicate);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.current.isCurrentFavorite).toBe(false);
    expect(onStatus).toHaveBeenCalledWith("Removed from favorites.");
  });

  it("adds the current exact location directly", async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([saved]);
    const { result } = renderHook(() => useBrowserFavorites(options()));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await result.current.toggleCurrent();
    });

    expect(mocks.save).toHaveBeenCalledWith(current);
    expect(result.current.isCurrentFavorite).toBe(true);
  });

  it("rechecks the saved storage identity before applying a favorite", async () => {
    mocks.list.mockResolvedValue([saved]);
    const onApply = vi.fn();
    const { result } = renderHook(() =>
      useBrowserFavorites(options({ onApply })),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let applied = false;
    await act(async () => {
      applied = await result.current.apply(saved);
    });

    expect(applied).toBe(true);
    expect(mocks.buckets).toHaveBeenCalledWith(
      "101",
      expect.objectContaining({
        workspaceSurface: "browser",
        exact: true,
        search: "archive",
      }),
    );
    expect(mocks.objects).toHaveBeenCalledWith(
      "101",
      "archive",
      expect.objectContaining({ prefix: "reports/", workspaceSurface: "browser" }),
    );
    expect(onApply).toHaveBeenCalledWith(saved);
  });

  it("keeps an unavailable favorite instead of changing its identity", async () => {
    mocks.list.mockResolvedValue([saved]);
    mocks.buckets.mockRejectedValue(new Error("Access revoked"));
    const onApply = vi.fn();
    const { result } = renderHook(() =>
      useBrowserFavorites(options({ onApply })),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let applied = true;
    await act(async () => {
      applied = await result.current.apply(saved);
    });

    expect(applied).toBe(false);
    expect(result.current.unavailable.saved).toBe("Access revoked");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("refreshes favorites when the window regains focus", async () => {
    renderHook(() => useBrowserFavorites(options()));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });
});
