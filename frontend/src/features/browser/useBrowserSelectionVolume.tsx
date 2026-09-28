import { useEffect, useRef, useState } from "react";
import { ListActionButton } from "../../components/list/ListControls";
import { formatBytes } from "../../utils/format";
import { buildBrowserSelectionManifest } from "./browserSelectionManifest";
import type { BrowserItem } from "./browserTypes";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

export function useBrowserSelectionVolume(items: BrowserItem[], scope: string, list: ListAllBrowserObjectsForPrefix) {
  const key = JSON.stringify([scope, items.map((item) => [item.id, item.sizeBytes, item.etag])]);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; bytes?: number; progress?: string; error?: string } | null>(null);
  useEffect(() => () => controller.current?.abort(), [key]);
  const folders = items.filter((item) => item.type === "folder").length;
  const files = items.length - folders;
  const known = items.reduce((sum, item) => sum + (item.type === "file" ? item.sizeBytes ?? 0 : 0), 0);
  const unknown = folders + items.filter((item) => item.type === "file" && item.sizeBytes == null).length;
  const current = state?.key === key ? state : null;
  const calculate = async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setState({ key, progress: "Calculating…" });
    try {
      const objects = await buildBrowserSelectionManifest(items, list, active.signal,
        (done, total) => setState({ key, progress: `${done}/${total} folders` }));
      setState({ key, bytes: objects.reduce((sum, object) => sum + object.size, 0) });
    } catch (error) {
      if (!active.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "Unable to calculate volume." });
    }
  };
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    <span>{files} file{files === 1 ? "" : "s"} · {folders} folder{folders === 1 ? "" : "s"} · {formatBytes(current?.bytes ?? known)}{current?.bytes == null && unknown > 0 ? " known; remaining volume not calculated" : ""}</span>
    {unknown > 0 && current?.bytes == null && !current?.progress && <ListActionButton onClick={() => void calculate()}>Calculate volume</ListActionButton>}
    {current?.progress && <><span>{current.progress}</span><ListActionButton onClick={() => { controller.current?.abort(); setState(null); }}>Cancel calculation</ListActionButton></>}
    {current?.error && <span role="alert">{current.error}</span>}
  </span>;
}
