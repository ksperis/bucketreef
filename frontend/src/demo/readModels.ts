import type { CurrentSessionResponse } from "../api/auth";
import type { ExecutionContext, WorkspaceAccess } from "../api/executionContexts";
import type { ManagerTrafficStats, ManagerUsageTrendBaseline } from "../api/stats";
import type { UsageHistoryTrendPoint } from "../api/usageHistory";
import { bucketView, GiB, settings, type DemoState } from "./state";
import { accountView } from "./governance";
import { accountGrant, json, page, required, scopedAccount, type DemoRequest } from "./http";
import { buildDemoAccessAuditRows, listDemoS3Users } from "./accessAudit";
import snapshots from "./snapshots.json";

export type DemoStorageTrendBaseline = ManagerUsageTrendBaseline & {
  demo_storage_points: Pick<UsageHistoryTrendPoint, "period_start" | "used_bytes">[];
};

const snapshotPaths: Record<string, keyof typeof snapshots> = {
  "/admin/health/summary": "health-summary", "/admin/health/overview": "health-overview",
  "/admin/health/workspace-overview": "health-workspace-admin", "/manager/stats/endpoint-health": "manager-health",
  "/portal/endpoint-health": "portal-endpoint-health", "/manager/activity": "manager-activity",
  "/portal/activity": "portal-activity", "/portal/alerts": "portal-alerts",
  "/manager/stats/usage-trends": "manager-usage-trends", "/portal/usage-trends": "portal-usage-trends",
};

// A repeatable 90-day workload: quiet days, batch imports and occasional cleanup.
// Normalize it so the latest historical point matches the seeded inventory.
const storageActivity = [0];
for (let day = 1; day < 90; day++) {
  const dailyGrowth = [1.2, .6, 2.1, 1.5, .8, .1, 0][day % 7];
  const batchImport = day === 18 ? 10 : day === 43 ? 16 : day === 67 ? 12 : 0;
  const cleanup = day === 34 ? 8 : day === 76 ? 11 : 0;
  storageActivity.push(storageActivity[day - 1] + dailyGrowth + batchImport - cleanup);
}
const storageProgress = storageActivity.map(value => value / storageActivity[89]);

function historicalUsage(inventory: DemoState["snapshotInventory"], day: number) {
  return {
    used_bytes: Math.round(inventory.reduce((total, bucket) => total + bucket.bytes, 0) * (.45 + .55 * storageProgress[day])),
    used_objects: Math.round(inventory.reduce((total, bucket) => total + bucket.objects, 0) * (.7 + .3 * storageProgress[day])),
    bucket_count: Math.round(inventory.length * (.8 + .2 * day / 89)),
  };
}

function datedSnapshot(value: unknown, initializedAt: string): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    const date = new Date(Date.parse(value) + Date.parse(initializedAt) - Date.parse("2026-03-08T09:00:00Z"));
    return value.includes("T") ? date.toISOString() : date.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map(v => datedSnapshot(v, initializedAt));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, datedSnapshot(v, initializedAt)]));
  return value;
}
export function readModels(c: DemoRequest): Response | undefined {
  if (c.method !== "GET") return undefined;
  const { path, state, user, persona } = c;
  const admin = persona === "admin"; const ceph = persona === "ceph-admin";
  const endUser = persona === "member" || persona === "project-manager";
  if (path === "/auth/session") return json({ authenticated: true, user, session: null,
    auth_session: { id: `demo-${user.id}`, auth_type: "password", mfa_verified_at: null,
      idle_expires_at: "2099-01-01T00:00:00Z", absolute_expires_at: "2099-01-01T00:00:00Z" } } satisfies CurrentSessionResponse);
  if (path === "/users/me") return json(user);
  if (path === "/settings/general") return json(settings.general);
  if (path === "/settings/branding") return json(settings.branding);
  if (path === "/settings/runtime-surfaces") return json({ admin: true, manager: true, browser: true, portal: true, ceph_admin: true, storage_ops: false });
  if (path === "/admin/settings" || path === "/admin/settings/defaults") return json(settings);
  if (path === "/admin/settings/general-feature-locks") return json(Object.fromEntries(["manager_enabled", "ceph_admin_enabled", "storage_ops_enabled", "browser_enabled", "portal_enabled", "billing_enabled", "endpoint_status_enabled"].map(k => [k, { forced: true, source: "Static demo" }])));
  if (/^\/admin\/accounts\/\d+\/portal-settings$/.test(path)) return json({ effective: settings.portal, admin_override: {}, delegated_to_portal_managers: false, portal_collaborator_role_management_delegated: false, portal_collaborator_addition_delegated: false });
  if (path === "/settings/login") return json({ ...settings.general, endpoints: state.endpoints, login_logo_url: null });
  if (path === "/browser/settings") return json(settings.browser);
  if (["/auth/security/webauthn/credentials", "/auth/security/external-identities", "/auth/sessions", "/auth/api-tokens", "/admin/identity/sessions", "/admin/identity/link-requests", "/admin/settings/ldap/providers", "/admin/settings/oidc/providers", "/auth/oidc/providers", "/auth/ldap/providers"].includes(path)) return json([]);
  if (["/admin/settings/webhooks", "/admin/settings/webhooks/events"].includes(path)) return json([]);
  if (path === "/admin/onboarding") return json({ dismissed: true, complete: true, endpoint_configured: true, storage_access_configured: true });
  if (path === "/admin/navigation/pending-requests") return json({ identity_link_requests: 0, portal_requests: state.requests.filter(r => r.status === "pending").length });
  if (path === "/admin/audit/logs") return json({ logs: state.history.slice(-20).reverse().map((p, i) => ({ id: 800 - i, created_at: p.timestamp, user_email: state.users[i % 5].email, user_role: "ui_admin", scope: i % 2 ? "manager" : "admin", action: i % 2 ? "put_bucket_lifecycle" : "account.link_user", entity_type: i % 2 ? "bucket" : "account", entity_id: i % 2 ? "helios-documents" : "Helios Retail", account_id: 101, account_name: "Helios Retail", status: "success", message: "Historical demo activity", metadata: {} })), next_cursor: null });
  if (path === "/admin/access-audit" || path === "/admin/access-audit/export.csv") {
    let rows = buildDemoAccessAuditRows(state);
    const userId = Number(c.url.searchParams.get("user_id") || 0);
    const groupId = Number(c.url.searchParams.get("group_id") || 0);
    const targetId = Number(c.url.searchParams.get("target_id") || 0);
    const scope = c.url.searchParams.get("scope");
    const right = c.url.searchParams.get("right");
    const source = c.url.searchParams.get("source");
    if (userId) rows = rows.filter(row => row.principal.id === userId);
    if (groupId) rows = rows.filter(row => row.rights.some(right => right.sources.some(source => "group_id" in source && source.group_id === groupId)));
    if (targetId) rows = rows.filter(row => row.target.id === targetId);
    if (scope) rows = rows.filter(row => row.scope === scope);
    if (right) rows = rows.filter(row => row.rights.some(candidate => candidate.code === right));
    if (source) rows = rows.filter(row => row.rights.some(candidate => candidate.sources.some(candidateSource => candidateSource.kind === source)));
    if (path.endsWith(".csv")) return new Response("User,Account,Rights\n" + rows.map(r => [r.principal.email, r.target.name, r.rights.map(v => v.label).join("; ")].map(v => JSON.stringify(v)).join(",")).join("\n"), { headers: { "Content-Type": "text/csv" } });
    return json(page(rows, c.url));
  }
  if (path === "/me/workspace-access") return json({
    admin: { available: admin || ceph, context_count: 0 }, ceph_admin: { available: admin || ceph, context_count: 2 }, storage_ops: { available: false, context_count: 0 },
    manager: { available: persona === "manager", context_count: persona === "manager" ? state.accounts.length : 0 }, browser: { available: endUser, context_count: endUser ? 2 : 0 },
    portal: { available: endUser, context_count: endUser ? 2 : 0 }, default_workspace: admin ? "admin" : ceph ? "ceph-admin" : endUser ? "portal" : "manager",
  } satisfies WorkspaceAccess);
  if (path === "/me/execution-contexts") {
    const browser = c.url.searchParams.get("workspace") === "browser";
    const selected = state.accounts.filter(a => (browser ? accountGrant(c, a).portal_role : accountGrant(c, a).manager_role));
    return json(selected.map(a => ({ kind: browser ? "portal_account" : "account", id: String(a.id), display_name: a.name,
      tags: a.tags, endpoint_tags: [], manager_role: browser ? null : "account_administrator", portal_role: browser ? accountGrant(c, a).portal_role : null,
      rgw_account_id: a.rgw_account_id, endpoint_id: a.storage_endpoint_id, endpoint_name: a.storage_endpoint_name, endpoint_url: a.storage_endpoint_url,
      endpoint_provider: "ceph", endpoint_is_default: a.storage_endpoint_is_default, storage_endpoint_capabilities: a.storage_endpoint_capabilities,
      capabilities: { can_manage_iam: !browser, sts_capable: false, admin_api_capable: !browser },
    } satisfies ExecutionContext)));
  }
  if (path === "/manager/context") {
    const account = scopedAccount(c);
    return json({ access_mode: "admin", iam_identity: "account-root", manager_stats_enabled: true, manager_browser_enabled: true, manager_bucket_quota_enabled: true, manager_ceph_keys_enabled: true, manager_private_access_enabled: false, quota_max_size_gb: account.quota_max_size_gb, quota_max_objects: account.quota_max_objects, max_buckets: 100, max_users: 100, max_roles: 100, max_groups: 100 });
  }
  if (path === "/manager/iam/overview") { const data = required(state.iam[scopedAccount(c).id]); return json({ iam_users: data.users.length, iam_groups: data.groups.length, iam_roles: data.roles.length, iam_policies: data.policies.length, warnings: [] }); }
  if (path === "/users/me/notifications") { const items = state.notifications[user.id] ?? []; return json({ items, unread_count: items.filter(n => !n.read_at).length }); }
  if (path === "/admin/stats/summary") return json({ total_accounts: state.accounts.length, total_users: state.users.filter(u => u.role === "ui_user").length, total_admins: state.users.filter(u => u.role !== "ui_user").length, total_none_users: 0, total_active_sessions: 18, active_sessions_by_type: { ui: 15, s3: 3 }, total_s3_users: Object.values(state.iam).reduce((n, v) => n + v.users.length, 0), assigned_accounts: state.accounts.filter(a => a.user_links.length).length, unassigned_accounts: state.accounts.filter(a => !a.user_links.length).length, assigned_s3_users: 15, unassigned_s3_users: 0, total_endpoints: state.endpoints.length, total_ceph_endpoints: state.endpoints.length, total_other_endpoints: 0, total_connections: state.connections.length, total_shared_connections: state.connections.length, total_private_connections: 0 });
  const dashboardEndpoints = state.endpoints.filter(e => e.provider === "ceph" && e.service_identities?.some(identity => identity.kind === "supervision" && identity.status === "ready" && identity.credentials_configured) && (e.capabilities?.metrics || e.capabilities?.usage));
  if (path === "/admin/stats/dashboard/scope") return json({ endpoints: dashboardEndpoints.map(e => ({ endpoint_id: e.id, name: e.name, storage_enabled: !!e.capabilities?.metrics, traffic_enabled: !!e.capabilities?.usage })) });
  if (path === "/browser/sts") return json({ available: false, error: "Demo uses local files" });
  if (/^\/browser\/buckets\/[^/]+\/cors$/.test(path)) return json({ enabled: false, rules: [] });
  if (/^\/(?:ceph-admin\/endpoints\/\d+|manager)\/bucket-ui-tags$/.test(path)) return json({ definitions: [] });
  if (path === "/admin/tags") return json(state.endpoints[0].tags);
  if (path === "/admin/s3-users/minimal") return json(listDemoS3Users(state).map(({ id, name }) => ({ id, name })));
  if (path === "/admin/s3-users") return json(page(listDemoS3Users(state), c.url));
  const security = path.match(/^\/admin\/users\/(\d+)\/security$/);
  if (security) return json({ user_id: Number(security[1]), ...required(state.users.find(u => u.id === Number(security[1]))), has_local_password: true, passkey_required: false, passkeys: [], external_identities: [], sessions: [] });
  if (path.endsWith("/usage-trends") && (path.startsWith("/manager/") || path.startsWith("/portal/"))) {
    const account = scopedAccount(c); const inventory = state.snapshotInventory.filter(b => b.accountId === account.id);
    const prior: ManagerUsageTrendBaseline = { window: "month", label: "last 30 days · snapshot", period_start: state.history[59].timestamp.slice(0, 10), ...historicalUsage(inventory, 59), collected_at: state.history[59].timestamp };
    const storage: DemoStorageTrendBaseline = { ...prior, demo_storage_points: state.history.slice(59).map((p, i) => ({ period_start: p.timestamp, used_bytes: historicalUsage(inventory, 59 + i).used_bytes })) };
    return json({ storage, objects: prior, buckets: prior });
  }
  if (snapshotPaths[path]) return json(datedSnapshot(snapshots[snapshotPaths[path]], state.initializedAt));
  if (/^\/admin\/health\/(series|incidents|raw-checks|latency-overview|incidents-global)$/.test(path)) {
    const endpointId = Number(c.url.searchParams.get("endpoint_id")) || 11;
    const window = c.url.searchParams.get("window") ?? "week";
    const rows = state.history.slice(-(window === "day" ? 1 : window === "week" ? 7 : 90));
    const series = rows.map((p, i) => ({ timestamp: p.timestamp, status: i === 3 ? "degraded" : "up", latency_ms: (endpointId === 11 ? 80 : 205) + i % 17, http_status: 200, check_mode: "http" }));
    const base = { endpoint_id: endpointId, window, start: rows[0].timestamp, end: rows.at(-1)!.timestamp, generated_at: state.initializedAt };
    if (path.endsWith("series")) return json({ ...base, data_points: series.length, series, daily: series.map(p => ({ day: p.timestamp.slice(0, 10), ok_count: 95, degraded_count: 1, down_count: 0, avg_latency_ms: p.latency_ms, p95_latency_ms: p.latency_ms + 15 })) });
    if (path.endsWith("raw-checks")) { const checks = series.map(p => ({ ...p, checked_at: p.timestamp })); return json({ ...base, ...page(checks, c.url), checks: page(checks, c.url).items }); }
    if (path.endsWith("latency-overview")) return json({ ...base, endpoints: state.endpoints.map(e => ({ endpoint_id: e.id, name: e.name, endpoint_url: e.endpoint_url, status: e.id === 11 ? "up" : "degraded", checked_at: state.initializedAt, latency_ms: e.id === 11 ? 82 : 390, min_latency_ms: 72, avg_latency_ms: 105, max_latency_ms: 420, sample_count: 2160 })) });
    const incidents = snapshots["health-workspace-admin"].incidents;
    return json({ ...base, total: incidents.length, incidents: datedSnapshot(path.endsWith("incidents-global") ? incidents : incidents.filter(i => i.endpoint_id === endpointId), state.initializedAt) });
  }
  if (/^\/admin\/billing\/(summary|subjects|subject\/account\/\d+|export\.csv)$/.test(path) || path === "/portal/billing/me") {
    const summary = { month: c.url.searchParams.get("month") ?? state.initializedAt.slice(0, 7), storage_endpoint_id: Number(c.url.searchParams.get("endpoint_id")) || 11,
      usage: { bytes_in: 180 * GiB, bytes_out: 310 * GiB, ops_total: 2450890, ops_breakdown: { get: 1900000, put: 550890 } },
      storage: { avg_bytes: 820 * GiB, avg_gb_month: 820, total_objects: 384920 },
      coverage: { days_collected: 27, days_in_month: 30, coverage_ratio: .9 },
      cost: { currency: "EUR", storage_cost: 16.4, egress_cost: 6.2, ingress_cost: 0, requests_cost: 2.45, total_cost: 25.05, rate_card_name: "Demo Ceph internal rates" } };
    if (path.endsWith("summary")) return json(summary);
    if (path.endsWith("subjects")) return json(page(state.accounts.map((a, i) => ({ ...summary, subject_type: "account", subject_id: a.id, name: a.name, rgw_identifier: a.rgw_account_id, cost: { ...summary.cost, total_cost: 25.05 + i * 7 } })), c.url));
    if (path.endsWith(".csv")) return new Response("Account,Amount,Currency\n" + state.accounts.map(a => `${a.name},25.05,EUR`).join("\n"), { headers: { "Content-Type": "text/csv" } });
    const account = path === "/portal/billing/me" ? scopedAccount(c) : required(state.accounts.find(a => a.id === Number(path.split("/").at(-1))));
    return json({ ...summary, subject_type: "account", subject_id: account.id, name: account.name, daily: state.history.slice(-30).map(p => ({ day: p.timestamp.slice(0, 10), storage_bytes: 820 * GiB, bytes_in: p.bytes_in, bytes_out: p.bytes_out, ops_total: p.ops })) });
  }

  // Inventory is derived from the common model; the historical series is seeded once.
  const statsPaths = /^\/(?:admin\/(?:stats\/(?:storage|account|traffic|dashboard\/(?:storage|traffic))|usage-history(?:\/trends)?|usage-stats\/latest)|manager\/(?:stats\/(?:overview|traffic|usage-history-trends)|usage-stats\/latest|buckets\/[^/]+\/usage-stats)|portal\/(?:usage|traffic|usage-stats\/latest|storage-spaces\/[^/]+\/usage-stats)|browser\/usage-summary|ceph-admin\/endpoints\/\d+\/(?:metrics\/(?:storage|traffic)|(?:accounts|users)\/[^/]+\/metrics|usage-stats\/latest|buckets\/[^/]+\/usage-stats))$/;
  if (statsPaths.test(path) || path === "/portal/usage-history-trends") {
    const account = path.startsWith("/manager/") || path.startsWith("/portal/") || path.startsWith("/browser/") ? scopedAccount(c) : undefined;
    const eid = Number(path.match(/endpoints\/(\d+)/)?.[1] ?? c.url.searchParams.get("endpoint_id"));
    const scopeObject = path.match(/\/(buckets|storage-spaces)\/([^/]+)\/usage-stats$/);
    const scopeName = scopeObject?.[1] === "storage-spaces" ? state.spaces.find(s => s.id === decodeURIComponent(scopeObject[2]))?.bucketName : scopeObject ? decodeURIComponent(scopeObject[2]) : undefined;
    const dashboardKind = path.startsWith("/admin/stats/dashboard/") ? path.endsWith("/traffic") ? "usage" : "metrics" : undefined;
    const dashboardIds = dashboardEndpoints.filter(e => !dashboardKind || e.capabilities?.[dashboardKind]).map(e => e.id);
    const cache = { hit: true, expires_at: new Date(Date.parse(state.initializedAt) + 1800000).toISOString() };
    const coverage = { eligible_count: dashboardIds.length, contributing_count: dashboardIds.length, complete_count: dashboardIds.length, issues: [] };
    if (dashboardKind && dashboardIds.length === 0) return json(path.endsWith("/traffic")
      ? { window: "day", start: new Date(Date.parse(state.initializedAt) - 86400000).toISOString(), end: state.initializedAt, resolution: "hourly", data_points: 0, series: [], totals: { ops: null, success_ops: null, bytes_in: null, bytes_out: null, success_rate: null }, coverage, cache }
      : { generated_at: state.initializedAt, storage_totals: { bucket_count: null, used_bytes: null, object_count: null }, coverage, cache, measurements: Object.fromEntries(["bucket_count", "object_count", "used_bytes"].map(key => [key, { contributing_count: 0, complete_count: 0 }])) });
    const selected = state.buckets.filter(b => (!dashboardKind || dashboardIds.includes(b.endpointId)) && (!account || b.accountId === account.id) && (!eid || b.endpointId === eid) && (!scopeName || b.name === scopeName)).map(bucketView);
    const snapshot = state.snapshotInventory.filter(b => (!account || b.accountId === account.id) && (!eid || b.endpointId === eid) && (!scopeName || b.bucketName === scopeName));
    const bytes = selected.reduce((n, b) => n + (b.used_bytes ?? 0), 0), count = selected.reduce((n, b) => n + (b.object_count ?? 0), 0);
    if (path.endsWith("/traffic")) {
      const window = c.url.searchParams.get("window") ?? (dashboardKind ? "day" : "month");
      // The historical demo workload is global. Allocate it to the selected
      // endpoint inventory so excluded endpoints do not contribute traffic.
      const share = dashboardKind ? selected.length / Math.max(1, state.buckets.length) : 1;
      const series = state.history.slice(-(window === "day" ? 1 : window === "week" ? 7 : 90)).map(point => ({ ...point,
        bytes_in: Math.round(point.bytes_in * share), bytes_out: Math.round(point.bytes_out * share),
        ops: Math.round(point.ops * share), success_ops: Math.round(point.success_ops * share),
      }));
      const totals = series.reduce((t, p) => ({ bytes_in: t.bytes_in + p.bytes_in, bytes_out: t.bytes_out + p.bytes_out, ops: t.ops + p.ops, success_ops: t.success_ops + p.success_ops }), { bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0 });
      return json({ ...(dashboardKind ? { coverage, cache } : {}), window, start: dashboardKind ? new Date(Date.parse(state.initializedAt) - 86400000).toISOString() : series[0].timestamp, end: series.at(-1)!.timestamp, resolution: dashboardKind ? "hourly" : "daily", data_points: series.length, series, totals: { ...totals, success_rate: totals.success_ops / totals.ops }, bucket_rankings: selected.map((b, i) => ({ bucket: b.name, bytes_total: (40 + i) * GiB, bytes_in: (20 + i) * GiB, bytes_out: 20 * GiB, ops: 25000 + i * 1500, success_ops: 24980 + i * 1500, success_ratio: .999 })), user_rankings: [], request_breakdown: [{ group: "GetObject", bytes_in: 0, bytes_out: totals.bytes_out, ops: totals.ops / 2 }], category_breakdown: [{ category: "write", bytes_in: totals.bytes_in, bytes_out: 0, ops: totals.ops / 2 }] } satisfies ManagerTrafficStats);
    }
    if (path.endsWith("usage-history-trends") || path.endsWith("usage-history/trends")) {
      const subjects = new Set(snapshot.map(b => b.accountId)).size;
      const points = state.history.map((p, i) => ({ period_start: p.timestamp.slice(0, 10), ...historicalUsage(snapshot, i), subjects_count: subjects, samples_count: 24, collected_at: p.timestamp }));
      return json({ window: c.url.searchParams.get("window") ?? "month", granularity: "daily", available: true, points, summary: { total_records: points.length * subjects, points_count: points.length, subjects_count: subjects, latest_used_bytes: points.at(-1)!.used_bytes, latest_used_objects: points.at(-1)!.used_objects, latest_bucket_count: points.at(-1)!.bucket_count, latest_collected_at: state.initializedAt } });
    }
    if (path === "/admin/usage-history") { const records = state.history.flatMap((p, i) => state.accounts.map(a => ({ id: i * 10000 + a.id, granularity: "daily", period_start: p.timestamp, storage_endpoint_id: a.storage_endpoint_id, endpoint_name: a.storage_endpoint_name, subject_type: "account", subject_id: a.id, subject_name: a.name, ...historicalUsage(state.snapshotInventory.filter(b => b.accountId === a.id), i), quota_size_bytes: 500 * GiB, samples_count: 24, collected_at: p.timestamp })));
      return json({ ...page(records, c.url), summary: { total_records: records.length, subjects_count: 5, latest_collected_at: state.initializedAt } }); }
    if (path.endsWith("/usage") || path.endsWith("usage-summary")) return json({ available: true, source: "portal", label: account?.name, used_bytes: bytes, used_objects: count, object_count: count, quota_max_size_bytes: (account?.quota_max_size_gb ?? 500) * GiB, quota_max_objects: account?.quota_max_objects });
    if (path.includes("usage-stats")) {
      const aggregate = { scope_kind: "account", scope_id: String(account?.id ?? eid), scope_name: account?.name ?? "Demo Ceph", bucket_count: selected.length, buckets_with_snapshot: selected.length, missing_bucket_count: 0, partial_scan_count: 0, object_version_count: count + selected.length, current_version_count: count, noncurrent_version_count: selected.length, delete_marker_count: 0, total_bytes: bytes, current_bytes: bytes, noncurrent_bytes: 0, data_type_distribution: [{ key: "json", label: "JSON datasets", count: Math.max(0, count - selected.length * 3), bytes: bytes * .995, ratio_count: .975, ratio_bytes: .995 }, { key: "documents", label: "Documents and media", count: selected.length * 3, bytes: bytes * .005, ratio_count: .025, ratio_bytes: .005 }], storage_class_distribution: [{ key: "STANDARD", label: "Standard", count, bytes, ratio_count: 1, ratio_bytes: 1 }], size_distribution: [{ key: "large", label: "1 MiB – 1 GiB", count: count - selected.length * 4, bytes: bytes * .99, ratio_count: .967, ratio_bytes: .99 }], age_distribution: [{ key: "recent", label: "0 – 90 days", count, bytes, ratio_count: 1, ratio_bytes: 1 }], current_vs_noncurrent: [{ key: "current", label: "Current", count, bytes, ratio_count: .992, ratio_bytes: .999 }, { key: "noncurrent", label: "Previous", count: selected.length, bytes: 100 * selected.length, ratio_count: .008, ratio_bytes: .001 }], warnings: ["Historical demo snapshot; no scan is executed."], oldest_snapshot_at: state.initializedAt, newest_snapshot_at: state.initializedAt };
      return json(path.includes("/buckets/") || path.includes("/storage-spaces/") ? { snapshot: { ...aggregate, bucket_name: path.split("/").at(-2), scan_mode: "versions", version_listing_available: true, calculated_at: state.initializedAt } } : { aggregate });
    }
    return json({ ...(dashboardKind ? { coverage, cache, measurements: Object.fromEntries(["bucket_count", "object_count", "used_bytes"].map(key => [key, { contributing_count: dashboardIds.length, complete_count: dashboardIds.length }])) } : {}), total_accounts: state.accounts.length, total_users: state.users.length, total_admins: 2, total_s3_users: 15, total_buckets: selected.length, total_bytes: bytes, total_objects: count, bucket_count: selected.length, bucket_usage: selected,
      bucket_overview: { bucket_count: selected.length, non_empty_buckets: selected.filter(b => b.object_count).length, empty_buckets: selected.filter(b => !b.object_count).length, avg_bucket_size_bytes: bytes / (selected.length || 1), avg_objects_per_bucket: count / (selected.length || 1), largest_bucket: [...selected].sort((a, b) => (b.used_bytes ?? 0) - (a.used_bytes ?? 0))[0], most_objects_bucket: [...selected].sort((a, b) => (b.object_count ?? 0) - (a.object_count ?? 0))[0] },
      storage_totals: { used_bytes: bytes, object_count: count, bucket_count: selected.length, accounts_with_usage: state.accounts.length, owners_with_usage: state.accounts.length },
      account_usage: state.accounts.map(a => ({ account_id: String(a.id), account_name: a.name, ...accountView(c, a) })), owner_usage: state.accounts.map(a => ({ owner: a.rgw_account_id, used_bytes: accountView(c, a).used_bytes, bucket_count: accountView(c, a).bucket_count })), s3_user_usage: [], generated_at: state.initializedAt });
  }
  return undefined;
}
