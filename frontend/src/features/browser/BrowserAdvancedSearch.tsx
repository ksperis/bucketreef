/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useState } from "react";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { EMPTY_BROWSER_FILE_FILTERS, type BrowserFileFilterDraft } from "./browserFileFilters";
import { useBrowserText } from "./browserMessages";

type BrowserAdvancedSearchValue = {
  scope: "prefix" | "bucket"; recursive: boolean; exactMatch: boolean; caseSensitive: boolean;
  type: "all" | "file" | "folder"; storageClass: string; files: BrowserFileFilterDraft;
};

export default function BrowserAdvancedSearch({ value, portal, storageClasses, onApply, onClose }: {
  value: BrowserAdvancedSearchValue; portal: boolean; storageClasses: readonly string[];
  onApply: (value: BrowserAdvancedSearchValue) => void; onClose: () => void;
}) {
  const tr = useBrowserText();
  const [draft, setDraft] = useState(value);
  const hasFiles = Object.values(draft.files).some(Boolean);
  const scope = draft.scope === "bucket" ? "bucket" : draft.recursive ? "recursive" : "prefix";
  return <form role="dialog" aria-label={tr("Advanced search")} className="space-y-4 p-4 text-left font-normal normal-case" onSubmit={event => { event.preventDefault(); onApply(draft); }}>
    <div className="flex items-center justify-between gap-4"><h3 className="ui-subtitle">{tr("Advanced search")}</h3><UiButton size="sm" variant="ghost" onClick={onClose}>{tr("Close")}</UiButton></div>
    <UiSelect label={tr("Search in")} aria-label={tr("Search scope")} autoFocus value={scope} onChange={event => setDraft(previous => ({ ...previous, scope: event.target.value === "bucket" ? "bucket" : "prefix", recursive: event.target.value === "recursive" }))}>
      <option value="prefix">{tr("This folder")}</option><option value="recursive">{tr("With subfolders")}</option><option value="bucket">{tr(portal ? "Whole space" : "Whole bucket")}</option>
    </UiSelect>
    <div className="grid grid-cols-2 gap-3">
      {([["minSize", "Minimum bytes", "number"], ["maxSize", "Maximum bytes", "number"], ["modifiedAfter", "Modified after", "datetime-local"], ["modifiedBefore", "Modified before", "datetime-local"], ["extensions", "Extensions, separated by commas", "text"]] as const).map(([key, label, type]) => <UiInput key={key} label={tr(label)} type={type} min={type === "number" ? key === "maxSize" && draft.files.minSize !== "" ? Number(draft.files.minSize) : 0 : undefined} step={type === "number" ? 1 : undefined} fieldClassName={key === "extensions" ? "col-span-2" : ""} value={draft.files[key]} disabled={draft.type === "folder"} onChange={event => setDraft(previous => ({ ...previous, files: { ...previous.files, [key]: event.target.value } }))} size="compact" />)}
    </div>
    <details open={draft.exactMatch || draft.caseSensitive || draft.type !== "all" || draft.storageClass !== "all" || undefined}>
      <summary className="cursor-pointer ui-caption">{tr("Matching options")}</summary>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <UiCheckboxField checked={draft.exactMatch} onChange={event => setDraft(previous => ({ ...previous, exactMatch: event.target.checked }))} aria-label="Use exact match">{tr("Exact match")}</UiCheckboxField>
        <UiCheckboxField checked={draft.caseSensitive} onChange={event => setDraft(previous => ({ ...previous, caseSensitive: event.target.checked }))} aria-label="Case-sensitive search">{tr("Case-sensitive")}</UiCheckboxField>
        <UiSelect label={tr("Type")} aria-label="Object type filter" value={draft.type} onChange={event => setDraft(previous => ({ ...previous, type: event.target.value as BrowserAdvancedSearchValue["type"] }))}>
          <option value="all">{tr("All")}</option><option value="file">{tr("Files")}</option><option value="folder" disabled={hasFiles}>{tr("Folders")}</option>
        </UiSelect>
        <UiSelect label={tr("Storage class")} aria-label="Storage class filter" value={draft.storageClass} onChange={event => setDraft(previous => ({ ...previous, storageClass: event.target.value }))}>
          <option value="all">{tr("All classes")}</option>{storageClasses.map(value => <option key={value}>{value}</option>)}
        </UiSelect>
      </div>
    </details>
    <p className="ui-caption text-[var(--ui-text-muted)]">{tr("Size, modification time and extension filters return files only. Dates use your local time zone.")} {draft.type === "folder" && tr("Choose Files or All in search options to use these filters.")}</p>
    <div className="flex justify-between gap-3"><UiButton variant="ghost" onClick={() => setDraft({ scope: "prefix", recursive: false, exactMatch: false, caseSensitive: false, type: "all", storageClass: "all", files: EMPTY_BROWSER_FILE_FILTERS })}>{tr("Reset")}</UiButton><UiButton type="submit" variant="primary">{tr("Apply")}</UiButton></div>
  </form>;
}
