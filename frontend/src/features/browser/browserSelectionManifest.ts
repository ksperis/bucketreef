import type { BrowserObject } from "../../api/browserContracts";
import type { BrowserItem } from "./browserTypes";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

/** Enumerate exact object keys once, even for overlapping folder selections. */
export async function buildBrowserSelectionManifest(
  items: readonly BrowserItem[],
  list: ListAllBrowserObjectsForPrefix,
  signal: AbortSignal,
  onProgress: (completed: number, total: number) => void = () => {},
): Promise<BrowserObject[]> {
  const objects = new Map<string, BrowserObject>();
  const folders = items.filter((item) => item.type === "folder" && !item.isDeleted)
    .map((item) => item.key.endsWith("/") ? item.key : `${item.key}/`)
    .sort();
  const roots = folders.filter((prefix, index) => !folders.slice(0, index).some((parent) => prefix.startsWith(parent)));
  for (const item of items) {
    if (item.type !== "file" || item.isDeleted || roots.some((prefix) => item.key.startsWith(prefix))) continue;
    if (item.sizeBytes == null) throw new Error(`Size unavailable for ${item.name}. Refresh the listing first.`);
    objects.set(item.key, { key: item.key, size: item.sizeBytes, etag: item.etag });
  }
  for (const [index, prefix] of roots.entries()) {
    signal.throwIfAborted();
    for (const object of await list(prefix, undefined, undefined, signal)) objects.set(object.key, object);
    onProgress(index + 1, roots.length);
  }
  signal.throwIfAborted();
  return [...objects.values()];
}
