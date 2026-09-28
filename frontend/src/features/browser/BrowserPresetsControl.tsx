import { useBrowserText } from "./browserMessages";
/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { browserPresetInput, deleteBrowserPreset, listBrowserPresets, saveBrowserPreset, type BrowserPreset, type BrowserPresetInput } from "../../api/browserPresets";
import { searchBrowserBuckets } from "../../api/browserBuckets";
import { listBrowserObjects } from "../../api/browserObjects";
import BrowserUtilityIcon from "./BrowserUtilityIcon";
import { MoreIcon } from "./browserIcons";

export default function BrowserPresetsControl({ current, accountUser, onApply, lockedBucket, availableContexts = [], variant = "button", contextLabels = {}, compact = false }: {
  current: BrowserPresetInput; accountUser: boolean; onApply: (preset: BrowserPreset) => void; lockedBucket?: string; availableContexts?: string[];
  variant?: "button" | "sidebar"; contextLabels?: Record<string, string>; compact?: boolean;
}) {
  const tr = useBrowserText();
  const active = useRef(true);
  const scope = useRef(current.context);
  scope.current = current.context;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<BrowserPreset[]>([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BrowserPreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const reload = useCallback(async () => {
    if (!accountUser) return;
    try { setPresets(await listBrowserPresets(current.surface)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sync saved views."); }
  }, [accountUser, current.surface]);
  useEffect(() => {
    if (!open && variant !== "sidebar") return;
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open, reload, variant]);
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
    {variant === "button" ? <UiButton size="sm" variant="secondary" aria-label={tr("Favorites and views")} title={tr("Favorites and views")} onClick={() => { setOpen(true); setName(current.prefix || current.bucket); }}><BrowserUtilityIcon name="star" /></UiButton> : <div className="flex min-h-0 flex-1 flex-col gap-3 px-2 py-3">
      {!compact && <UiInput label={tr("Search favorites")} labelClassName="sr-only" placeholder={tr("Search favorites")} value={search} onChange={event => setSearch(event.target.value)} size="compact" />}
      {!accountUser ? <p className="ui-caption px-2">{tr("Synchronization requires a UI account. Temporary S3 sessions cannot save favorites or views to an account.")}</p> : <>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-4">
          {(["favorite", "view"] as const).map(kind => <section key={kind} aria-label={tr(kind === "favorite" ? "Locations" : "Saved views")}>
            <h3 className={compact ? "sr-only" : "px-2 py-2 text-[11px] uppercase tracking-wide text-[var(--shell-muted-text)]"}>{tr(kind === "favorite" ? "Locations" : "Saved views")}</h3>
            {presets.filter(preset => preset.kind === kind && `${preset.name} ${preset.bucket} ${preset.prefix}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(preset => {
              const subtitle = `${preset.bucket}${preset.prefix ? ` / ${preset.prefix}` : ""}${contextLabels[preset.context] ? ` · ${contextLabels[preset.context]}` : preset.context !== current.context ? ` · ${preset.context}` : ""}`;
              const selected = preset.context === current.context && preset.bucket === current.bucket && preset.prefix === current.prefix;
              return <div key={preset.id} className={`group rounded-md ${selected ? "shell-sidebar-item-active" : "shell-sidebar-item"}`}>
                <div className="flex items-center">
                  <button type="button" disabled={busy} title={`${preset.name} · ${subtitle}`} onClick={() => void apply(preset)} className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <BrowserUtilityIcon name={kind === "favorite" ? "star" : "bookmark"} className="mt-0.5 h-4 w-4" />
                    <span className={compact ? "sr-only" : "min-w-0"}><span className="block truncate text-sm font-medium">{preset.name}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--shell-muted-text)]" title={subtitle}>{subtitle}</span></span>
                  </button>
                  {!compact && <UiButton size="sm" variant="ghost" aria-label={`${tr("Manage favorites")}: ${preset.name}`} onClick={() => { setEditing(preset); setName(preset.name); setOpen(true); }}><MoreIcon className="h-3.5 w-3.5" /></UiButton>}
                </div>
                {unavailable[preset.id] && <p role="status" className="px-2 pb-2 ui-caption">{unavailable[preset.id]}</p>}
              </div>;
            })}
          </section>)}
          {!presets.length && <p className="px-2 ui-caption">{tr("No saved items in this workspace.")}</p>}
        </div>
        {error && <p role="alert" className="ui-caption">{error}</p>}
        <UiButton variant="ghost" size="sm" className="justify-start" aria-label={tr("Manage favorites")} onClick={() => { setEditing(null); setName(current.prefix || current.bucket); setOpen(true); }}>{compact ? <MoreIcon className="h-4 w-4" /> : <>{tr("Pin location")} / {tr("Save view")}</>}</UiButton>
      </>}
    </div>}
    {open && <Modal title={tr("Favorites and views")} onClose={() => { if (!busy) setOpen(false); }}>
      {!accountUser ? <p>{tr("Synchronization requires a UI account. Temporary S3 sessions cannot save favorites or views to an account.")}</p> : <div className="space-y-3">
        <p className="ui-caption">{import.meta.env.MODE === "demo" ? tr("Demo: saved locally for this identity.") : tr("Personal to your account, synchronized across browsers.")} Saved in the {current.surface} workspace.</p>
        <UiInput label={editing ? tr("Rename saved item") : tr("Name")} value={name} maxLength={120} onChange={event => setName(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          {editing ? <><UiButton disabled={busy || !name.trim()} onClick={() => void mutate(() => saveBrowserPreset({ ...browserPresetInput(editing), name }, editing))}>{tr("Save name")}</UiButton><UiButton onClick={() => setEditing(null)}>{tr("Cancel editing")}</UiButton></> : <>
            <UiButton disabled={busy || !name.trim() || !current.bucket || !current.context} onClick={() => void mutate(() => saveBrowserPreset({ ...current, name, kind: "favorite", view: null }))}>{tr("Pin location")}</UiButton>
            <UiButton disabled={busy || !name.trim() || !current.bucket || !current.context} onClick={() => void mutate(() => saveBrowserPreset({ ...current, name, kind: "view" }))}>{tr("Save view")}</UiButton>
          </>}
          <UiButton disabled={busy} onClick={() => void reload()}>{tr("Refresh")}</UiButton>
        </div>
        {error && <p role="alert">{error}</p>}
        <ul className="max-h-80 space-y-3 overflow-y-auto">{presets.map(preset => <li key={preset.id} className="rounded border border-[var(--ui-border)] p-2 space-y-1">
          <UiButton disabled={busy} onClick={() => void apply(preset)}>{preset.kind === "favorite" ? "★ " : ""}{preset.name}</UiButton>
          <p className="ui-caption break-all">{preset.context} · {preset.bucket}/{preset.prefix}</p>
          {unavailable[preset.id] && <p role="status" className="ui-caption">Unavailable: {unavailable[preset.id]}</p>}
          <div className="flex flex-wrap gap-2">
            <UiButton size="sm" disabled={busy} onClick={() => { setEditing(preset); setName(preset.name); }}>{tr("Rename")}</UiButton>
            {preset.kind === "view" && <UiButton size="sm" disabled={busy || !current.context || !current.bucket} onClick={() => void mutate(() => saveBrowserPreset({ ...current, name: preset.name, kind: "view" }, preset))}>{tr("Update from current view")}</UiButton>}
            <UiButton size="sm" disabled={busy} onClick={() => void mutate(() => deleteBrowserPreset(preset))}>{tr("Remove")}</UiButton>
          </div>
        </li>)}</ul>
        {!presets.length && <p className="ui-caption">{tr("No saved items in this workspace.")}</p>}
      </div>}
    </Modal>}
  </>;
}
