import type { CephAdminRgwAccountDetail } from "../api/cephAdminAccounts";
import type { CephAdminRgwUserDetail } from "../api/cephAdminUsers";
import { GiB } from "./state";
import { governance } from "./governance";
import { generatedKey, keyActions } from "./iam";
import { DemoError, json, listing, required, textField, type DemoRequest } from "./http";

export function ceph(c: DemoRequest): Response | undefined {
  if (c.path === "/ceph-admin/endpoints" && c.method === "GET") return json(c.state.endpoints);
  const access = c.path.match(/^\/ceph-admin\/endpoints\/(\d+)\/access$/);
  if (access && c.method === "GET") return json({ endpoint_id: Number(access[1]), can_admin: true, can_accounts: true, can_metrics: true, admin_warning: null });
  const match = c.path.match(/^\/ceph-admin\/endpoints\/(\d+)\/(accounts|users)(?:\/([^/]+)(?:\/(detail|config|keys)(?:\/([^/]+)(?:\/status)?)?)?)?$/);
  if (!match) return undefined;
  const endpoint = required(c.state.endpoints.find(e => e.id === Number(match[1])));
  const accounts = c.state.accounts.filter(a => a.storage_endpoint_id === endpoint.id);
  const id = match[3] ? decodeURIComponent(match[3]) : undefined;
  if (match[2] === "accounts") {
    const view = (a: typeof accounts[number]): CephAdminRgwAccountDetail => ({ account_id: a.rgw_account_id, account_name: a.name, email: a.email, max_users: 100, max_buckets: 100,
      bucket_count: c.state.buckets.filter(b => b.accountId === a.id).length, user_count: c.state.iam[a.id]?.users.length ?? 0,
      ...a.rgw, quota: { enabled: a.rgw?.quota?.enabled ?? true, max_size_bytes: (a.quota_max_size_gb ?? 0) * GiB, max_objects: a.quota_max_objects ?? -1 } });
    const updateAccount = (account: typeof accounts[number]) => {
      const body = c.body;
      for (const field of ["max_users", "max_buckets", "max_roles", "max_groups", "max_access_keys"]) if (field in body) account.rgw = { ...account.rgw, [field]: body[field] };
      if ("account_name" in body) account.name = String(body.account_name);
      if ("email" in body) account.email = String(body.email ?? "");
      if ("quota_max_size_bytes" in body) account.quota_max_size_gb = Number(body.quota_max_size_bytes) / GiB;
      if ("quota_max_objects" in body) account.quota_max_objects = Number(body.quota_max_objects);
      if ("quota_enabled" in body) account.rgw = { ...account.rgw, quota: { ...view(account).quota, enabled: Boolean(body.quota_enabled) } };
      if ("bucket_quota_enabled" in body) account.rgw = { ...account.rgw, bucket_quota: { enabled: Boolean(body.bucket_quota_enabled), max_size_bytes: Number(body.bucket_quota_max_size_bytes ?? -1), max_objects: Number(body.bucket_quota_max_objects ?? -1) } };
    };
    if (c.method === "GET") return id && id !== "stream" ? json(view(required(accounts.find(a => a.rgw_account_id === id)))) : listing(accounts.map(a => ({ ...view(a), quota_max_size_bytes: (a.quota_max_size_gb ?? 0) * GiB, quota_max_objects: a.quota_max_objects })), c);
    if (c.method === "POST" && !id) {
      const response = governance({ ...c, path: "/admin/accounts", body: { ...c.body, name: c.body.account_name, storage_endpoint_id: endpoint.id } });
      if (!response) return undefined;
      updateAccount(c.state.accounts.at(-1)!);
      return json({ account: view(c.state.accounts.at(-1)!) }, 201);
    }
    if (c.method === "PUT" && match[4] === "config") {
      const account = required(accounts.find(a => a.rgw_account_id === id));
      updateAccount(account);
      return json(view(account));
    }
  }
  if (match[2] === "users") {
    const users = accounts.flatMap(account => c.state.iam[account.id].users.map(user => ({ user, account })));
    const detail = ({ user, account }: typeof users[number]): CephAdminRgwUserDetail => ({ uid: `${account.id}:${user.name}`, display_name: user.name, account_id: account.rgw_account_id, account_name: account.name, email: `${user.name}@example.com`, suspended: false, max_buckets: 100, caps: [], keys: (c.state.iam[account.id].keys[user.name] ?? []).map(k => ({ access_key: k.access_key_id, status: k.status, is_active: k.status === "Active" })), ...user.rgw });
    const updateUser = (user: typeof users[number]["user"]) => {
      const body = c.body;
      for (const field of ["display_name", "email", "suspended", "max_buckets", "op_mask", "admin", "system", "account_root"]) if (field in body) user.rgw = { ...user.rgw, [field]: body[field] };
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
    if (match[4] === "keys") return keyActions(c, c.state.iam[selected.account.id], selected.user.name, match[5], true);
    if (c.method === "GET" && match[4] === "detail") return json(detail(selected));
    if (c.method === "PUT" && match[4] === "config") {
      updateUser(selected.user);
      return json(detail(selected));
    }
  }
  return undefined;
}
