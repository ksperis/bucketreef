/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { searchBrowserBuckets } from "../../api/browserBuckets";
import { listBrowserObjects } from "../../api/browserObjects";
import type { BrowserBucket } from "../../api/browserContracts";
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { BrowserItem } from "./browserTypes";
import type { BrowserTransferDestination } from "./useBrowserClipboard";

export type BrowserDestinationRequest = { items: BrowserItem[]; mode: "rename" | "copy" | "move" };
export function browserParentPrefix(key: string) { const path = key.endsWith("/") ? key.slice(0, -1) : key; return path.slice(0, path.lastIndexOf("/") + 1); }

export default function BrowserDestinationDialog({ request, accountId, sourceBucket, initialPrefix, options, onClose, onSubmit }: {
  request: BrowserDestinationRequest; accountId: S3AccountSelector; sourceBucket: string; initialPrefix: string; options?: BrowserRequestOptions;
  onClose: () => void; onSubmit: (destination: BrowserTransferDestination) => void;
}) {
  const rename = request.mode === "rename";
  const [bucket, setBucket] = useState(sourceBucket);
  const [prefix, setPrefix] = useState(rename ? browserParentPrefix(request.items[0].key) : initialPrefix);
  const [name, setName] = useState(request.items[0]?.name ?? "");
  const [buckets, setBuckets] = useState<BrowserBucket[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (rename) return;
    let active = true;
    searchBrowserBuckets(accountId, { ...options, search, page, pageSize: 100 }).then(result => {
      if (!active) return;
      setBuckets(previous => page === 1 ? result.items : [...previous, ...result.items]); setHasNext(result.has_next);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Unable to list destinations."); });
    return () => { active = false; };
  }, [accountId, options, search, page, rename]);
  useEffect(() => {
    if (rename) return;
    const controller = new AbortController(); setLoading(true); setError("");
    listBrowserObjects(accountId, bucket, { ...options, prefix, type: "folder", maxKeys: 200, continuationToken: token, signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setFolders(previous => token ? [...new Set([...previous, ...result.prefixes])] : result.prefixes);
      setNextToken(result.next_continuation_token ?? null);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to list folders."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId, bucket, options, prefix, token, rename]);
  const destinationPrefix = prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix;
  const invalidName = rename && (!name || name.includes("/") || new TextEncoder().encode(`${destinationPrefix}${name}`).length > 1024);
  const sameSource = bucket === sourceBucket && request.items.some(item => rename ? `${destinationPrefix}${name}${item.type === "folder" ? "/" : ""}` === item.key : item.type === "folder" && destinationPrefix.startsWith(item.key.endsWith("/") ? item.key : `${item.key}/`));
  const label = rename ? "Rename" : request.mode === "move" ? "Move to" : "Copy to";
  const navigate = (value: string) => { setPrefix(value); setToken(null); setFolders([]); };
  return <Modal title={label} onClose={onClose}>
    <div className="space-y-3">
      {rename ? <UiInput label="New name" value={name} onChange={event => setName(event.target.value)} autoFocus /> : <>
        <UiInput label={options?.workspaceSurface === "portal" ? "Find a Storage Space" : "Find a bucket"} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
        <UiSelect label="Destination" value={bucket} onChange={event => { setBucket(event.target.value); navigate(""); }}>
          {!buckets.some(item => item.name === bucket) && <option value={bucket}>{bucket}</option>}
          {buckets.map(item => <option key={item.name} value={item.name} disabled={item.role === "Viewer"}>{item.display_name || item.name}{item.role === "Viewer" ? " (read only)" : ""}</option>)}
        </UiSelect>
        {hasNext && <UiButton size="sm" onClick={() => setPage(value => value + 1)}>More destinations</UiButton>}
        <UiInput label="Destination folder" value={prefix} onChange={event => navigate(event.target.value)} hint="An empty path selects the root. Keys are preserved exactly." />
        <nav aria-label="Destination folders" className="max-h-48 overflow-auto space-y-1">
          {prefix && <UiButton size="sm" onClick={() => navigate(browserParentPrefix(prefix))}>Parent folder</UiButton>}
          {folders.map(folder => <div key={folder}><UiButton size="sm" onClick={() => navigate(folder)}>{folder.slice(prefix.length) || folder}</UiButton></div>)}
          {nextToken && <UiButton size="sm" disabled={loading} onClick={() => setToken(nextToken)}>More folders</UiButton>}
        </nav>
      </>}
      <p className="ui-caption break-all">{request.items.map(item => item.key).join(", ")} → {buckets.find(item => item.name === bucket)?.display_name || bucket}/{destinationPrefix}{rename ? name : ""}</p>
      {request.mode !== "copy" && <p className="ui-caption">Only current objects move. Older versions remain at their original keys. An unverified copy keeps its source.</p>}
      {sameSource && <p role="alert">Choose a different destination outside the selected folder.</p>}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading folders…</p>}
      <div className="flex justify-end gap-2"><UiButton onClick={onClose}>Cancel</UiButton><UiButton variant="primary" disabled={invalidName || sameSource || loading || Boolean(error)} onClick={() => onSubmit({ bucket, prefix: destinationPrefix, ...(rename ? { name } : {}) })}>{label}</UiButton></div>
    </div>
  </Modal>;
}
