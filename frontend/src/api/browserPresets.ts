/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import client from "./client";
import type { BrowserWorkspaceSurface } from "./browserWorkspace";
import type { BrowserSortKey } from "../features/browser/browserObjectTableModel";

export type BrowserPresetView = {
  query: string; scope: "prefix" | "bucket"; recursive: boolean; exact_match: boolean; case_sensitive: boolean;
  item_type: "all" | "file" | "folder"; storage_class: string; sort_key: BrowserSortKey; sort_direction: "asc" | "desc"; columns: string[];
  file_filters: { min_size?: number | null; max_size?: number | null; modified_after?: string | null; modified_before?: string | null; extensions?: string[] };
};
export type BrowserPresetInput = { name: string; kind: "favorite" | "view"; surface: BrowserWorkspaceSurface; workspace: BrowserWorkspaceSurface; context: string; bucket: string; prefix: string; view: BrowserPresetView | null };
export type BrowserPreset = BrowserPresetInput & { id: string; revision: number; created_at: string; updated_at: string };
const path = "/users/me/browser-presets";
export async function listBrowserPresets(surface: BrowserWorkspaceSurface) { return (await client.get<BrowserPreset[]>(path, { params: { surface } })).data; }
export async function saveBrowserPreset(payload: BrowserPresetInput, existing?: BrowserPreset) {
  return existing ? (await client.put<BrowserPreset>(`${path}/${existing.id}`, payload, { params: { revision: existing.revision } })).data : (await client.post<BrowserPreset>(path, payload)).data;
}
export async function deleteBrowserPreset(preset: BrowserPreset) { await client.delete(`${path}/${preset.id}`, { params: { revision: preset.revision } }); }
export function browserPresetInput(preset: BrowserPreset): BrowserPresetInput {
  const { name, kind, surface, workspace, context, bucket, prefix, view } = preset;
  return { name, kind, surface, workspace, context, bucket, prefix, view };
}
