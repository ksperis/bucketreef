import { describe, expect, it, vi } from "vitest";
import { transferClipboardObjectBetweenContexts, type ClipboardCopyCheckpoint } from "./browserClipboardTransfer";

describe("cross-context move retry", () => {
  it("retains the completed copy and retries only a verified conditional deletion", async () => {
    let checkpoint: ClipboardCopyCheckpoint | undefined;
    const input = { source: { selector: "a", bucket: "source", key: "key", etag: "s" }, destination: { selector: "b", bucket: "dest", key: "key" }, sizeBytes: 4, move: true,
      resolveMode: vi.fn(async () => "proxy" as const), downloadBlob: vi.fn(async () => new Blob(["data"])), downloadStream: vi.fn(), uploadMultipartStream: vi.fn(), uploadBlob: vi.fn(),
      verifyObject: vi.fn(async ({ bucket }: { bucket: string }) => ({ sizeBytes: 4, etag: bucket === "source" ? "s" : "d" })),
      deleteObject: vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined),
      onCopied: (value: ClipboardCopyCheckpoint) => { checkpoint = value; },
    };
    await expect(transferClipboardObjectBetweenContexts(input)).rejects.toThrow("denied");
    expect(checkpoint).toEqual({ sourceEtag: "s", destinationEtag: "d", sizeBytes: 4 });
    await transferClipboardObjectBetweenContexts({ ...input, checkpoint });
    expect(input.downloadBlob).toHaveBeenCalledTimes(1); expect(input.uploadBlob).toHaveBeenCalledTimes(1);
    expect(input.deleteObject).toHaveBeenLastCalledWith(expect.objectContaining({ etag: "s" }));
    input.verifyObject.mockResolvedValue({ sizeBytes: 4, etag: "changed" });
    await expect(transferClipboardObjectBetweenContexts({ ...input, checkpoint })).rejects.toThrow("destination changed");
    expect(input.deleteObject).toHaveBeenCalledTimes(2);
  });
});
