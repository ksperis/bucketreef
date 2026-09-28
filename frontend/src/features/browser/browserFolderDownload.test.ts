import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  memoryEntries: [] as string[],
  streamEntries: [] as string[],
  triggerBlobDownload: vi.fn(),
  zipClose: vi.fn(),
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

    async close(comment?: Uint8Array, options?: { preventClose?: boolean }) {
      return mocks.zipClose(comment, options);
    }
  },
}));

vi.mock("../../utils/download", () => ({
  triggerBlobDownload: mocks.triggerBlobDownload,
}));

import {
  buildBrowserFolderDownloadPlan,
  chooseBrowserArchiveFile,
  downloadBrowserFolderArchive,
  resolveBrowserFolderArchiveLabel,
} from "./browserFolderDownload";

beforeEach(() => {
  mocks.memoryEntries.length = 0;
  mocks.streamEntries.length = 0;
  mocks.triggerBlobDownload.mockReset();
  mocks.zipClose.mockReset();
  mocks.zipClose.mockResolvedValue(undefined);
});

function createFileStream() {
  const stream = new WritableStream<Uint8Array>();
  const close = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  Object.defineProperties(stream, {
    close: { value: close },
    abort: { value: abort },
  });
  return { stream, close, abort };
}

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
      output: { kind: "memory" },
      parallelism: 2,
      memoryLimitBytes: 100,
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

  it("does not download an empty in-memory archive when every object fails", async () => {
    const phases: string[] = [];
    const result = await downloadBrowserFolderArchive({
      controller: new AbortController(),
      downloadBlob: async () => {
        throw new Error("Network unavailable");
      },
      downloadStream: async () => new ReadableStream<Uint8Array>(),
      folderLabel: "selection",
      onDetailChange: vi.fn(),
      onPhaseChange: (phase) => phases.push(phase),
      onProgress: vi.fn(),
      output: { kind: "memory" },
      parallelism: 2,
      memoryLimitBytes: 100,
      targets: [
        { detailId: "a", key: "a.txt", relativeKey: "a.txt", sizeBytes: 3 },
        { detailId: "b", key: "b.txt", relativeKey: "b.txt", sizeBytes: 3 },
      ],
      totalBytes: 6,
    });

    expect(result).toEqual({
      cancelled: false,
      failedKeys: ["a.txt", "b.txt"],
    });
    expect(phases).toEqual([]);
    expect(mocks.memoryEntries).toEqual([]);
    expect(mocks.triggerBlobDownload).not.toHaveBeenCalled();
  });

  it("streams large archives through the file picker", async () => {
    const phases: string[] = [];
    const progress: number[] = [];
    const file = createFileStream();
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
      output: {
        kind: "stream",
        fileHandle: { createWritable: async () => file.stream as never },
      },
      memoryLimitBytes: 0,
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
    expect(mocks.zipClose).toHaveBeenCalledWith(undefined, {
      preventClose: true,
    });
    expect(file.close).toHaveBeenCalledOnce();
    expect(file.abort).not.toHaveBeenCalled();
  });

  it("aborts an empty streaming archive when every object fails", async () => {
    const file = createFileStream();
    const result = await downloadBrowserFolderArchive({
      controller: new AbortController(),
      downloadBlob: async () => new Blob(),
      downloadStream: async () => {
        throw new Error("Network unavailable");
      },
      folderLabel: "selection",
      onDetailChange: vi.fn(),
      onPhaseChange: vi.fn(),
      onProgress: vi.fn(),
      parallelism: 1,
      output: {
        kind: "stream",
        fileHandle: { createWritable: async () => file.stream as never },
      },
      memoryLimitBytes: 0,
      targets: [
        { detailId: "a", key: "a.txt", relativeKey: "a.txt", sizeBytes: 3 },
      ],
      totalBytes: 3,
    });

    expect(result).toEqual({ cancelled: false, failedKeys: ["a.txt"] });
    expect(mocks.zipClose).not.toHaveBeenCalled();
    expect(file.close).not.toHaveBeenCalled();
    expect(file.abort).toHaveBeenCalledOnce();
  });

  it("reports file picker cancellation without creating an output", async () => {
    const picker = vi.fn(async () => {
        throw new DOMException("Cancelled", "AbortError");
    });
    await expect(chooseBrowserArchiveFile("reports", picker)).resolves.toBeNull();
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "reports.zip" }),
    );
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
  await expect(downloadBrowserFolderArchive({ controller: new AbortController(), downloadBlob, downloadStream: vi.fn(), folderLabel: "large", onDetailChange: vi.fn(), onPhaseChange: vi.fn(), onProgress: vi.fn(), output: { kind: "memory" }, parallelism: 2, memoryLimitBytes: 10, targets: [{ detailId: "a", key: "a", relativeKey: "a", sizeBytes: 11 }], totalBytes: 11 })).rejects.toThrow("in-memory limit");
  expect(downloadBlob).not.toHaveBeenCalled();
});

it("aborts a partial file when streaming finalization times out", async () => {
  const file = createFileStream();
  file.close.mockReturnValue(new Promise(() => undefined));
  await expect(
    downloadBrowserFolderArchive({
      controller: new AbortController(),
      downloadBlob: vi.fn(),
      downloadStream: async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }),
      folderLabel: "large",
      onDetailChange: vi.fn(),
      onPhaseChange: vi.fn(),
      onProgress: vi.fn(),
      output: {
        kind: "stream",
        fileHandle: { createWritable: async () => file.stream as never },
      },
      parallelism: 1,
      memoryLimitBytes: 0,
      finalizationTimeoutMs: 5,
      targets: [
        { detailId: "a", key: "a", relativeKey: "a", sizeBytes: 1 },
      ],
      totalBytes: 1,
    }),
  ).rejects.toThrow("could not be finalized");
  expect(file.abort).toHaveBeenCalled();
  expect(file.close).toHaveBeenCalledOnce();
});

it("aborts the partial stream when the operation is cancelled", async () => {
  const file = createFileStream();
  const controller = new AbortController();
  controller.abort("cancel");
  await expect(
    downloadBrowserFolderArchive({
      controller,
      downloadBlob: vi.fn(),
      downloadStream: vi.fn(),
      folderLabel: "large",
      onDetailChange: vi.fn(),
      onPhaseChange: vi.fn(),
      onProgress: vi.fn(),
      output: {
        kind: "stream",
        fileHandle: { createWritable: async () => file.stream as never },
      },
      parallelism: 1,
      memoryLimitBytes: 0,
      targets: [
        { detailId: "a", key: "a", relativeKey: "a", sizeBytes: 1 },
      ],
      totalBytes: 1,
    }),
  ).resolves.toEqual({ cancelled: true, failedKeys: [] });
  expect(file.abort).toHaveBeenCalled();
  expect(file.close).not.toHaveBeenCalled();
});
