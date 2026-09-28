import type { BrowserFavorite, BrowserFavoriteInput } from "../api/browserFavorites";
import { DemoError, done, json, type DemoRequest } from "./http";

export function favorites(c: DemoRequest): Response | undefined {
  const match = c.path.match(/^\/users\/me\/browser-favorites(?:\/([^/]+))?$/);
  if (!match) return undefined;
  c.state.browserFavorites ??= {};
  const items = c.state.browserFavorites[c.user.id] ??= [];
  if (c.method === "GET") return json(items.filter(item => item.surface === (c.url.searchParams.get("surface") ?? "browser")));
  const previous = match[1] ? items.find(item => item.id === match[1]) : undefined;
  if (match[1] && !previous) throw new DemoError(404, "Favorite not found");
  if (previous && previous.revision !== Number(c.url.searchParams.get("revision"))) throw new DemoError(409, "Favorite changed. Refresh before editing.");
  if (c.method === "DELETE" && previous) { c.state.browserFavorites[c.user.id] = items.filter(item => item !== previous); return done(); }
  if (c.method !== "POST" && c.method !== "PUT") throw new DemoError(405, "Unsupported favorite action");
  const input = c.body as BrowserFavoriteInput;
  if (Object.keys(input).some(key => !["name", "surface", "workspace", "context", "bucket", "prefix"].includes(key))) throw new DemoError(422, "Unknown favorite field");
  if (!input.name || input.name.length > 120 || !input.context || !input.bucket) throw new DemoError(422, "A name and exact destination are required");
  if (!previous && items.length >= 500) throw new DemoError(409, "Favorites limit reached");
  const now = new Date().toISOString();
  const row: BrowserFavorite = { name: input.name, surface: input.surface, workspace: input.workspace, context: input.context, bucket: input.bucket, prefix: input.prefix, id: previous?.id ?? crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, created_at: previous?.created_at ?? now, updated_at: now };
  if (previous) Object.assign(previous, row); else items.push(row);
  return json(row, previous ? 200 : 201);
}
