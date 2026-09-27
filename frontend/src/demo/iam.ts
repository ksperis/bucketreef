import type { AccessKey } from "../api/managerIamUsers";
import type { IamPolicy, InlinePolicy } from "../api/managerIamPolicies";
import { DemoError, done, json, required, scopedAccount, textField, type DemoRequest } from "./http";
import type { DemoIam } from "./state";

export function generatedKey(c: DemoRequest): AccessKey {
  return { access_key_id: `DEMO${String(c.state.nextId++).padStart(16, "0")}`, status: "Active", created_at: new Date().toISOString() };
}
export function keyActions(c: DemoRequest, iam: DemoIam, owner: string, keyId?: string, ceph = false): Response | undefined {
  const keys = iam.keys[owner] ?? (iam.keys[owner] = []);
  const view = (key: AccessKey) => ceph ? { access_key: key.access_key_id, status: key.status, created_at: key.created_at, is_active: key.status === "Active", user: owner } : { ...key, is_active: key.status === "Active", is_ui_managed: false, deletable: true };
  if (c.method === "GET" && !keyId) return json(keys.map(view));
  if (c.method === "POST" && !keyId) {
    if (keys.length >= 3) throw new DemoError(409, "This demo identity already has three keys");
    const key = generatedKey(c); keys.push(key);
    return json({ ...view(key), [ceph ? "secret_key" : "secret_access_key"]: "DEMO-ONLY-NOT-A-REAL-SECRET-DO-NOT-USE" }, 201);
  }
  const key = keyId ? required(keys.find(k => k.access_key_id === decodeURIComponent(keyId))) : undefined;
  if (key && c.method === "PUT") { key.status = c.body.active ? "Active" : "Inactive"; return json(view(key)); }
  if (key && c.method === "DELETE") { iam.keys[owner] = keys.filter(k => k !== key); return done(); }
  return undefined;
}

export function iam(c: DemoRequest): Response | undefined {
  const portalKeys = c.path.match(/^\/portal\/access-keys(?:\/([^/]+)(?:\/status)?)?$/);
  const cephKeys = c.path.match(/^\/manager\/ceph\/keys(?:\/([^/]+)(?:\/status)?)?$/);
  const match = c.path.match(/^\/manager\/iam\/(users|groups|roles|policies)(?:\/([^/]+)(?:\/(keys|policies|inline-policies|users)(?:\/([^/]+)(?:\/status)?)?)?)?$/);
  if (!match && !portalKeys && !cephKeys) return undefined;
  const account = scopedAccount(c); const data = required(c.state.iam[account.id]);
  if (portalKeys || cephKeys) {
    const owner = portalKeys ? `portal-${c.user.id}` : "account-root";
    if (portalKeys && c.body.target_type === "external") throw new DemoError(403, "External key sharing is disabled in this demo");
    if (portalKeys && c.method === "GET" && !portalKeys[1]) return json({ iam_user: { iam_username: owner, arn: `arn:aws:iam::${account.rgw_account_id}:user/${owner}` }, s3_endpoint: account.storage_endpoint_url, force_path_style: true, access_keys: (data.keys[owner] ?? []).map(k => ({ ...k, is_active: k.status === "Active", deletable: true })), can_manage_access_keys: true, can_create_external_access: false, max_access_keys: 3 });
    return keyActions(c, data, owner, (portalKeys ?? cephKeys)![1]);
  }
  const segment = match![1] as "users" | "groups" | "roles" | "policies";
  const name = match![2] ? decodeURIComponent(match![2]) : undefined;
  const resource = match![3]; const resourceId = match![4] ? decodeURIComponent(match![4]) : undefined;
  const collection = data[segment];
  if (!name) {
    if (c.method === "GET") return json(collection.map(entity => ({ ...entity, has_keys: (data.keys[entity.name]?.length ?? 0) > 0 })));
    if (c.method === "POST") {
      const name = textField(c.body, "name"); if (collection.some(e => e.name === name)) throw new DemoError(409, "An IAM entity already has this name");
      const entity = { ...c.body, name, arn: `arn:aws:iam::${account.rgw_account_id}:${segment.slice(0, -1)}/${name}` };
      collection.push(entity);
      if (Array.isArray(c.body.inline_policies)) data.inline[`${segment}/${name}`] = c.body.inline_policies as InlinePolicy[];
      if (c.body.create_key) { const key = generatedKey(c); data.keys[name] = [key]; return json({ ...entity, access_key: { ...key, secret_access_key: "DEMO-ONLY-NOT-A-REAL-SECRET-DO-NOT-USE" } }); }
      return json(entity, 201);
    }
  }
  const entity = required(collection.find(e => e.name === name || e.arn === name));
  if (!resource) {
    if (c.method === "GET") return json(entity);
    if (c.method === "PUT") { Object.assign(entity, c.body); return json(entity); }
    if (c.method === "DELETE") { collection.splice(collection.findIndex(item => item.name === entity.name), 1); delete data.keys[entity.name]; delete data.inline[`${segment}/${name}`]; delete data.attachments[`${segment}/${name}`]; return done(); }
  }
  if (resource === "keys" && segment === "users") return keyActions(c, data, entity.name, resourceId);
  if (resource === "users" && segment === "groups") {
    if (c.method === "GET") return json(data.users.filter(u => u.groups?.includes(entity.name)));
    const user = required(data.users.find(u => u.name === (resourceId ?? c.body.name)));
    if (c.method === "POST") { user.groups = [...new Set([...(user.groups ?? []), entity.name])]; return json(user); }
    if (c.method === "DELETE") { user.groups = user.groups?.filter(g => g !== entity.name); return done(); }
  }
  const id = `${segment}/${entity.name}`;
  if (resource === "policies") {
    const list = data.attachments[id] ?? (data.attachments[id] = []);
    if (c.method === "GET") return json(list);
    if (c.method === "POST") { const policy = required(data.policies.find(p => p.arn === c.body.arn)); if (!list.some(p => p.arn === policy.arn)) list.push(policy); return json(policy); }
    if (c.method === "DELETE") { data.attachments[id] = list.filter(p => p.arn !== resourceId); return done(); }
  }
  if (resource === "inline-policies") {
    const list = data.inline[id] ?? (data.inline[id] = []);
    if (c.method === "GET") return json(list);
    if (c.method === "PUT" && resourceId) { const policy: InlinePolicy = { name: resourceId, document: required(c.body.document as IamPolicy["document"]) }; data.inline[id] = [...list.filter(p => p.name !== resourceId), policy]; return json(policy); }
    if (c.method === "DELETE") { data.inline[id] = list.filter(p => p.name !== resourceId); return done(); }
  }
  return undefined;
}
