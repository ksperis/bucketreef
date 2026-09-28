import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileUploadParts, uploadResumableBrowserFile } from "./browserResumableUpload";
import type { LocalUpload } from "./browserTransferStore";

const mocks = vi.hoisted(() => ({ fingerprint: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("./browserFileFingerprint", () => ({ fingerprintBrowserFile: mocks.fingerprint }));
vi.mock("./browserTransferStore", () => ({ saveLocalUpload: mocks.save, removeLocalUpload: mocks.remove, withLocalUploadLock: async (_id: string, action: () => Promise<void>) => action() }));
const record: LocalUpload = { id: "saved", owner: "user1", workspace: "portal", accountId: "101", bucket: "space", key: " /a.bin ", uploadId: "s3-id", name: "a.bin", size: 8, lastModified: 100, contentType: "", fingerprint: "correct", partSize: 4, parts: [{ part_number: 1, etag: "one", size: 4 }], requiresSse: false, createdAt: 1, updatedAt: 1, state: "pending" };
const options = () => ({ file: new File(["abcdefgh"], "a.bin"), controller: new AbortController(), concurrency: 1, scope: record, existing: { ...record },
  lifecycle: { initiate: vi.fn(), presignPart: vi.fn(), uploadPart: vi.fn(async () => "two"), complete: vi.fn(), abort: vi.fn() },
  listParts: vi.fn(async () => record.parts), onProgress: vi.fn(), onPreparing: vi.fn(), onWarning: vi.fn(), onResumable: vi.fn(),
});
describe("local multipart recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); mocks.fingerprint.mockResolvedValue("correct"); Object.defineProperty(navigator, "locks", { configurable: true, value: {} }); vi.stubGlobal("Worker", class {}); });
  it("reconciles only verified receipts, rejecting unknown, changed and incorrectly sized parts", () => {
    const local = [{ part_number: 1, etag: '"one"', size: 4 }, { part_number: 2, etag: "old", size: 4 }];
    expect(reconcileUploadParts(local, [{ part_number: 1, etag: "one", size: 4 }, { part_number: 2, etag: "new", size: 4 }, { part_number: 3, etag: "unknown", size: 4 }], 12, 4)).toEqual([{ part_number: 1, etag: "one", size: 4 }]);
  });
  it("uses the persisted upload after reload and transmits only missing parts", async () => {
    const input = options(); await uploadResumableBrowserFile(input);
    expect(input.lifecycle.initiate).not.toHaveBeenCalled();
    expect(input.lifecycle.uploadPart).toHaveBeenCalledWith("s3-id", 2, expect.any(Blob), expect.any(AbortSignal));
    expect(input.lifecycle.complete).toHaveBeenCalledWith("s3-id", [{ part_number: 1, etag: "one", size: 4 }, { part_number: 2, etag: "two" }]);
    expect(mocks.remove).toHaveBeenCalledWith("saved");
  });
  it("rejects wrong contents before reading or changing any remote parts", async () => {
    mocks.fingerprint.mockResolvedValue("wrong"); const input = options();
    await expect(uploadResumableBrowserFile(input)).rejects.toThrow("fingerprint");
    expect(input.listParts).not.toHaveBeenCalled(); expect(input.lifecycle.uploadPart).not.toHaveBeenCalled();
  });
  it("rejects a different identity or missing SSE-C key before fingerprinting", async () => {
    const input = options(); input.scope = { ...record, owner: "other" };
    await expect(uploadResumableBrowserFile(input)).rejects.toThrow("identity");
    input.scope = record; input.existing = { ...record, requiresSse: true };
    await expect(uploadResumableBrowserFile(input)).rejects.toThrow("SSE-C");
    expect(mocks.fingerprint).not.toHaveBeenCalled();
  });
  it("marks a vanished remote upload as unavailable without initiating a replacement", async () => {
    const input = options(); input.listParts.mockRejectedValue(Object.assign(new Error("Gone"), { response: { status: 404 } }));
    await expect(uploadResumableBrowserFile(input)).rejects.toThrow("Gone");
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ state: "unavailable" }));
    expect(input.lifecycle.initiate).not.toHaveBeenCalled();
  });
});
