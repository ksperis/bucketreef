/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { browserPresetInput, deleteBrowserPreset, listBrowserPresets, saveBrowserPreset, type BrowserPreset, type BrowserPresetInput } from "../../api/browserPresets";
import { searchBrowserBuckets } from "../../api/browserBuckets";
import { listBrowserObjects } from "../../api/browserObjects";

export default function BrowserPresetsControl({ current, accountUser, onApply, lockedBucket, availableContexts = [] }: {
  current: BrowserPresetInput; accountUser: boolean; onApply: (preset: BrowserPreset) => void; lockedBucket?: string; availableContexts?: string[];
}) {
  const active = useRef(true);
  const scope = useRef(current.context);
  scope.current = current.context;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<BrowserPreset[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<BrowserPreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const reload = useCallback(async () => {
    if (!accountUser) return;
    try { setPresets(await listBrowserPresets(current.surface)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sync saved views."); }
  }, [accountUser, current.surface]);
  useEffect(() => {
    if (!open) return;
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open, reload]);
  const mutate = async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await work(); setEditing(null); setName(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save changes. Refresh and try again."); }
    finally { await reload(); setBusy(false); }
  };
  const apply = async (preset: BrowserPreset) => {
    if (preset.context !== current.context && !availableContexts.includes(preset.context)) { setUnavailable(previous => ({ ...previous, [preset.id]: `Select the saved context (${preset.context}) to open this view.` })); return; }
    if (lockedBucket && preset.bucket !== lockedBucket) { setUnavailable(previous => ({ ...previous, [preset.id]: "Open this saved Storage Space to use its view." })); return; }
    setBusy(true); setError("");
    try {
      const result = await searchBrowserBuckets(preset.context, { workspaceSurface: preset.workspace, exact: true, search: preset.bucket, pageSize: 1 });
      if (!result.items.some(item => item.name === preset.bucket)) throw new Error("Saved location is unavailable. Its identity has been kept.");
      await listBrowserObjects(preset.context, preset.bucket, { workspaceSurface: preset.workspace, prefix: preset.prefix, maxKeys: 1 });
      if (!active.current || scope.current !== current.context) return;
      onApply(preset); setOpen(false);
    } catch (reason) { setUnavailable(previous => ({ ...previous, [preset.id]: reason instanceof Error ? reason.message : "Saved location is unavailable." })); }
    finally { setBusy(false); }
  };
  return <>
    <UiButton size="sm" onClick={() => { setOpen(true); setName(current.prefix || current.bucket); }}>Favorites and views</UiButton>
    {open && <Modal title="Favorites and views" onClose={() => { if (!busy) setOpen(false); }}>
      {!accountUser ? <p>Synchronization requires a UI account. Temporary S3 sessions cannot save favorites or views to an account.</p> : <div className="space-y-3">
        <p className="ui-caption">{import.meta.env.MODE === "demo" ? "Demo: saved locally for this identity." : "Personal to your account, synchronized across browsers."} Saved in the {current.surface} workspace.</p>
        <UiInput label={editing ? "Rename saved item" : "Name"} value={name} maxLength={120} onChange={event => setName(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          {editing ? <><UiButton disabled={busy || !name.trim()} onClick={() => void mutate(() => saveBrowserPreset({ ...browserPresetInput(editing), name }, editing))}>Save name</UiButton><UiButton onClick={() => setEditing(null)}>Cancel editing</UiButton></> : <>
            <UiButton disabled={busy || !name.trim() || !current.bucket || !current.context} onClick={() => void mutate(() => saveBrowserPreset({ ...current, name, kind: "favorite", view: null }))}>Pin location</UiButton>
            <UiButton disabled={busy || !name.trim() || !current.bucket || !current.context} onClick={() => void mutate(() => saveBrowserPreset({ ...current, name, kind: "view" }))}>Save view</UiButton>
          </>}
          <UiButton disabled={busy} onClick={() => void reload()}>Refresh</UiButton>
        </div>
        {error && <p role="alert">{error}</p>}
        <ul className="max-h-80 space-y-3 overflow-y-auto">{presets.map(preset => <li key={preset.id} className="rounded border border-[var(--ui-border)] p-2 space-y-1">
          <UiButton disabled={busy} onClick={() => void apply(preset)}>{preset.kind === "favorite" ? "★ " : ""}{preset.name}</UiButton>
          <p className="ui-caption break-all">{preset.context} · {preset.bucket}/{preset.prefix}</p>
          {unavailable[preset.id] && <p role="status" className="ui-caption">Unavailable: {unavailable[preset.id]}</p>}
          <div className="flex flex-wrap gap-2">
            <UiButton size="sm" disabled={busy} onClick={() => { setEditing(preset); setName(preset.name); }}>Rename</UiButton>
            {preset.kind === "view" && <UiButton size="sm" disabled={busy || !current.context || !current.bucket} onClick={() => void mutate(() => saveBrowserPreset({ ...current, name: preset.name, kind: "view" }, preset))}>Update from current view</UiButton>}
            <UiButton size="sm" disabled={busy} onClick={() => void mutate(() => deleteBrowserPreset(preset))}>Remove</UiButton>
          </div>
        </li>)}</ul>
        {!presets.length && <p className="ui-caption">No saved items in this workspace.</p>}
      </div>}
    </Modal>}
  </>;
}
