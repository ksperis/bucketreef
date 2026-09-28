import type { BrowserPreset, BrowserPresetInput } from "../api/browserPresets";
import { DemoError, done, json, type DemoRequest } from "./http";

export function presets(c: DemoRequest): Response | undefined {
  const match = c.path.match(/^\/users\/me\/browser-presets(?:\/([^/]+))?$/);
  if (!match) return undefined;
  c.state.browserPresets ??= {};
  const items = c.state.browserPresets[c.user.id] ??= [];
  if (c.method === "GET") return json(items.filter(item => item.surface === (c.url.searchParams.get("surface") ?? "browser")));
  const previous = match[1] ? items.find(item => item.id === match[1]) : undefined;
  if (match[1] && !previous) throw new DemoError(404, "Saved view not found");
  if (previous && previous.revision !== Number(c.url.searchParams.get("revision"))) throw new DemoError(409, "Saved view changed. Refresh before editing.");
  if (c.method === "DELETE" && previous) { c.state.browserPresets[c.user.id] = items.filter(item => item !== previous); return done(); }
  if (c.method !== "POST" && c.method !== "PUT") throw new DemoError(405, "Unsupported saved view action");
  const input = c.body as BrowserPresetInput;
  if (!input.name || input.name.length > 120 || !input.context || !input.bucket) throw new DemoError(422, "A name and exact destination are required");
  if (!previous && items.length >= 500) throw new DemoError(409, "Saved items limit reached");
  const now = new Date().toISOString();
  const row: BrowserPreset = { name: input.name, kind: input.kind, surface: input.surface, workspace: input.workspace, context: input.context, bucket: input.bucket, prefix: input.prefix, view: input.view, id: previous?.id ?? crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, created_at: previous?.created_at ?? now, updated_at: now };
  if (previous) Object.assign(previous, row); else items.push(row);
  return json(row, previous ? 200 : 201);
}
