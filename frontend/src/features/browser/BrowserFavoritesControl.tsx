import { useBrowserText } from "./browserMessages";
/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { browserFavoriteInput, deleteBrowserFavorite, listBrowserFavorites, saveBrowserFavorite, type BrowserFavorite, type BrowserFavoriteInput } from "../../api/browserFavorites";
import { searchBrowserBuckets } from "../../api/browserBuckets";
import { listBrowserObjects } from "../../api/browserObjects";
import BrowserUtilityIcon from "./BrowserUtilityIcon";
import { MoreIcon } from "./browserIcons";

export default function BrowserFavoritesControl({ current, accountUser, onApply, lockedBucket, availableContexts = [], variant = "button", contextLabels = {}, compact = false }: {
  current: BrowserFavoriteInput; accountUser: boolean; onApply: (favorite: BrowserFavorite) => void; lockedBucket?: string; availableContexts?: string[];
  variant?: "button" | "sidebar"; contextLabels?: Record<string, string>; compact?: boolean;
}) {
  const tr = useBrowserText();
  const active = useRef(true);
  const scope = useRef(current.context);
  scope.current = current.context;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [open, setOpen] = useState(false);
  const [favorites, setPresets] = useState<BrowserFavorite[]>([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BrowserFavorite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const reload = useCallback(async () => {
    if (!accountUser) return;
    try { setPresets(await listBrowserFavorites(current.surface)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sync favorites."); }
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
  const apply = async (favorite: BrowserFavorite) => {
    if (favorite.context !== current.context && !availableContexts.includes(favorite.context)) { setUnavailable(previous => ({ ...previous, [favorite.id]: `Select the saved context (${favorite.context}) to open this favorite.` })); return; }
    if (lockedBucket && favorite.bucket !== lockedBucket) { setUnavailable(previous => ({ ...previous, [favorite.id]: "Open this saved Storage Space to open this favorite." })); return; }
    setBusy(true); setError("");
    try {
      const result = await searchBrowserBuckets(favorite.context, { workspaceSurface: favorite.workspace, exact: true, search: favorite.bucket, pageSize: 1 });
      if (!result.items.some(item => item.name === favorite.bucket)) throw new Error("Saved location is unavailable. Its identity has been kept.");
      await listBrowserObjects(favorite.context, favorite.bucket, { workspaceSurface: favorite.workspace, prefix: favorite.prefix, maxKeys: 1 });
      if (!active.current || scope.current !== current.context) return;
      onApply(favorite); setOpen(false);
    } catch (reason) { setUnavailable(previous => ({ ...previous, [favorite.id]: reason instanceof Error ? reason.message : "Saved location is unavailable." })); }
    finally { setBusy(false); }
  };
  return <>
    {variant === "button" ? <UiButton size="sm" variant="secondary" aria-label={tr("Favorites")} title={tr("Favorites")} onClick={() => { setOpen(true); setName(current.prefix || current.bucket); }}><BrowserUtilityIcon name="star" /></UiButton> : <div className="flex min-h-0 flex-1 flex-col gap-3 px-2 py-3">
      {!compact && <UiInput label={tr("Search favorites")} labelClassName="sr-only" placeholder={tr("Search favorites")} value={search} onChange={event => setSearch(event.target.value)} size="compact" />}
      {!accountUser ? <p className="ui-caption px-2">{tr("Synchronization requires a UI account. Temporary S3 sessions cannot save favorites to an account.")}</p> : <>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-4">
          <section aria-label={tr("Locations")}>
            <h3 className={compact ? "sr-only" : "px-2 py-2 text-[11px] uppercase tracking-wide text-[var(--shell-muted-text)]"}>{tr("Locations")}</h3>
            {favorites.filter(favorite => `${favorite.name} ${favorite.bucket} ${favorite.prefix}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(favorite => {
              const subtitle = `${favorite.bucket}${favorite.prefix ? ` / ${favorite.prefix}` : ""}${contextLabels[favorite.context] ? ` · ${contextLabels[favorite.context]}` : favorite.context !== current.context ? ` · ${favorite.context}` : ""}`;
              const selected = favorite.context === current.context && favorite.bucket === current.bucket && favorite.prefix === current.prefix;
              return <div key={favorite.id} className={`group rounded-md ${selected ? "shell-sidebar-item-active" : "shell-sidebar-item"}`}>
                <div className="flex items-center">
                  <button type="button" disabled={busy} title={`${favorite.name} · ${subtitle}`} onClick={() => void apply(favorite)} className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <BrowserUtilityIcon name="star" className="mt-0.5 h-4 w-4" />
                    <span className={compact ? "sr-only" : "min-w-0"}><span className="block truncate text-sm font-medium">{favorite.name}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--shell-muted-text)]" title={subtitle}>{subtitle}</span></span>
                  </button>
                  {!compact && <UiButton size="sm" variant="ghost" aria-label={`${tr("Manage favorites")}: ${favorite.name}`} onClick={() => { setEditing(favorite); setName(favorite.name); setOpen(true); }}><MoreIcon className="h-3.5 w-3.5" /></UiButton>}
                </div>
                {unavailable[favorite.id] && <p role="status" className="px-2 pb-2 ui-caption">{unavailable[favorite.id]}</p>}
              </div>;
            })}
          </section>
          {!favorites.length && <p className="px-2 ui-caption">{tr("No saved items in this workspace.")}</p>}
        </div>
        {error && <p role="alert" className="ui-caption">{error}</p>}
        <UiButton variant="ghost" size="sm" className="justify-start" aria-label={tr("Manage favorites")} onClick={() => { setEditing(null); setName(current.prefix || current.bucket); setOpen(true); }}>{compact ? <MoreIcon className="h-4 w-4" /> : tr("Pin location")}</UiButton>
      </>}
    </div>}
    {open && <Modal title={tr("Favorites")} onClose={() => { if (!busy) setOpen(false); }}>
      {!accountUser ? <p>{tr("Synchronization requires a UI account. Temporary S3 sessions cannot save favorites to an account.")}</p> : <div className="space-y-3">
        <p className="ui-caption">{import.meta.env.MODE === "demo" ? tr("Demo: saved locally for this identity.") : tr("Personal to your account, synchronized across browsers.")} Saved in the {current.surface} workspace.</p>
        <UiInput label={editing ? tr("Rename saved item") : tr("Name")} value={name} maxLength={120} onChange={event => setName(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          {editing ? <><UiButton disabled={busy || !name.trim()} onClick={() => void mutate(() => saveBrowserFavorite({ ...browserFavoriteInput(editing), name }, editing))}>{tr("Save name")}</UiButton><UiButton onClick={() => setEditing(null)}>{tr("Cancel editing")}</UiButton></> : <>
            <UiButton disabled={busy || !name.trim() || !current.bucket || !current.context} onClick={() => void mutate(() => saveBrowserFavorite({ ...current, name }))}>{tr("Pin location")}</UiButton>
          </>}
          <UiButton disabled={busy} onClick={() => void reload()}>{tr("Refresh")}</UiButton>
        </div>
        {error && <p role="alert">{error}</p>}
        <ul className="max-h-80 space-y-3 overflow-y-auto">{favorites.map(favorite => <li key={favorite.id} className="rounded border border-[var(--ui-border)] p-2 space-y-1">
          <UiButton disabled={busy} onClick={() => void apply(favorite)}>★ {favorite.name}</UiButton>
          <p className="ui-caption break-all">{favorite.context} · {favorite.bucket}/{favorite.prefix}</p>
          {unavailable[favorite.id] && <p role="status" className="ui-caption">Unavailable: {unavailable[favorite.id]}</p>}
          <div className="flex flex-wrap gap-2">
            <UiButton size="sm" disabled={busy} onClick={() => { setEditing(favorite); setName(favorite.name); }}>{tr("Rename")}</UiButton>
            <UiButton size="sm" disabled={busy} onClick={() => void mutate(() => deleteBrowserFavorite(favorite))}>{tr("Remove")}</UiButton>
          </div>
        </li>)}</ul>
        {!favorites.length && <p className="ui-caption">{tr("No saved items in this workspace.")}</p>}
      </div>}
    </Modal>}
  </>;
}
