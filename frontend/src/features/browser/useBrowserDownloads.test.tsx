import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browserContracts";
import type { BrowserItem } from "./browserTypes";
import { useBrowserDownloads } from "./useBrowserDownloads";

const archiveMocks = vi.hoisted(() => ({
  canStreamBrowserArchive: vi.fn(),
  chooseBrowserArchiveFile: vi.fn(),
  downloadBrowserFolderArchive: vi.fn(),
}));
const downloadMocks = vi.hoisted(() => ({
  downloadBrowserTransferBlob: vi.fn(),
  downloadBrowserTransferStream: vi.fn(),
  triggerBlobDownload: vi.fn(),
  triggerUrlDownload: vi.fn(),
}));

vi.mock("./browserFolderDownload", async () => ({
  ...(await vi.importActual<typeof import("./browserFolderDownload")>(
    "./browserFolderDownload",
  )),
  canStreamBrowserArchive: archiveMocks.canStreamBrowserArchive,
  chooseBrowserArchiveFile: archiveMocks.chooseBrowserArchiveFile,
  downloadBrowserFolderArchive: archiveMocks.downloadBrowserFolderArchive,
}));

vi.mock("./browserObjectTransferTransport", async () => ({
  ...(await vi.importActual<
    typeof import("./browserObjectTransferTransport")
  >("./browserObjectTransferTransport")),
  downloadBrowserTransferBlob: downloadMocks.downloadBrowserTransferBlob,
  downloadBrowserTransferStream: downloadMocks.downloadBrowserTransferStream,
}));

vi.mock("../../utils/download", () => ({
  triggerBlobDownload: downloadMocks.triggerBlobDownload,
  triggerUrlDownload: downloadMocks.triggerUrlDownload,
}));

function item(key: string, type: "file" | "folder" = "file"): BrowserItem {
  return {
    id: `${type}:${key}`,
    key,
    name: key.replace(/\/$/, "").split("/").at(-1) ?? key,
    type,
    size: "12 B",
    modified: "",
    owner: "",
    sizeBytes: 12,
    modifiedAt: null,
  };
}

function createOptions() {
  return {
    accountId: "acc-1",
    bucketName: "bucket-a",
    cancelDownloadDetails: vi.fn(),
    clearOperationController: vi.fn(),
    completeOperation: vi.fn(),
    createOperationController: vi.fn(() => new AbortController()),
    currentPath: "bucket-a/docs",
    enabled: true,
    listAllObjectsForPrefix: vi.fn().mockResolvedValue([]),
    onStatus: vi.fn(),
    onWarning: vi.fn(),
    parallelism: 2,
    presignDownload: vi.fn().mockResolvedValue({
      url: "https://download.example/report.txt",
      method: "GET",
      expires_in: 900,
    }),
    requestOptions: undefined,
    setDownloadDetails: vi.fn(),
    showOperations: vi.fn(),
    sseActive: false,
    sseCustomerKeyBase64: null,
    startOperation: vi.fn(() => "op-1"),
    streamingZipThresholdMb: 200,
    transferReporter: {
      start: vi.fn(() => "transfer-1"),
      complete: vi.fn(),
      fail: vi.fn(),
    },
    updateOperation: vi.fn(),
    useProxyTransfers: false,
  };
}

describe("useBrowserDownloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadMocks.downloadBrowserTransferBlob.mockResolvedValue(
      new Blob(["content"]),
    );
    downloadMocks.downloadBrowserTransferStream.mockResolvedValue(
      new ReadableStream(),
    );
    archiveMocks.downloadBrowserFolderArchive.mockResolvedValue({
      cancelled: false,
      failedKeys: [],
    });
    archiveMocks.canStreamBrowserArchive.mockReturnValue(true);
    archiveMocks.chooseBrowserArchiveFile.mockResolvedValue({
      createWritable: vi.fn(),
    });
  });

  it("hands large ordinary direct objects to the browser download manager", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(async () => {
      await result.current.downloadItems([{ ...item("docs/report.txt"), sizeBytes: 30 * 1024 * 1024 }]);
    });

    expect(options.presignDownload).toHaveBeenCalledWith("bucket-a", {
      key: "docs/report.txt",
      operation: "get_object",
      expires_in: 900,
      response_content_disposition: expect.stringMatching(
        /^attachment; filename="report\.txt";/,
      ),
    });
    expect(downloadMocks.triggerUrlDownload).toHaveBeenCalledWith(
      "report.txt",
      "https://download.example/report.txt",
    );
    expect(options.transferReporter.start).not.toHaveBeenCalled();
  });

  it("reports a failed download without retaining a retry callback", async () => {
    const options = createOptions();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    downloadMocks.downloadBrowserTransferBlob.mockRejectedValueOnce(new Error("Network unavailable"));
    const { result } = renderHook(() => useBrowserDownloads(options));
    await act(() => result.current.downloadItems([item("docs/report.txt")]));
    expect(options.completeOperation).toHaveBeenCalledWith("op-1", "failed", "Downloaded 0 of 1 files.");
    expect(options.updateOperation.mock.calls.some(call => "retry" in call[1])).toBe(false);
    expect(downloadMocks.downloadBrowserTransferBlob).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("downloads controlled objects as blobs and reports completion", async () => {
    const options = { ...createOptions(), useProxyTransfers: true };
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(async () => {
      await result.current.downloadItems([item("docs/report.txt")]);
    });

    expect(downloadMocks.downloadBrowserTransferBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: "acc-1",
        bucket: "bucket-a",
        key: "docs/report.txt",
        mode: "proxy",
      }),
    );
    expect(downloadMocks.triggerBlobDownload).toHaveBeenCalledWith(
      "report.txt",
      expect.any(Blob),
    );
    expect(options.transferReporter.complete).toHaveBeenCalledWith(
      "transfer-1",
      "report.txt",
    );
  });

  it("downloads the exact requested object version", async () => {
    const options = { ...createOptions(), useProxyTransfers: true };
    const requestedVersion: BrowserObjectVersion = {
      key: "docs/report.txt",
      version_id: "version-old",
      is_latest: false,
      is_delete_marker: false,
      last_modified: "2026-09-28T10:00:00Z",
      size: 7,
      etag: "etag-old",
      storage_class: "STANDARD",
    };
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(() => result.current.downloadVersion(requestedVersion));

    expect(downloadMocks.downloadBrowserTransferBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: "acc-1",
        bucket: "bucket-a",
        key: "docs/report.txt",
        versionId: "version-old",
        mode: "proxy",
      }),
    );
    expect(downloadMocks.triggerBlobDownload).toHaveBeenCalledWith(
      "report.txt",
      expect.any(Blob),
    );
    expect(options.onStatus).toHaveBeenCalledWith(
      "Downloaded version of report.txt",
    );
  });

  it("tracks concurrent multi-file downloads as one operation", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(async () => {
      await result.current.downloadItems([
        item("docs/a.txt"),
        item("docs/b.txt"),
      ]);
    });

    expect(downloadMocks.downloadBrowserTransferBlob).toHaveBeenCalledTimes(2);
    expect(options.showOperations).toHaveBeenCalledOnce();
    expect(options.setDownloadDetails).toHaveBeenCalled();
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "done",
      undefined,
    );
    expect(options.onStatus).toHaveBeenCalledWith("Downloaded 2 files");
  });

  it("builds and executes a folder archive plan", async () => {
    const options = createOptions();
    options.listAllObjectsForPrefix.mockResolvedValue([
      { key: "docs/archive/a.txt", size: 12 },
    ]);
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(async () => {
      await result.current.downloadFolder(item("docs/archive/", "folder"));
    });

    expect(options.listAllObjectsForPrefix).toHaveBeenCalledWith(
      "docs/archive/", undefined, undefined, expect.any(AbortSignal),
    );
    expect(archiveMocks.downloadBrowserFolderArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        folderLabel: "archive",
        memoryLimitBytes: 200 * 1024 * 1024,
        output: { kind: "memory" },
        parallelism: 2,
        totalBytes: 12,
      }),
    );
    expect(options.onStatus).toHaveBeenCalledWith("Downloaded archive");
    expect(options.clearOperationController).toHaveBeenCalledWith("op-1");
  });
  it("deduplicates a mixed selection and reports failures in the operation", async () => {
    const options = createOptions();
    options.listAllObjectsForPrefix.mockResolvedValue([{ key: "docs/archive/a.txt", size: 12 }, { key: "docs/archive/b.txt", size: 12 }]);
    archiveMocks.downloadBrowserFolderArchive.mockResolvedValueOnce({ cancelled: false, failedKeys: ["docs/archive/b.txt"] }).mockResolvedValueOnce({ cancelled: false, failedKeys: [] });
    const { result } = renderHook(() => useBrowserDownloads(options));
    await act(() => result.current.downloadArchive([item("docs/archive/", "folder"), item("docs/archive/a.txt"), item("docs/top.txt")], "docs/"));
    expect(archiveMocks.downloadBrowserFolderArchive.mock.calls[0][0].targets.map((target: { relativeKey: string }) => target.relativeKey)).toEqual(["top.txt", "archive/a.txt", "archive/b.txt"]);
    expect(archiveMocks.downloadBrowserFolderArchive.mock.calls[0][0].includeRootFolder).toBe(false);
    expect(options.completeOperation).toHaveBeenCalledWith("op-1", "failed", expect.stringContaining("1 failed file(s)"));
    expect(archiveMocks.downloadBrowserFolderArchive).toHaveBeenCalledTimes(1);
    expect(options.listAllObjectsForPrefix).toHaveBeenCalledTimes(1);
  });

  it("inventories a large archive before asking for a destination", async () => {
    const options = { ...createOptions(), streamingZipThresholdMb: 0 };
    options.listAllObjectsForPrefix.mockResolvedValue([
      { key: "docs/archive/a.txt", size: 12 },
    ]);
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(() =>
      result.current.downloadFolder(item("docs/archive/", "folder")),
    );

    expect(options.listAllObjectsForPrefix).toHaveBeenCalledOnce();
    expect(archiveMocks.chooseBrowserArchiveFile).not.toHaveBeenCalled();
    expect(archiveMocks.downloadBrowserFolderArchive).not.toHaveBeenCalled();
    expect(options.startOperation).not.toHaveBeenCalled();
    expect(result.current.archivePreparation).toMatchObject({
      phase: "ready",
      fileCount: 1,
      totalBytes: 12,
      excludedCount: 0,
      canDownload: true,
    });

    await act(() => result.current.savePreparedArchive());

    expect(archiveMocks.chooseBrowserArchiveFile).toHaveBeenCalledWith(
      "archive",
    );
    expect(archiveMocks.downloadBrowserFolderArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        output: {
          kind: "stream",
          fileHandle: expect.any(Object),
        },
      }),
    );
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "done",
      undefined,
    );
    expect(result.current.archivePreparation).toBeNull();
  });

  it("keeps a prepared archive available when the picker is cancelled", async () => {
    const options = { ...createOptions(), streamingZipThresholdMb: 0 };
    options.listAllObjectsForPrefix.mockResolvedValue([
      { key: "docs/archive/a.txt", size: 12 },
    ]);
    archiveMocks.chooseBrowserArchiveFile.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useBrowserDownloads(options));
    await act(() =>
      result.current.downloadFolder(item("docs/archive/", "folder")),
    );

    await act(() => result.current.savePreparedArchive());

    expect(result.current.archivePreparation).toMatchObject({
      phase: "ready",
      error: expect.stringContaining("cancelled"),
    });
    expect(archiveMocks.downloadBrowserFolderArchive).not.toHaveBeenCalled();
    expect(options.startOperation).not.toHaveBeenCalled();
  });

  it("refuses a large archive before downloading when streaming is unavailable", async () => {
    const options = { ...createOptions(), streamingZipThresholdMb: 0 };
    options.listAllObjectsForPrefix.mockResolvedValue([
      { key: "docs/archive/a.txt", size: 12 },
    ]);
    archiveMocks.canStreamBrowserArchive.mockReturnValue(false);
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(() =>
      result.current.downloadFolder(item("docs/archive/", "folder")),
    );

    expect(result.current.archivePreparation).toMatchObject({
      phase: "ready",
      canDownload: false,
      error: expect.stringContaining("cannot save large ZIP archives"),
    });
    expect(archiveMocks.downloadBrowserFolderArchive).not.toHaveBeenCalled();
    expect(downloadMocks.downloadBrowserTransferStream).not.toHaveBeenCalled();
  });

  it("always terminates a failed archive operation without retaining a retry callback", async () => {
    const options = createOptions();
    options.listAllObjectsForPrefix.mockResolvedValue([
      { key: "docs/archive/a.txt", size: 12 },
    ]);
    archiveMocks.downloadBrowserFolderArchive.mockRejectedValueOnce(
      new Error("Archive finalization timed out"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(() =>
      result.current.downloadFolder(item("docs/archive/", "folder")),
    );

    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "failed",
      "Unable to download folder: Archive finalization timed out",
    );
    expect(
      options.updateOperation.mock.calls.some(
        (call) => typeof call[1]?.retry === "function",
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

});
