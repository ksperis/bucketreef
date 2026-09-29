/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import client from "./client";
import type { BrowserWorkspaceSurface } from "./browserWorkspace";
export type BrowserFavoriteInput = { name: string; surface: BrowserWorkspaceSurface; workspace: BrowserWorkspaceSurface; context: string; bucket: string; prefix: string };
export type BrowserFavorite = BrowserFavoriteInput & { id: string; revision: number; created_at: string; updated_at: string };
const path = "/users/me/browser-favorites";
export async function listBrowserFavorites(surface: BrowserWorkspaceSurface) { return (await client.get<BrowserFavorite[]>(path, { params: { surface } })).data; }
export async function saveBrowserFavorite(payload: BrowserFavoriteInput, existing?: BrowserFavorite) {
  return existing ? (await client.put<BrowserFavorite>(`${path}/${existing.id}`, payload, { params: { revision: existing.revision } })).data : (await client.post<BrowserFavorite>(path, payload)).data;
}
export async function deleteBrowserFavorite(favorite: BrowserFavorite) { await client.delete(`${path}/${favorite.id}`, { params: { revision: favorite.revision } }); }
