import { useBrowserText } from "./browserMessages";
/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import UiButton from "../../components/ui/UiButton";
import type { BrowserFileFilterDraft } from "./browserFileFilters";

export default function BrowserSearchControls({ scope, recursive, onScope, onRecursive, loading, partial, active, empty, failed }: {
  portal: boolean; scope: "prefix" | "bucket"; recursive: boolean; onScope: (value: "prefix" | "bucket") => void; onRecursive: (value: boolean) => void;
  filters: BrowserFileFilterDraft; onFilters: (value: BrowserFileFilterDraft) => void; loading: boolean; partial: boolean; active: boolean; empty: boolean; foldersOnly: boolean; failed?: boolean;
}) {
  const tr = useBrowserText();
  const current = scope === "bucket" ? "bucket" : recursive ? "recursive" : "prefix";
  const choose = (value: string) => { onScope(value === "bucket" ? "bucket" : "prefix"); onRecursive(value === "recursive"); };
  if (!active) return null;
  return <div className="flex shrink-0 flex-wrap items-center gap-2 ui-caption text-[var(--ui-text-muted)]">
    <span role="status">{tr(failed ? "Search unavailable" : loading ? "Searching…" : partial ? "Partial results — load more to continue" : "Search complete")}</span>
    {empty && !loading && current !== "bucket" && <UiButton size="sm" variant="ghost" onClick={() => choose(current === "prefix" ? "recursive" : "bucket")}>{tr("Widen search scope")}</UiButton>}
  </div>;
}
