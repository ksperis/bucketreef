import type { User } from "../api/users";
import type { DemoState, DemoBucket } from "./state";
import { personaIds, type Persona } from "./state";
import type { S3Account } from "../api/accounts";
import type { DemoSpace } from "./state";

export type DemoRequest = { state: DemoState; url: URL; path: string; method: string; body: Record<string, unknown>; request: Request; persona: Persona; user: User };
export class DemoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-BucketReef-Demo": "local" } });
}
export function done(): Response { return new Response(null, { status: 204 }); }
export function required<T>(value: T | null | undefined, message = "Demo resource not found"): T {
  if (value === undefined || value === null) throw new DemoError(404, message);
  return value;
}
export function textField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new DemoError(422, `${key} is required`);
  return value.trim();
}
export function resolveDemoAccountGrant(state: DemoState, account: S3Account, userId: number) {
  const direct = account.user_links.find(link => link.user_id === userId);
  const inherited = account.group_links.flatMap(link => {
    const group = state.groups.find(candidate => candidate.id === link.group_id && candidate.user_details?.some(user => user.id === userId));
    return group ? [{ kind: "group" as const, group, link }] : [];
  });
  const sources = [
    ...(direct ? [{ kind: "direct" as const, link: direct }] : []),
    ...inherited,
  ];
  const grants = sources.map(source => source.link);
  return {
    manager_role: grants.some(l => l.manager_role === "account_administrator") ? "account_administrator" as const : null,
    portal_role: grants.some(l => l.portal_role === "portal_manager") ? "portal_manager" as const : grants.some(l => l.portal_role === "portal_user") ? "portal_user" as const : null,
    sources,
  };
}
export function accountGrant(c: DemoRequest, account: S3Account, userId = c.user.id) {
  const { manager_role, portal_role } = resolveDemoAccountGrant(c.state, account, userId);
  return { manager_role, portal_role };
}
export function spaceRole(c: DemoRequest, space: DemoSpace) {
  const account = required(c.state.accounts.find(a => a.id === space.accountId));
  if (accountGrant(c, account).portal_role === "portal_manager") return "Manager";
  if (space.owner_user_id === c.user.id) return "Owner";
  if (space.visibility === "private") return null;
  return space.shares.find(s => s.user_id === c.user.id)?.role ?? (space.share_scope === "account" ? space.account_member_role ?? "Viewer" : null);
}
export function scopedAccount(c: DemoRequest) {
  const raw = c.url.searchParams.get("account_id") ?? c.url.searchParams.get("ctx");
  if (!raw) throw new DemoError(422, "An explicit account context is required in the demo");
  const id = Number(raw.replace(/^(?:portal-)?(?:account-|acc-)?/, ""));
  const account = required(c.state.accounts.find(a => a.id === id || a.rgw_account_id === raw));
  if (c.persona === "manager" && !accountGrant(c, account).manager_role) throw new DemoError(403, "This account is not linked to the demo manager");
  if ((c.persona === "member" || c.persona === "project-manager") && !accountGrant(c, account).portal_role) throw new DemoError(403, "This project is not linked to the selected demo identity");
  return account;
}
export function scopedBucket(c: DemoRequest, name: string, endpointId?: number): DemoBucket {
  const bucket = required(c.state.buckets.find(b => b.name === decodeURIComponent(name)));
  if (endpointId !== undefined) {
    if (bucket.endpointId !== endpointId) throw new DemoError(404, "Bucket not found on this endpoint");
  } else if (bucket.accountId !== scopedAccount(c).id) throw new DemoError(404, "Bucket not found in this context");
  return bucket;
}
export function page<T>(items: T[], url: URL) {
  const search = (url.searchParams.get("search") ?? url.searchParams.get("query") ?? "").toLowerCase();
  let matches = search ? items.filter(item => JSON.stringify(item).toLowerCase().includes(search)) : [...items];
  const sort = url.searchParams.get("sort_by");
  if (sort) matches = matches.sort((a, b) => String((a as Record<string, unknown>)[sort] ?? "").localeCompare(String((b as Record<string, unknown>)[sort] ?? "")) * (url.searchParams.get("sort_dir") === "desc" ? -1 : 1));
  const size = Math.max(1, Math.min(Number(url.searchParams.get("page_size")) || 50, 1000));
  const current = Math.max(1, Number(url.searchParams.get("page")) || 1);
  return { items: matches.slice((current - 1) * size, current * size), total: matches.length, page: current, page_size: size, has_next: current * size < matches.length };
}
export function listing(items: unknown[], c: DemoRequest): Response {
  const data = page(items, c.url);
  return c.path.endsWith("/stream") ? streamResult(data) : json(data);
}
function streamResult(value: unknown): Response {
  return new Response(`event: result\ndata: ${JSON.stringify(value)}\n\n`, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}
export function currentUser(state: DemoState, persona: Persona): User { return required(state.users.find(u => u.id === personaIds[persona])); }
export function safeFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !/password|secret|token|credentials/i.test(key)));
}
