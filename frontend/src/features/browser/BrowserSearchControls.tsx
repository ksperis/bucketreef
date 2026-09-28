/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import type { BrowserFileFilterDraft } from "./browserFileFilters";

export default function BrowserSearchControls({ portal, scope, recursive, onScope, onRecursive, filters, onFilters, loading, partial, active, empty, foldersOnly, failed }: {
  portal: boolean; scope: "prefix" | "bucket"; recursive: boolean; onScope: (value: "prefix" | "bucket") => void; onRecursive: (value: boolean) => void;
  filters: BrowserFileFilterDraft; onFilters: (value: BrowserFileFilterDraft) => void; loading: boolean; partial: boolean; active: boolean; empty: boolean; foldersOnly: boolean; failed?: boolean;
}) {
  const current = scope === "bucket" ? "bucket" : recursive ? "recursive" : "prefix";
  const choose = (value: string) => { onScope(value === "bucket" ? "bucket" : "prefix"); onRecursive(value === "recursive"); };
  return <div className="shrink-0 space-y-2 px-1 ui-caption">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Search scope">
      {[["prefix", "This folder"], ["recursive", "With subfolders"], ["bucket", portal ? "Whole space" : "Whole bucket"]].map(([value, label]) => <UiButton key={value} size="sm" aria-pressed={current === value} variant={current === value ? "primary" : "secondary"} onClick={() => choose(value)}>{label}</UiButton>)}
      {active && <span role="status">{failed ? "Search unavailable" : loading ? "Searching…" : partial ? "Partial results — load more to continue" : "Search complete"}</span>}
      {active && empty && !loading && current !== "bucket" && <UiButton size="sm" onClick={() => choose(current === "prefix" ? "recursive" : "bucket")}>Widen search scope</UiButton>}
    </div>
    <details>
      <summary className="cursor-pointer">File filters{Object.values(filters).some(Boolean) ? " (active)" : ""}</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {([["minSize", "Minimum bytes", "number"], ["maxSize", "Maximum bytes", "number"], ["modifiedAfter", "Modified after", "datetime-local"], ["modifiedBefore", "Modified before", "datetime-local"], ["extensions", "Extensions, separated by commas", "text"]] as const).map(([key, label, type]) => <UiInput key={key} label={label} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? 1 : undefined} value={filters[key]} disabled={foldersOnly} onChange={event => onFilters({ ...filters, [key]: event.target.value })} size="compact" />)}
      </div>
      <p className="py-1">Size, modification time and extension filters return files only. Dates use your local time zone. {foldersOnly ? "Choose Files or All in search options to use these filters." : "Folders and deletion markers are excluded while these filters are active."}</p>
    </details>
  </div>;
}
