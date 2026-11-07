import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MultipartUploadItem } from "../../api/browserMultipart";
import { useBrowserMultipartUploads } from "./useBrowserMultipartUploads";

const apiMocks = vi.hoisted(() => ({
  abortMultipartUpload: vi.fn(),
  listMultipartUploads: vi.fn(),
}));

vi.mock("../../api/browserMultipart", () => ({
  abortMultipartUpload: (...args: unknown[]) =>
    apiMocks.abortMultipartUpload(...args),
  listMultipartUploads: (...args: unknown[]) =>
    apiMocks.listMultipartUploads(...args),
}));

type MultipartResponse = {
  uploads: MultipartUploadItem[];
  is_truncated: boolean;
  next_key: string | null;
  next_upload_id: string | null;
};

type Confirmation = Parameters<
  Parameters<typeof useBrowserMultipartUploads>[0]["requestConfirmation"]
>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function response(key: string, uploadId = `upload-${key}`): MultipartResponse {
  return {
    uploads: [
      {
        key,
        upload_id: uploadId,
        initiated: "2026-11-01T10:00:00Z",
        storage_class: "STANDARD",
        owner: "owner",
      },
    ],
    is_truncated: false,
    next_key: null,
    next_upload_id: null,
  };
}

describe("useBrowserMultipartUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.abortMultipartUpload.mockResolvedValue(undefined);
  });

  it("ignores a multipart listing from a previous execution context", async () => {
    const staleListing = deferred<MultipartResponse>();
    apiMocks.listMultipartUploads.mockImplementation((contextId: string) =>
      contextId === "acc-a"
        ? staleListing.promise
        : Promise.resolve(response("current.bin")),
    );

    const { result, rerender } = renderHook(
      ({ contextIdForApi }) =>
        useBrowserMultipartUploads({
          contextIdForApi,
          bucketName: "shared-bucket",
          hasContext: true,
          requestConfirmation: vi.fn(),
          setStatusMessage: vi.fn(),
          setWarningMessage: vi.fn(),
        }),
      { initialProps: { contextIdForApi: "acc-a" } },
    );

    act(() => result.current.open());
    await waitFor(() =>
      expect(apiMocks.listMultipartUploads).toHaveBeenCalledWith(
        "acc-a",
        "shared-bucket",
        { maxUploads: 50 },
      ),
    );

    rerender({ contextIdForApi: "acc-b" });
    await waitFor(() => expect(result.current.showModal).toBe(false));
    act(() => result.current.open());
    await waitFor(() =>
      expect(result.current.uploads.map((upload) => upload.key)).toEqual([
        "current.bin",
      ]),
    );

    await act(async () => {
      staleListing.resolve(response("stale.bin"));
      await staleListing.promise;
    });

    expect(result.current.uploads.map((upload) => upload.key)).toEqual([
      "current.bin",
    ]);
  });

  it("ignores an abort completion from a previous execution context", async () => {
    const pendingAbort = deferred<void>();
    apiMocks.listMultipartUploads.mockImplementation((contextId: string) =>
      Promise.resolve(
        response(contextId === "acc-a" ? "old.bin" : "current.bin"),
      ),
    );
    apiMocks.abortMultipartUpload.mockReturnValue(pendingAbort.promise);
    let confirmation: Confirmation | undefined;
    const requestConfirmation = vi.fn((next: Confirmation) => {
      confirmation = next;
    });
    const setStatusMessage = vi.fn();

    const { result, rerender } = renderHook(
      ({ contextIdForApi }) =>
        useBrowserMultipartUploads({
          contextIdForApi,
          bucketName: "shared-bucket",
          hasContext: true,
          requestConfirmation,
          setStatusMessage,
          setWarningMessage: vi.fn(),
        }),
      { initialProps: { contextIdForApi: "acc-a" } },
    );

    act(() => result.current.open());
    await waitFor(() => expect(result.current.uploads).toHaveLength(1));
    act(() => result.current.requestAbort(result.current.uploads[0]));
    expect(confirmation).toBeDefined();

    let abortPromise!: Promise<void>;
    act(() => {
      abortPromise = Promise.resolve(confirmation!.onConfirm());
    });
    await waitFor(() => expect(apiMocks.abortMultipartUpload).toHaveBeenCalled());

    rerender({ contextIdForApi: "acc-b" });
    act(() => result.current.open());
    await waitFor(() =>
      expect(result.current.uploads.map((upload) => upload.key)).toEqual([
        "current.bin",
      ]),
    );

    await act(async () => {
      pendingAbort.resolve();
      await abortPromise;
    });

    expect(result.current.uploads.map((upload) => upload.key)).toEqual([
      "current.bin",
    ]);
    expect(setStatusMessage).not.toHaveBeenCalled();
  });
});
