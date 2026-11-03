import type { CephAdminRgwAccountDetail } from "../api/cephAdminAccounts";
import type { CephAdminEndpoint, CephAdminEndpointAccess } from "../api/cephAdminEndpoints";
import type { CephAdminRgwUserDetail } from "../api/cephAdminUsers";
import type { MultisiteObservation, MultisiteOverview, MultisiteTopology } from "../api/cephMultisite";
import { GiB } from "./state";
import { governance } from "./governance";
import { generatedKey, keyActions } from "./iam";
import { DemoError, json, listing, required, textField, type DemoRequest } from "./http";

function multisiteObservation<T>(
  c: DemoRequest,
  endpointId: number,
  operation: string,
  data: T,
): MultisiteObservation<T> {
  const endpoint = required(c.state.endpoints.find(candidate => candidate.id === endpointId));
  return {
    availability: "available",
    data,
    collected_at: c.state.initializedAt,
    last_success_at: c.state.initializedAt,
    stale: false,
    reason_code: null,
    provenance: {
      endpoint_id: endpoint.id,
      realm_id: endpoint.realm_id ?? null,
      local_zone_id: endpoint.zone_id ?? null,
      source_zone_id: null,
      operation,
      http_status: 200,
      duration_ms: 12,
      collection_id: "demo-multisite",
    },
  };
}

function multisiteTopology(c: DemoRequest, endpointId: number): MultisiteTopology {
  const endpoint = required(c.state.endpoints.find(candidate => candidate.id === endpointId));
  const peers = c.state.endpoints.filter(candidate => candidate.realm_id === endpoint.realm_id);
  const realmId = endpoint.realm_id ?? "demo-realm";
  const localZoneId = endpoint.zone_id ?? "demo-zone";
  const zones = peers.map(candidate => ({
    id: candidate.zone_id ?? `demo-zone-${candidate.id}`,
    name: candidate.name,
    zonegroup_id: candidate.zonegroup_id ?? "demo-zonegroup",
    zonegroup_name: "Demo zonegroup",
    metadata_master: candidate.is_default,
    read_only: false,
    sync_from_all: true,
    sync_from: [],
    policy_requires_confirmation: false,
    endpoints: [{ id: candidate.id, name: candidate.name, diagnostic: true }],
    diagnostic_endpoint_id: candidate.id,
  }));
  return {
    local_zone: multisiteObservation(c, endpointId, "zone", {
      id: localZoneId,
      name: endpoint.name,
      realm_id: realmId,
      placements: [{ name: "default-placement", storage_classes: ["STANDARD"] }],
      storage_classes: ["STANDARD"],
    }),
    period: multisiteObservation(c, endpointId, "period", {
      id: "demo-period",
      realm_id: realmId,
      epoch: "1",
      realm_epoch: "1",
      master_zone: zones.find(zone => zone.metadata_master)?.id ?? localZoneId,
      zones,
      details: {},
    }),
    realm: multisiteObservation(c, endpointId, "realm", { id: realmId, name: "Demo realm" }),
    configured: true,
    configuration_reason: null,
  };
}

export function ceph(c: DemoRequest): Response | undefined {
  if (c.path === "/ceph-admin/endpoints" && c.method === "GET") {
    const endpoints: CephAdminEndpoint[] = c.state.endpoints.map(endpoint => ({
      id: endpoint.id,
      name: endpoint.name,
      endpoint_url: endpoint.endpoint_url,
      admin_endpoint: endpoint.features.admin.endpoint ?? null,
      region: endpoint.region ?? null,
      is_default: endpoint.is_default,
      capabilities: endpoint.capabilities,
      tags: endpoint.tags,
    }));
    return json(endpoints);
  }
  const access = c.path.match(/^\/ceph-admin\/endpoints\/(\d+)\/access$/);
  if (access && c.method === "GET") {
    const probed = c.url.searchParams.get("probe") === "true";
    const response: CephAdminEndpointAccess = {
      endpoint_id: Number(access[1]),
      can_admin: true,
      can_accounts: true,
      can_metrics: true,
      admin_warning: null,
      accounts_warning: null,
      active_rgw_uid: null,
      active_rgw_tenant: null,
      availability_status: probed ? "available" : "unknown",
      availability_checked_at: probed ? c.state.initializedAt : null,
    };
    return json(response);
  }
  const multisite = c.path.match(/^\/ceph-admin\/endpoints\/(\d+)\/multisite\/(state|topology|overview)$/);
  if (multisite && c.method === "GET") {
    const endpointId = Number(multisite[1]);
    const endpoint = required(c.state.endpoints.find(candidate => candidate.id === endpointId));
    if (multisite[2] === "state") {
      return json({
        status: endpoint.realm_id && endpoint.zone_id ? "active" : "inactive",
        realm_id: endpoint.realm_id ?? null,
        local_zone_id: endpoint.zone_id ?? null,
        checked_at: c.state.initializedAt,
        availability: endpoint.realm_id && endpoint.zone_id ? "available" : "not_applicable",
        reason_code: null,
      });
    }
    const topology = multisiteTopology(c, endpointId);
    if (multisite[2] === "topology") return json(topology);
    const overview: MultisiteOverview = {
      topology,
      metadata: [],
      data: [],
      uncollected: [],
      next_offset: null,
    };
    return json(overview);
  }
  const match = c.path.match(/^\/ceph-admin\/endpoints\/(\d+)\/(accounts|users)(?:\/([^/]+)(?:\/(detail|config|keys)(?:\/([^/]+)(?:\/(status))?)?)?)?$/);
  if (!match) return undefined;
  const endpoint = required(c.state.endpoints.find(e => e.id === Number(match[1])));
  const accounts = c.state.accounts.filter(a => a.storage_endpoint_id === endpoint.id);
  const id = match[3] ? decodeURIComponent(match[3]) : undefined;
  if (match[2] === "accounts") {
    const view = (a: typeof accounts[number]): CephAdminRgwAccountDetail => ({
      account_id: a.rgw_account_id,
      tenant: null,
      account_name: a.name,
      email: a.email,
      max_users: 100,
      max_buckets: 100,
      max_roles: null,
      max_groups: null,
      max_access_keys: null,
      bucket_count: c.state.buckets.filter(b => b.accountId === a.id).length,
      user_count: c.state.iam[a.id]?.users.length ?? 0,
      bucket_quota: null,
      ...a.rgw,
      quota: {
        enabled: a.rgw?.quota?.enabled ?? true,
        max_size_bytes: (a.quota_max_size_gb ?? 0) * GiB,
        max_objects: a.quota_max_objects ?? -1,
      },
    });
    const updateAccount = (account: typeof accounts[number]) => {
      const body = c.body;
      for (const field of ["max_users", "max_buckets", "max_roles", "max_groups", "max_access_keys"]) if (field in body) account.rgw = { ...account.rgw, [field]: body[field] };
      if ("account_name" in body) account.name = String(body.account_name);
      if ("email" in body) account.email = String(body.email ?? "");
      if ("quota_max_size_bytes" in body) account.quota_max_size_gb = Number(body.quota_max_size_bytes) / GiB;
      if ("quota_max_objects" in body) account.quota_max_objects = Number(body.quota_max_objects);
      if ("quota_enabled" in body) {
        const quota = view(account).quota;
        account.rgw = {
          ...account.rgw,
          quota: {
            enabled: Boolean(body.quota_enabled),
            max_size_bytes: quota?.max_size_bytes ?? null,
            max_objects: quota?.max_objects ?? null,
          },
        };
      }
      if ("bucket_quota_enabled" in body) account.rgw = { ...account.rgw, bucket_quota: { enabled: Boolean(body.bucket_quota_enabled), max_size_bytes: Number(body.bucket_quota_max_size_bytes ?? -1), max_objects: Number(body.bucket_quota_max_objects ?? -1) } };
    };
    if (c.method === "GET") return id && id !== "stream" ? json(view(required(accounts.find(a => a.rgw_account_id === id)))) : listing(accounts.map(a => ({
      ...view(a),
      quota_max_size_bytes: (a.quota_max_size_gb ?? 0) * GiB,
      quota_max_objects: a.quota_max_objects,
      used_bytes: a.used_bytes,
      object_count: a.used_objects,
    })), c);
    if (c.method === "POST" && !id) {
      const response = governance({ ...c, path: "/admin/accounts", body: { ...c.body, name: c.body.account_name, storage_endpoint_id: endpoint.id } });
      if (!response) return undefined;
      updateAccount(c.state.accounts.at(-1)!);
      return json({ account: view(c.state.accounts.at(-1)!) }, 201);
    }
    if (c.method === "PATCH" && match[4] === "config") {
      const account = required(accounts.find(a => a.rgw_account_id === id));
      updateAccount(account);
      return json(view(account));
    }
  }
  if (match[2] === "users") {
    const users = accounts.flatMap(account => c.state.iam[account.id].users.map(user => ({ user, account })));
    const detail = ({ user, account }: typeof users[number]): CephAdminRgwUserDetail => ({
      uid: `${account.id}:${user.name}`,
      tenant: user.rgw?.tenant ?? null,
      display_name: user.rgw?.display_name ?? user.name,
      email: user.rgw?.email ?? `${user.name}@example.com`,
      account_id: user.rgw?.account_id ?? account.rgw_account_id,
      account_name: user.rgw?.account_name ?? account.name,
      suspended: user.rgw?.suspended ?? false,
      admin: user.rgw?.admin ?? null,
      system: user.rgw?.system ?? null,
      account_root: user.rgw?.account_root ?? null,
      max_buckets: user.rgw?.max_buckets ?? 100,
      op_mask: user.rgw?.op_mask ?? null,
      default_placement: user.rgw?.default_placement ?? null,
      default_storage_class: user.rgw?.default_storage_class ?? null,
      caps: user.rgw?.caps ?? [],
      quota: user.rgw?.quota ?? null,
      keys: (c.state.iam[account.id].keys[user.name] ?? []).map(k => ({
        access_key: k.access_key_id,
        status: k.status,
        is_active: k.status === "Active",
        created_at: k.created_at,
        user: user.name,
        subuser: null,
        is_private_access_managed: k.is_private_access_managed,
        managed_connection_id: k.managed_connection_id,
      })),
    });
    const updateUser = (user: typeof users[number]["user"]) => {
      const body = c.body;
      for (const field of ["display_name", "email", "suspended", "max_buckets", "op_mask", "system", "account_root"]) if (field in body) user.rgw = { ...user.rgw, [field]: body[field] };
      if ("quota_enabled" in body) user.rgw = { ...user.rgw, quota: { enabled: Boolean(body.quota_enabled), max_size_bytes: Number(body.quota_max_size_bytes ?? -1), max_objects: Number(body.quota_max_objects ?? -1) } };
      if (body.caps && typeof body.caps === "object") {
        const caps = body.caps as { mode?: string; values: string[] };
        const previous = user.rgw?.caps ?? [];
        user.rgw = { ...user.rgw, caps: caps.mode === "add" ? [...new Set([...previous, ...caps.values])] : caps.mode === "remove" ? previous.filter(v => !caps.values.includes(v)) : caps.values };
      }
    };
    if (c.method === "GET" && (!id || id === "stream")) return listing(users.map(item => ({ ...detail(item), full_name: detail(item).display_name })), c);
    if (c.method === "POST" && !id) {
      const account = required(accounts.find(a => a.rgw_account_id === c.body.account_id) ?? accounts[0]);
      const name = textField(c.body, "uid");
      if (c.state.iam[account.id].users.some(u => u.name === name)) throw new DemoError(409, "This RGW user already exists");
      const user = { name, groups: [], rgw: { display_name: String(c.body.display_name ?? name), email: String(c.body.email ?? ""), suspended: Boolean(c.body.suspended) } };
      c.state.iam[account.id].users.push(user);
      updateUser(user);
      const key = c.body.generate_key ? generatedKey(c) : null;
      if (key) c.state.iam[account.id].keys[name] = [key];
      return json({ detail: detail({ user, account }), generated_key: key ? { access_key: key.access_key_id, secret_key: "DEMO-ONLY-NOT-A-REAL-SECRET-DO-NOT-USE" } : null }, 201);
    }
    const selected = required(users.find(item => `${item.account.id}:${item.user.name}` === id || item.user.name === id));
    if (match[4] === "keys") return keyActions(c, c.state.iam[selected.account.id], selected.user.name, {
      keyId: match[5],
      responseShape: "ceph-admin",
      statusRoute: match[6] === "status",
    });
    if (c.method === "GET" && match[4] === "detail") return json(detail(selected));
    if (c.method === "PATCH" && match[4] === "config") {
      updateUser(selected.user);
      return json(detail(selected));
    }
  }
  return undefined;
}
