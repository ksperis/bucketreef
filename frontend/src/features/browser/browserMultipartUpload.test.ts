import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  uploadBrowserFileMultipart,
  uploadBrowserStreamMultipart,
  type BrowserMultipartUploadLifecycle,
} from "./browserMultipartUpload";

const fetchMock = vi.fn();

const createLifecycle = (): BrowserMultipartUploadLifecycle => ({
  initiate: vi.fn().mockResolvedValue("upload-1"),
  presignPart: vi
    .fn()
    .mockImplementation(async (_uploadId: string, partNumber: number) => ({
      url: `https://upload.test/part-${partNumber}`,
      headers: { "X-Part": String(partNumber) },
    })),
  complete: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
});

describe("browser multipart uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uploads file parts with bounded orchestration and completes them in order", async () => {
    const lifecycle = createLifecycle();
    const uploadedSizes: number[] = [];
    const progress: number[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const blob = init?.body as Blob;
      uploadedSizes.push(blob.size);
      const partNumber = Number(String(input).split("-").at(-1));
      return new Response(null, {
        status: 200,
        headers: { ETag: `"etag-${partNumber}"` },
      });
    });

    await uploadBrowserFileMultipart({
      file: new File([new Uint8Array(20)], "large.bin"),
      partSize: 8,
      concurrency: 2,
      controller: new AbortController(),
      lifecycle,
      onProgress: (percent) => progress.push(percent),
    });

    expect(uploadedSizes).toEqual([8, 8, 4]);
    expect(lifecycle.presignPart).toHaveBeenCalledTimes(3);
    expect(lifecycle.complete).toHaveBeenCalledWith("upload-1", [
      { part_number: 1, etag: "etag-1" },
      { part_number: 2, etag: "etag-2" },
      { part_number: 3, etag: "etag-3" },
    ]);
    expect(progress).toContain(95);
    expect(progress.at(-1)).toBe(100);
    expect(lifecycle.abort).not.toHaveBeenCalled();
  });

  it("aborts the remote upload when a part response has no ETag", async () => {
    const lifecycle = createLifecycle();
    const controller = new AbortController();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      uploadBrowserFileMultipart({
        file: new File([new Uint8Array(8)], "broken.bin"),
        partSize: 8,
        concurrency: 1,
        controller,
        lifecycle,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow("Missing ETag from multipart upload.");

    expect(controller.signal.aborted).toBe(false); // Transfer failures are not user cancellations.
    expect(lifecycle.abort).toHaveBeenCalledWith("upload-1");
    expect(lifecycle.complete).not.toHaveBeenCalled();
  });

  it("surfaces S3 error details when a file part is rejected", async () => {
    const lifecycle = createLifecycle();
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      new Response(
        "<Error><Code>QuotaExceeded</Code><Message></Message></Error>",
        { status: 403, statusText: "Forbidden" },
      ),
    );

    await expect(
      uploadBrowserFileMultipart({
        file: new File([new Uint8Array(8)], "too-large.bin"),
        partSize: 8,
        concurrency: 1,
        controller,
        lifecycle,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow(
      "Multipart upload failed: HTTP 403 Forbidden - QuotaExceeded",
    );

    expect(controller.signal.aborted).toBe(false);
    expect(lifecycle.abort).toHaveBeenCalledWith("upload-1");
    expect(lifecycle.complete).not.toHaveBeenCalled();
  });

  it("reassembles stream chunks into fixed-size multipart uploads", async () => {
    const lifecycle = createLifecycle();
    const uploadedSizes: number[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const blob = init?.body as Blob;
      uploadedSizes.push(blob.size);
      const partNumber = Number(String(input).split("-").at(-1));
      return new Response(null, {
        status: 200,
        headers: { etag: `etag-${partNumber}` },
      });
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6, 7, 8, 9, 10]));
        controller.close();
      },
    });

    await uploadBrowserStreamMultipart({
      stream,
      sizeBytes: 10,
      contentType: "application/octet-stream",
      partSize: 4,
      lifecycle,
    });

    expect(uploadedSizes).toEqual([4, 4, 2]);
    expect(lifecycle.complete).toHaveBeenCalledWith("upload-1", [
      { part_number: 1, etag: "etag-1" },
      { part_number: 2, etag: "etag-2" },
      { part_number: 3, etag: "etag-3" },
    ]);
    expect(lifecycle.abort).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  });

  it.each(["pause", "cancel"])("%s keeps or aborts a resumable multipart upload", async reason => {
    const lifecycle = createLifecycle();
    const controller = new AbortController();
    lifecycle.uploadPart = vi.fn(async () => { controller.abort(reason); throw new DOMException("Stopped", "AbortError"); });
    await expect(uploadBrowserFileMultipart({ file: new File(["abcdefgh"], "file"), partSize: 4, concurrency: 1, controller, lifecycle, onProgress: vi.fn(),
      resume: { uploadId: "saved", keepOnError: true, onInitiated: vi.fn(), onPart: vi.fn() },
    })).rejects.toThrow("Stopped");
    expect(lifecycle.initiate).not.toHaveBeenCalled();
    expect(lifecycle.complete).not.toHaveBeenCalled();
    if (reason === "pause") expect(lifecycle.abort).not.toHaveBeenCalled();
    else expect(lifecycle.abort).toHaveBeenCalledWith("saved");
  });

  it("resends only missing parts via the proxy and awaits receipts before completion", async () => {
    const lifecycle = createLifecycle();
    lifecycle.uploadPart = vi.fn(async (_id, number, blob) => { expect(blob.size).toBe(4); return `part-${number}`; });
    const onPart = vi.fn();
    await uploadBrowserFileMultipart({ file: new File(["abcdefgh"], "file"), partSize: 4, concurrency: 2, controller: new AbortController(), lifecycle, onProgress: vi.fn(),
      resume: { uploadId: "saved", parts: [{ part_number: 1, etag: "part-1" }], keepOnError: true, onInitiated: vi.fn(), onPart },
    });
    expect(lifecycle.uploadPart).toHaveBeenCalledTimes(1);
    expect(onPart).toHaveBeenCalledWith({ part_number: 2, etag: "part-2", size: 4 });
    expect(lifecycle.complete).toHaveBeenCalledWith("saved", [{ part_number: 1, etag: "part-1" }, { part_number: 2, etag: "part-2" }]);
    expect(lifecycle.presignPart).not.toHaveBeenCalled();
  });

  it("does not complete or discard parts after a retained failure", async () => {
    const lifecycle = createLifecycle();
    lifecycle.uploadPart = vi.fn().mockRejectedValue(new Error("session expired"));
    await expect(uploadBrowserFileMultipart({ file: new File(["abcdefgh"], "file"), partSize: 4, concurrency: 2, controller: new AbortController(), lifecycle, onProgress: vi.fn(),
      resume: { uploadId: "saved", keepOnError: true, onInitiated: vi.fn(), onPart: vi.fn() },
    })).rejects.toThrow("session expired");
    expect(lifecycle.complete).not.toHaveBeenCalled(); expect(lifecycle.abort).not.toHaveBeenCalled();
  });

  it("surfaces S3 error details when a stream part is rejected", async () => {
    const lifecycle = createLifecycle();
    fetchMock.mockResolvedValue(
      new Response(
        "<Error><Code>QuotaExceeded</Code><Message></Message></Error>",
        { status: 403, statusText: "Forbidden" },
      ),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    });

    await expect(
      uploadBrowserStreamMultipart({
        stream,
        sizeBytes: 4,
        partSize: 4,
        lifecycle,
      }),
    ).rejects.toThrow(
      "Multipart upload failed: HTTP 403 Forbidden - QuotaExceeded",
    );

    expect(lifecycle.abort).toHaveBeenCalledWith("upload-1");
    expect(lifecycle.complete).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  });
});
