import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("retired Browser transfer storage", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());
  it("deletes only the obsolete database once without opening it", async () => {
    const request = { onerror: null as null | (() => void) };
    const deleteDatabase = vi.fn(() => request);
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { deleteDatabase, open });
    const { retireBrowserTransferStorage } = await import("./browserRetiredTransferStorage");
    retireBrowserTransferStorage();
    retireBrowserTransferStorage();
    expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("bucketreef-browser-transfers-v1");
    expect(open).not.toHaveBeenCalled();
    request.onerror?.();
    retireBrowserTransferStorage();
    expect(deleteDatabase).toHaveBeenCalledTimes(2);
  });
  it("does not block ordinary transfers when storage is disabled", async () => {
    vi.stubGlobal("indexedDB", { deleteDatabase: () => { throw new Error("Disabled"); } });
    const { retireBrowserTransferStorage } = await import("./browserRetiredTransferStorage");
    expect(retireBrowserTransferStorage).not.toThrow();
    vi.stubGlobal("indexedDB", undefined);
    expect(retireBrowserTransferStorage).not.toThrow();
  });
});
