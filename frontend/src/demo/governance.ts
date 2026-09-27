import type { User } from "../api/users";
import type { UiGroup } from "../api/groups";
import type { S3Account } from "../api/accounts";
import type { StorageEndpoint } from "../api/storageEndpoints";
import { bucketView, emptyIam, personaIds, tools } from "./state";
import { DemoError, done, json, page, required, safeFields, textField, type DemoRequest } from "./http";

function synchronizeLinks(c: DemoRequest, source: "users" | "accounts" | "groups") {
  const { state } = c;
  if (source === "users") for (const a of state.accounts) a.user_links = state.users.flatMap(u => (u.account_links ?? []).filter(l => l.account_id === a.id).map(l => ({ ...l, user_id: u.id, user_email: u.email, user_full_name: u.full_name })));
  if (source === "accounts") {
    for (const u of state.users) u.account_links = state.accounts.flatMap(a => a.user_links.filter(l => l.user_id === u.id).map(l => ({ ...l, account_id: a.id })));
    for (const g of state.groups) g.account_links = state.accounts.flatMap(a => a.group_links.filter(l => l.group_id === g.id).map(l => ({ ...l, account_id: a.id })));
  }
  if (source === "groups") for (const a of state.accounts) a.group_links = state.groups.flatMap(g => (g.account_links ?? []).filter(l => l.account_id === a.id).map(l => ({ ...l, group_id: g.id, group_name: g.name })));
  for (const u of state.users) u.group_details = state.groups.filter(g => g.user_details?.some(m => m.id === u.id)).map(g => ({ id: g.id, name: g.name }));
  for (const g of state.groups) g.account_details = state.accounts.filter(a => g.account_links?.some(l => l.account_id === a.id)).map(a => ({ id: a.id, name: a.name, rgw_account_id: a.rgw_account_id }));
}

function userGroups(c: DemoRequest, user: User, ids: unknown) {
  if (!Array.isArray(ids)) return;
  for (const group of c.state.groups) {
    group.user_details = (group.user_details ?? []).filter(u => u.id !== user.id);
    if (ids.includes(group.id)) group.user_details.push({ id: user.id, email: user.email, full_name: user.full_name, role: user.role });
  }
}

export function accountView(c: DemoRequest, a: S3Account): S3Account {
  const buckets = c.state.buckets.filter(b => b.accountId === a.id).map(bucketView);
  const endpoint = required(c.state.endpoints.find(e => e.id === a.storage_endpoint_id));
  return { ...a, storage_endpoint_name: endpoint.name, storage_endpoint_url: endpoint.endpoint_url,
    bucket_count: buckets.length, used_bytes: buckets.reduce((n, b) => n + (b.used_bytes ?? 0), 0),
    rgw_user_count: c.state.iam[a.id]?.users.length ?? 0, rgw_user_uids: c.state.iam[a.id]?.users.map(u => u.name) ?? [], rgw_topics: [], rgw_topic_count: 0 };
}

export function governance(c: DemoRequest): Response | undefined {
  const { path, method, state } = c; const body = safeFields(c.body);
  const userMatch = path.match(/^\/admin\/users(?:\/(\d+|minimal))?$/);
  if (userMatch) {
    const id = Number(userMatch[1]); const user = state.users.find(u => u.id === id);
    if (method === "GET") return json(userMatch[1] === "minimal" ? state.users : userMatch[1] ? required(user) : page(state.users, c.url));
    if (method === "POST" && !userMatch[1]) {
      const email = textField(body, "email"); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DemoError(422, "Enter a valid email address");
      if (state.users.some(u => u.email === email)) throw new DemoError(409, "This email already exists");
      const created: User = { ...body, id: state.nextId++, email, role: (body.role as User["role"]) ?? "ui_user", ui_language: "en", account_links: [], group_details: [], is_active: true, manager_tool_access: { ...tools } };
      created.account_links = (body.account_links as User["account_links"]) ?? [];
      state.users.push(created); userGroups(c, created, body.group_ids); synchronizeLinks(c, "users"); return json(created, 201);
    }
    if (method === "PUT" && user) { Object.assign(user, body, { manager_tool_access: { ...tools }, can_provision_managed_private_connections: false, can_access_storage_ops: false }); userGroups(c, user, body.group_ids); synchronizeLinks(c, "users"); return json(user); }
    if (method === "DELETE" && user) {
      if (Object.values(personaIds).includes(id)) throw new DemoError(409, "The five demo identities are reserved. Create another user to try deletion.");
      userGroups(c, user, []); state.users = state.users.filter(u => u.id !== id); synchronizeLinks(c, "users"); return done();
    }
  }
  const groupMatch = path.match(/^\/admin\/groups(?:\/(\d+|minimal))?$/);
  if (groupMatch) {
    let group = state.groups.find(g => g.id === Number(groupMatch[1]));
    if (method === "GET") return json(groupMatch[1] === "minimal" ? state.groups : groupMatch[1] ? required(group) : page(state.groups, c.url));
    if (method === "POST" && !groupMatch[1]) { group = { id: state.nextId++, name: textField(body, "name"), user_details: [], account_links: [] }; state.groups.push(group); }
    if ((method === "PUT" || method === "POST") && group) {
      Object.assign(group, body as Partial<UiGroup>);
      group.manager_tool_access = { ...tools }; group.can_provision_managed_private_connections = false; group.can_access_storage_ops = false;
      if (Array.isArray(body.user_ids)) group.user_details = state.users.filter(u => (body.user_ids as number[]).includes(u.id));
      synchronizeLinks(c, "groups"); return json(group);
    }
    if (method === "DELETE" && group) { state.groups = state.groups.filter(g => g !== group); synchronizeLinks(c, "groups"); return done(); }
  }
  const accountMatch = path.match(/^\/admin\/accounts(?:\/(\d+|minimal))?$/);
  if (accountMatch) {
    let account = state.accounts.find(a => a.id === Number(accountMatch[1]));
    if (method === "GET") return json(accountMatch[1] === "minimal" ? state.accounts.map(a => accountView(c, a)) : accountMatch[1] ? accountView(c, required(account)) : page(state.accounts.map(a => accountView(c, a)), c.url));
    if (method === "POST" && !accountMatch[1]) {
      const endpoint = required(state.endpoints.find(e => e.id === Number(body.storage_endpoint_id)));
      const id = state.nextId++;
      account = { id, name: textField(body, "name"), rgw_account_id: `RGW${String(id).padStart(17, "0")}`, user_links: [], group_links: [], tags: [],
        storage_endpoint_id: endpoint.id, storage_endpoint_name: endpoint.name, storage_endpoint_url: endpoint.endpoint_url,
        storage_endpoint_is_default: endpoint.is_default, storage_endpoint_capabilities: endpoint.capabilities ?? {}, allow_bucket_quota_management: true };
      state.accounts.push(account); state.iam[id] = emptyIam();
    }
    if ((method === "POST" || method === "PUT") && account) { Object.assign(account, body as Partial<S3Account>); synchronizeLinks(c, "accounts"); return json(accountView(c, account)); }
    if (method === "DELETE" && account) {
      if (state.buckets.some(b => b.accountId === account.id)) throw new DemoError(409, "Delete this account's buckets first");
      state.accounts = state.accounts.filter(a => a !== account); synchronizeLinks(c, "accounts"); return done();
    }
  }
  if (path === "/admin/storage-endpoints/meta" && method === "GET") return json({ managed_by_env: false });
  if (path === "/admin/storage-endpoints/detect-features") throw new DemoError(403, "Endpoint detection requires a real network connection. Configure this demo endpoint manually.");
  const endpointMatch = path.match(/^\/admin\/storage-endpoints(?:\/(\d+)(?:\/(tags|default))?)?$/);
  if (endpointMatch) {
    let endpoint = state.endpoints.find(e => e.id === Number(endpointMatch[1]));
    if (method === "GET") return json(endpointMatch[1] ? required(endpoint) : state.endpoints);
    if (method === "POST" && !endpointMatch[1]) { endpoint = { ...structuredClone(state.endpoints[0]), id: state.nextId++, name: textField(body, "name"), endpoint_url: textField(body, "endpoint_url"), is_default: false }; state.endpoints.push(endpoint); }
    if ((method === "PUT" || method === "POST") && endpoint) {
      Object.assign(endpoint, body as Partial<StorageEndpoint>);
      if (endpointMatch[2] === "default") for (const e of state.endpoints) e.is_default = e === endpoint;
      endpoint.updated_at = new Date().toISOString(); return json(endpoint);
    }
    if (method === "DELETE" && endpoint) {
      if (state.accounts.some(a => a.storage_endpoint_id === endpoint.id)) throw new DemoError(409, "This endpoint still has accounts");
      state.endpoints = state.endpoints.filter(e => e !== endpoint); return done();
    }
  }
  if (path === "/connections/storage-endpoints" && method === "GET") return json(state.endpoints);
  if (["/connections/validate-credentials", "/admin/s3-connections/validate-credentials"].includes(path) && method === "POST") return json({ ok: false, severity: "warning", code: "demo_declaration_only", message: "Demo declaration only. Credentials are discarded and no connection is attempted; you can still save this record." });
  const connectionMatch = path.match(/^\/(?:admin\/s3-connections|connections)(?:\/(\d+|minimal))?$/);
  if (connectionMatch) {
    const connection = state.connections.find(v => v.id === Number(connectionMatch[1]));
    if (method === "GET") return json(connectionMatch[1] === "minimal" || path === "/connections" ? state.connections : connectionMatch[1] ? required(connection) : page(state.connections, c.url));
    if (method === "POST" && !connectionMatch[1]) {
      const endpoint = state.endpoints.find(e => e.id === Number(body.storage_endpoint_id));
      const created: typeof state.connections[number] = { ...body, id: state.nextId++, name: textField(body, "name"), endpoint_url: endpoint?.endpoint_url ?? textField(body, "endpoint_url"), storage_endpoint_id: endpoint?.id, created_by_user_id: c.user.id, created_by_email: c.user.email, execution_status: "ready", user_count: 0, access_key_id: "DEMO_NOT_A_REAL_KEY", user_details: [], group_details: [], tags: [], is_active: true, is_shared: path.startsWith("/admin/"), created_at: new Date().toISOString() };
      state.connections.push(created); return json(created, 201);
    }
    if (method === "PUT" && connection) {
      Object.assign(connection, body, { access_key_id: "DEMO_NOT_A_REAL_KEY" });
      if (Array.isArray(body.user_ids)) connection.user_details = state.users.filter(u => (body.user_ids as number[]).includes(u.id));
      if (Array.isArray(body.group_ids)) connection.group_details = state.groups.filter(g => (body.group_ids as number[]).includes(g.id));
      connection.user_count = connection.user_details?.length ?? 0; return json(connection);
    }
    if (method === "DELETE" && connection) { state.connections = state.connections.filter(v => v !== connection); return done(); }
  }
  return undefined;
}
