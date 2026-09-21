import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMetadata, ObjectTags } from "../../api/browserContracts";
import type { BrowserItem } from "./browserTypes";
import { useBrowserObjectProperties } from "./useBrowserObjectProperties";

const apiMocks = vi.hoisted(() => ({
  fetchObjectMetadata: vi.fn(),
  getObjectTags: vi.fn(),
  updateObjectMetadata: vi.fn(),
  updateObjectTags: vi.fn(),
}));

vi.mock("../../api/browserObjects", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserObjects")>(
      "../../api/browserObjects",
    );
  return {
    ...actual,
    fetchObjectMetadata: (...args: unknown[]) =>
      apiMocks.fetchObjectMetadata(...args),
    getObjectTags: (...args: unknown[]) => apiMocks.getObjectTags(...args),
    updateObjectMetadata: (...args: unknown[]) =>
      apiMocks.updateObjectMetadata(...args),
    updateObjectTags: (...args: unknown[]) =>
      apiMocks.updateObjectTags(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function browserItem(key: string, storageClass = "STANDARD"): BrowserItem {
  return {
    id: key,
    key,
    name: key.split("/").at(-1) ?? key,
    type: "file",
    size: "12 B",
    modified: "2026-08-26 10:00",
    owner: "owner",
    storageClass,
  };
}

function metadata(key: string, versionId: string): ObjectMetadata {
  return {
    key,
    size: 12,
    content_type: "text/plain",
    cache_control: "max-age=60",
    storage_class: "STANDARD_IA",
    metadata: { project: "reef" },
    version_id: versionId,
  };
}

function tags(key: string, versionId: string): ObjectTags {
  return {
    key,
    tags: [{ key: "environment", value: "test" }],
    version_id: versionId,
  };
}

function renderProperties() {
  const item = browserItem("docs/report.txt");
  return renderHook(() => useBrowserObjectProperties({
    accountId: "acc-1", bucketName: "bucket-a", isDeleted: false, item,
    requestOptions: { workspaceSurface: "browser" },
  }));
}

describe("useBrowserObjectProperties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.fetchObjectMetadata.mockResolvedValue({
      ...metadata("docs/report.txt", "v2"),
      version_id: null,
    });
    apiMocks.getObjectTags.mockResolvedValue(tags("docs/report.txt", "v2"));
    apiMocks.updateObjectMetadata.mockResolvedValue(undefined);
    apiMocks.updateObjectTags.mockResolvedValue(undefined);
  });

  it("loads object properties and builds editable drafts", async () => {
    const item = browserItem("docs/report.txt");
    const { result } = renderHook(() =>
      useBrowserObjectProperties({
        accountId: "acc-1",
        bucketName: "bucket-a",
        isDeleted: false,
        item,
        sseCustomerKeyBase64: "customer-key",
      }),
    );

    await act(async () => {
      await result.current.load();
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      "docs/report.txt",
      null,
      "customer-key",
      undefined,
      undefined,
    );
    expect(result.current.loaded).toBe(true);
    expect(result.current.versionId).toBe("v2");
    expect(result.current.metadataDraft.contentType).toBe("text/plain");
    expect(result.current.metadataItems).toEqual([
      { id: "meta-1", key: "project", value: "reef" },
    ]);
    expect(result.current.tagsDraft).toEqual([
      { id: "tag-1", key: "environment", value: "test" },
    ]);
    expect(result.current.storageClass).toBe("STANDARD_IA");

    await act(async () => {
      await result.current.load();
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(1);
  });

  it("allows a forced reload after properties were loaded", async () => {
    const item = browserItem("docs/report.txt");
    const { result } = renderHook(() =>
      useBrowserObjectProperties({
        accountId: "acc-1",
        bucketName: "bucket-a",
        isDeleted: false,
        item,
      }),
    );
    await act(async () => {
      await result.current.load();
    });
    apiMocks.fetchObjectMetadata.mockResolvedValueOnce({
      ...metadata("docs/report.txt", "v3"),
      content_type: "application/json",
    });
    apiMocks.getObjectTags.mockResolvedValueOnce(tags("docs/report.txt", "v3"));

    await act(async () => {
      await result.current.load(true);
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(2);
    expect(result.current.versionId).toBe("v3");
    expect(result.current.metadataDraft.contentType).toBe("application/json");
  });

  it("saves metadata, tags, and storage class through the current version", async () => {
    const item = browserItem("docs/report.txt");
    const { result } = renderHook(() =>
      useBrowserObjectProperties({
        accountId: "acc-1",
        bucketName: "bucket-a",
        isDeleted: false,
        item,
      }),
    );
    await act(async () => {
      await result.current.load();
    });

    act(() => {
      result.current.updateMetadataDraft("contentType", "application/json");
      result.current.updateMetadataDraft("cacheControl", "no-store");
      const metadataItemId = result.current.metadataItems[0].id;
      result.current.updateMetadataItem(metadataItemId, "key", " owner ");
      result.current.updateMetadataItem(metadataItemId, "value", "platform");
    });
    await act(async () => {
      expect(await result.current.saveMetadata()).toBe(true);
    });
    expect(apiMocks.updateObjectMetadata).toHaveBeenNthCalledWith(
      1,
      "acc-1",
      "bucket-a",
      expect.objectContaining({
        key: "docs/report.txt",
        version_id: "v2",
        content_type: "application/json",
        cache_control: "no-store",
        metadata: { owner: "platform" },
      }),
      undefined,
      undefined,
    );

    act(() => {
      const tagId = result.current.tagsDraft[0].id;
      result.current.updateTag(tagId, "key", "team");
      result.current.updateTag(tagId, "value", "storage");
      result.current.addTag();
    });
    await act(async () => {
      expect(await result.current.saveTags()).toBe(true);
    });
    expect(apiMocks.updateObjectTags).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        key: "docs/report.txt",
        version_id: "v2",
        tags: [{ key: "team", value: "storage" }],
      },
      undefined,
      undefined,
    );

    act(() => result.current.setStorageClass("DEEP_ARCHIVE"));
    await act(async () => {
      expect(await result.current.saveStorageClass()).toBe("DEEP_ARCHIVE");
    });
    expect(apiMocks.updateObjectMetadata).toHaveBeenNthCalledWith(
      2,
      "acc-1",
      "bucket-a",
      {
        key: "docs/report.txt",
        version_id: "v2",
        storage_class: "DEEP_ARCHIVE",
      },
      undefined,
      undefined,
    );
    expect(result.current.savingMetadata).toBe(false);
    expect(result.current.savingTags).toBe(false);
    expect(result.current.savingStorageClass).toBe(false);
  });

  it("does not reload an object after its pending save becomes stale", async () => {
    const pendingUpdate = deferred<void>();
    const { result, rerender } = renderHook(
      ({ item }) =>
        useBrowserObjectProperties({
          accountId: "acc-1",
          bucketName: "bucket-a",
          isDeleted: false,
          item,
        }),
      { initialProps: { item: browserItem("docs/old.txt") } },
    );
    await act(async () => {
      await result.current.load();
    });
    apiMocks.updateObjectMetadata.mockReturnValueOnce(pendingUpdate.promise);

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = result.current.saveMetadata();
    });
    await waitFor(() => expect(result.current.savingMetadata).toBe(true));

    const currentItem = browserItem("docs/current.txt");
    rerender({ item: currentItem });
    act(() => result.current.reset(currentItem));
    await act(async () => {
      pendingUpdate.resolve(undefined);
      expect(await savePromise).toBe(false);
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(1);
    expect(result.current.savingMetadata).toBe(false);
  });

  it("ignores property responses from a previously selected object", async () => {
    const oldMetadata = deferred<ObjectMetadata>();
    const oldTags = deferred<ObjectTags>();
    apiMocks.fetchObjectMetadata
      .mockReturnValueOnce(oldMetadata.promise)
      .mockResolvedValueOnce(metadata("docs/current.txt", "current-v1"));
    apiMocks.getObjectTags
      .mockReturnValueOnce(oldTags.promise)
      .mockResolvedValueOnce(tags("docs/current.txt", "current-v1"));

    const { result, rerender } = renderHook(
      ({ item }) =>
        useBrowserObjectProperties({
          accountId: "acc-1",
          bucketName: "bucket-a",
          isDeleted: false,
          item,
        }),
      { initialProps: { item: browserItem("docs/old.txt") } },
    );
    act(() => {
      void result.current.load();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    const previousLoad = result.current.load;

    const currentItem = browserItem("docs/current.txt", "GLACIER");
    rerender({ item: currentItem });
    act(() => result.current.reset(currentItem));
    await act(async () => {
      await result.current.load();
      await previousLoad(true);
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(2);

    await act(async () => {
      oldMetadata.resolve(metadata("docs/old.txt", "old-v1"));
      oldTags.resolve(tags("docs/old.txt", "old-v1"));
      await Promise.all([oldMetadata.promise, oldTags.promise]);
    });
    expect(result.current.metadata?.key).toBe("docs/current.txt");
    expect(result.current.versionId).toBe("current-v1");
  });

  it.each([
    ["metadata", "saveMetadata"], ["tags", "saveTags"], ["storageClass", "saveStorageClass"],
  ] as const)("accepts only the saved %s section and retains the other drafts", async (section, save) => {
    const { result } = renderProperties();
    await act(async () => { await result.current.load(); });
    act(() => {
      result.current.updateMetadataDraft("contentType", "application/json");
      result.current.updateMetadataItem(result.current.metadataItems[0].id, "value", " metadata draft ");
      result.current.updateTag(result.current.tagsDraft[0].id, "value", " tag draft ");
      result.current.setStorageClass("GLACIER");
    });
    const nextMetadata = metadata("docs/report.txt", "v3");
    if (section === "metadata") {
      nextMetadata.content_type = "application/json";
      nextMetadata.metadata = { project: " metadata draft " };
    }
    if (section === "storageClass") nextMetadata.storage_class = "GLACIER";
    apiMocks.fetchObjectMetadata.mockResolvedValueOnce(nextMetadata);
    apiMocks.getObjectTags.mockResolvedValueOnce({
      ...tags("docs/report.txt", "v3"),
      tags: [{ key: "environment", value: section === "tags" ? " tag draft " : "test" }],
    });
    await act(async () => { await result.current[save](); });
    expect(result.current.metadataDraft.contentType).toBe("application/json");
    expect(result.current.metadataItems[0].value).toBe(" metadata draft ");
    expect(result.current.tagsDraft[0].value).toBe(" tag draft ");
    expect(result.current.storageClass).toBe("GLACIER");
    expect(result.current.dirtySections).toEqual({
      metadata: section !== "metadata", tags: section !== "tags", storageClass: section !== "storageClass",
    });
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.versionId).toBe("v3");

    // A subsequent section uses the latest version without reusing stale context.
    if (section === "tags") {
      await act(async () => { await result.current.saveMetadata(); });
      expect(apiMocks.updateObjectMetadata).toHaveBeenCalledWith(
        "acc-1", "bucket-a", expect.objectContaining({ key: "docs/report.txt", version_id: "v3", content_type: "application/json" }),
        undefined, { workspaceSurface: "browser" },
      );
    }
  });

  it("refreshes clean sections while retaining edits made before and during a pending read", async () => {
    const { result } = renderProperties();
    await act(async () => { await result.current.load(); });
    act(() => result.current.updateMetadataDraft("cacheControl", "no-store"));
    const pendingRead = deferred<ObjectMetadata>();
    apiMocks.fetchObjectMetadata.mockReturnValueOnce(pendingRead.promise);
    let request!: ReturnType<typeof result.current.load>;
    act(() => { request = result.current.load(true); });
    act(() => result.current.updateTag(result.current.tagsDraft[0].id, "value", " keep spaces "));
    await act(async () => {
      pendingRead.resolve({ ...metadata("docs/report.txt", "v3"), storage_class: "GLACIER" });
      await request;
    });
    expect(result.current.metadataDraft.cacheControl).toBe("no-store");
    expect(result.current.tagsDraft[0].value).toBe(" keep spaces ");
    expect(result.current.storageClass).toBe("GLACIER");
    expect(result.current.dirtySections).toEqual({ metadata: true, tags: true, storageClass: false });
  });

  it("preserves a newer draft in the submitted section when a write returns late", async () => {
    const { result } = renderProperties();
    await act(async () => { await result.current.load(); });
    act(() => result.current.updateMetadataDraft("contentType", "application/json"));
    const pendingWrite = deferred<void>();
    apiMocks.updateObjectMetadata.mockReturnValueOnce(pendingWrite.promise);
    apiMocks.fetchObjectMetadata.mockResolvedValueOnce({ ...metadata("docs/report.txt", "v3"), content_type: "application/json" });
    let request!: Promise<boolean>;
    act(() => { request = result.current.saveMetadata(); });
    act(() => result.current.updateMetadataDraft("contentType", "text/csv"));
    await act(async () => { pendingWrite.resolve(); await request; });
    expect(result.current.metadataDraft.contentType).toBe("text/csv");
    expect(result.current.dirtySections.metadata).toBe(true);
  });

  it("retains failed writes and permits a deliberate retry", async () => {
    const { result } = renderProperties();
    await act(async () => { await result.current.load(); });
    act(() => result.current.updateTag(result.current.tagsDraft[0].id, "value", "changed"));
    apiMocks.updateObjectTags.mockRejectedValueOnce(new Error("Write denied"));
    await act(async () => { await expect(result.current.saveTags()).rejects.toThrow("Write denied"); });
    expect(result.current.tagsDraft[0].value).toBe("changed");
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.savingTags).toBe(false);
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.saveTags(); });
    expect(apiMocks.updateObjectTags).toHaveBeenCalledTimes(2);
  });

  it("keeps drafts guarded after a post-write read failure and retries only the read", async () => {
    const { result } = renderProperties();
    await act(async () => { await result.current.load(); });
    act(() => {
      result.current.updateMetadataDraft("contentType", "application/json");
      result.current.updateTag(result.current.tagsDraft[0].id, "value", "unsaved");
    });
    apiMocks.fetchObjectMetadata.mockRejectedValueOnce(new Error("Refresh unavailable"));
    await act(async () => { expect(await result.current.saveMetadata()).toBe(false); });
    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toBe("Refresh unavailable");
    expect(result.current.metadataDraft.contentType).toBe("application/json");
    expect(result.current.metadata).not.toBeNull();
    expect(result.current.hasUnsavedChanges).toBe(true);
    await act(async () => {
      expect(await result.current.saveTags()).toBe(false);
      await result.current.load();
    });
    expect(apiMocks.updateObjectTags).not.toHaveBeenCalled();
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(2);
    apiMocks.fetchObjectMetadata.mockResolvedValueOnce({ ...metadata("docs/report.txt", "v3"), content_type: "application/json" });
    await act(async () => { await result.current.load(true); });
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.dirtySections).toEqual({ metadata: false, tags: true, storageClass: false });
    expect(result.current.tagsDraft[0].value).toBe("unsaved");
    expect(apiMocks.updateObjectMetadata).toHaveBeenCalledTimes(1);
  });

  it("rejects concurrent section saves before React publishes their busy state", async () => {
    const { result } = renderProperties();
    await act(async () => { await result.current.load(); });
    const pendingWrite = deferred<void>();
    apiMocks.updateObjectTags.mockReturnValueOnce(pendingWrite.promise);
    let first!: Promise<boolean>;
    await act(async () => {
      first = result.current.saveTags();
      expect(await result.current.saveTags()).toBe(false);
      expect(await result.current.saveMetadata()).toBe(false);
      expect(await result.current.saveStorageClass()).toBeNull();
    });
    expect(apiMocks.updateObjectTags).toHaveBeenCalledTimes(1);
    expect(apiMocks.updateObjectMetadata).not.toHaveBeenCalled();
    await act(async () => { pendingWrite.resolve(); await first; });
    expect(result.current.savingTags).toBe(false);
  });

  it("preserves literal tag whitespace, including whitespace-only keys", async () => {
    const { result } = renderProperties();
    await act(async () => { await result.current.load(); });
    act(() => {
      result.current.updateTag(result.current.tagsDraft[0].id, "key", "   ");
      result.current.updateTag(result.current.tagsDraft[0].id, "value", " value ");
      result.current.addTag();
    });
    await act(async () => { await result.current.saveTags(); });
    expect(apiMocks.updateObjectTags).toHaveBeenCalledWith("acc-1", "bucket-a", {
      key: "docs/report.txt", version_id: "v2", tags: [{ key: "   ", value: " value " }],
    }, undefined, { workspaceSurface: "browser" });
  });

  it.each([
    ["", "Tag key is required when a value is provided."],
    ["environment", "Duplicate tag key: environment"],
  ])("rejects an invalid tag draft with key %j without losing it", async (key, error) => {
    const { result } = renderProperties();
    await act(async () => { await result.current.load(); });
    act(() => result.current.addTag());
    act(() => {
      const tag = result.current.tagsDraft[1];
      result.current.updateTag(tag.id, "key", key);
      result.current.updateTag(tag.id, "value", "keep me");
    });
    await act(async () => { await expect(result.current.saveTags()).rejects.toThrow(error); });
    expect(apiMocks.updateObjectTags).not.toHaveBeenCalled();
    expect(result.current.tagsDraft[1].value).toBe("keep me");
    expect(result.current.hasUnsavedChanges).toBe(true);
  });
});
