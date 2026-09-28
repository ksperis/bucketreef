import { describe, expect, it, vi } from "vitest";
import { buildBrowserSelectionManifest } from "./browserSelectionManifest";
import type { BrowserItem } from "./browserTypes";

const item = (key: string, type: "file" | "folder", sizeBytes?: number): BrowserItem => ({ id: key, key, name: key, type, sizeBytes, size: "", modified: "", owner: "" });
describe("selection manifest", () => {
  it("deduplicates folders, nested selections and file overlap without normalizing exact keys", async () => {
    const list = vi.fn().mockResolvedValue([{ key: "a/x", size: 4 }, { key: "a//b/y", size: 7 }]);
    const result = await buildBrowserSelectionManifest([item("a/", "folder"), item("a//b/", "folder"), item("a/x", "file", 4), item("z", "file", 2)], list, new AbortController().signal);
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.map((object) => object.key)).toEqual(["z", "a/x", "a//b/y"]);
    expect(result.reduce((sum, object) => sum + object.size, 0)).toBe(13);
  });
  it("does not present unknown file sizes as zero", async () => {
    await expect(buildBrowserSelectionManifest([item("x", "file")], vi.fn(), new AbortController().signal)).rejects.toThrow("Size unavailable");
  });
  it("stops before enumeration when cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    const list = vi.fn();
    await expect(buildBrowserSelectionManifest([item("a/", "folder")], list, controller.signal)).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });
});
