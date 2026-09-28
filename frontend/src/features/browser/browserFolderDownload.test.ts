import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  memoryEntries: [] as string[],
  streamEntries: [] as string[],
  triggerBlobDownload: vi.fn(),
}));

vi.mock("jszip", () => ({
  default: class MockJsZip {
    file(name: string) {
      mocks.memoryEntries.push(name);
    }

    async generateAsync(
      _options: { type: "blob" },
      onUpdate: (metadata: { percent: number }) => void,
    ) {
      onUpdate({ percent: 50 });
      return new Blob(["archive"]);
    }
  },
}));

vi.mock("@zip.js/zip.js", () => ({
  ZipWriter: class MockZipWriter {
    async add(name: string, stream: ReadableStream<Uint8Array>) {
      mocks.streamEntries.push(name);
      const reader = stream.getReader();
      while (!(await reader.read()).done) {
        // Consume the stream so transfer progress passes through the counter.
      }
    }

    async close() {
      return undefined;
    }
  },
}));

vi.mock("../../utils/download", () => ({
  triggerBlobDownload: mocks.triggerBlobDownload,
}));

import {
  buildBrowserFolderDownloadPlan,
  downloadBrowserFolderArchive,
  resolveBrowserFolderArchiveLabel,
} from "./browserFolderDownload";

beforeEach(() => {
  mocks.memoryEntries.length = 0;
  mocks.streamEntries.length = 0;
  mocks.triggerBlobDownload.mockReset();
});

describe("browser folder downloads", () => {
  it("keeps safe relative paths and excludes keys outside the starting location", () => {
    let id = 0;
    const plan = buildBrowserFolderDownloadPlan(
      [
        { key: "reports/", size: 0 },
        { key: "reports/a.txt", size: 3 },
        { key: "outside.txt", size: 4 },
      ],
      "reports/",
      () => `detail-${++id}`,
    );

    expect(resolveBrowserFolderArchiveLabel("reports/2026", "reports/")).toBe(
      "reports-2026",
    );
    expect(plan).toEqual({
      targets: [
        {
          detailId: "detail-1",
          key: "reports/a.txt",
          relativeKey: "a.txt",
          sizeBytes: 3,
        },
      ],
      totalBytes: 3,
      excluded: [{ key: "outside.txt", reason: "Unsafe or ambiguous archive path" }],
    });
  });

  it("builds small archives in memory with bounded parallel downloads", async () => {
    const details: string[] = [];
    const phases: string[] = [];
    const progress: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await downloadBrowserFolderArchive({
      controller: new AbortController(),
      downloadBlob: async (key) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return new Blob([key]);
      },
      downloadStream: async () => new ReadableStream<Uint8Array>(),
      folderLabel: "reports",
      onDetailChange: (id, status) => details.push(`${id}:${status}`),
      onPhaseChange: (phase) => phases.push(phase),
      onProgress: (percent) => progress.push(percent),
      parallelism: 2,
      streamingThresholdBytes: 100,
      targets: [
        { detailId: "a", key: "reports/a.txt", relativeKey: "a.txt", sizeBytes: 3 },
        { detailId: "b", key: "reports/b.txt", relativeKey: "b.txt", sizeBytes: 3 },
      ],
      totalBytes: 6,
    });

    expect(result).toEqual({ cancelled: false, failedKeys: [] });
    expect(maxInFlight).toBe(2);
    expect(mocks.memoryEntries).toEqual(["reports/a.txt", "reports/b.txt"]);
    expect(mocks.triggerBlobDownload).toHaveBeenCalledWith(
      "reports.zip",
      expect.any(Blob),
    );
    expect(details).toEqual([
      "a:downloading",
      "b:downloading",
      "a:done",
      "b:done",
    ]);
    expect(phases).toEqual(["Packaging zip"]);
    expect(progress.at(-1)).toBe(100);
  });

  it("streams large archives through the file picker", async () => {
    const phases: string[] = [];
    const progress: number[] = [];
    const result = await downloadBrowserFolderArchive({
      controller: new AbortController(),
      downloadBlob: async () => new Blob(),
      downloadStream: async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          },
        }),
      folderLabel: "reports",
      onDetailChange: () => undefined,
      onPhaseChange: (phase) => phases.push(phase),
      onProgress: (percent) => progress.push(percent),
      parallelism: 2,
      saveFilePicker: async () => ({
        createWritable: async () => new WritableStream<Uint8Array>(),
      }),
      streamingThresholdBytes: 0,
      targets: [
        { detailId: "a", key: "reports/a.txt", relativeKey: "a.txt", sizeBytes: 3 },
      ],
      totalBytes: 3,
    });

    expect(result).toEqual({ cancelled: false, failedKeys: [] });
    expect(mocks.streamEntries).toEqual(["reports/a.txt"]);
    expect(mocks.triggerBlobDownload).not.toHaveBeenCalled();
    expect(phases).toEqual(["Streaming zip"]);
    expect(progress).toContain(80);
    expect(progress.at(-1)).toBe(100);
  });

  it("reports file picker cancellation without starting downloads", async () => {
    const downloadStream = vi.fn(async () => new ReadableStream<Uint8Array>());

    const result = await downloadBrowserFolderArchive({
      controller: new AbortController(),
      downloadBlob: async () => new Blob(),
      downloadStream,
      folderLabel: "reports",
      onDetailChange: () => undefined,
      onPhaseChange: () => undefined,
      onProgress: () => undefined,
      parallelism: 2,
      saveFilePicker: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
      streamingThresholdBytes: 0,
      targets: [
        { detailId: "a", key: "reports/a.txt", relativeKey: "a.txt", sizeBytes: 3 },
      ],
      totalBytes: 3,
    });

    expect(result).toEqual({ cancelled: true, failedKeys: [] });
    expect(downloadStream).not.toHaveBeenCalled();
  });
});


it("rejects traversal, normalization collisions and file/directory collisions", () => {
  const keys = ["a.txt", "a.txt", "A.txt", "../secret", "/absolute", "C:stream", "x\\y", "dir//file", "é.txt", "e\u0301.txt", "folder", "folder/file"];
  const plan = buildBrowserFolderDownloadPlan(keys.map(key => ({ key, size: 1 })), "", () => "id");
  expect(plan.targets.map(target => target.key)).toEqual(["a.txt", "é.txt", "folder"]);
  expect(plan.excluded).toHaveLength(8);
});

it("blocks oversized memory archives before any download", async () => {
  const downloadBlob = vi.fn();
  await expect(downloadBrowserFolderArchive({ controller: new AbortController(), downloadBlob, downloadStream: vi.fn(), folderLabel: "large", onDetailChange: vi.fn(), onPhaseChange: vi.fn(), onProgress: vi.fn(), parallelism: 2, streamingThresholdBytes: 10, targets: [{ detailId: "a", key: "a", relativeKey: "a", sizeBytes: 11 }], totalBytes: 11 })).rejects.toThrow("in-memory limit");
  expect(downloadBlob).not.toHaveBeenCalled();
});
