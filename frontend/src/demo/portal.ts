import type { PortalAdminRequest } from "../api/portalRequests";
import type { PortalStorageSpaceShare } from "../api/portalSharing";
import { bucketView, newBucket, settings, type DemoSpace } from "./state";
import { accountGrant, spaceRole, DemoError, done, json, required, scopedAccount, textField, type DemoRequest } from "./http";

function spaceView(c: DemoRequest, s: DemoSpace) {
  const bucket = required(c.state.buckets.find(b => b.name === s.bucketName));
  const role = required(spaceRole(c, s), "This space is not shared with the selected identity");
  const { accountId: _account, bucketName: _bucket, shares: _shares, ...view } = s;
  return { ...view, ...Object.fromEntries(Object.entries(bucketView(bucket)).filter(([key]) => ["used_bytes", "object_count", "quota_max_size_bytes", "quota_max_objects"].includes(key))),
    role, can_browse: true, can_delete: role === "Owner" || role === "Manager", can_take_ownership: false,
    collaborator_count: s.shares.length, collaborators: s.shares.map(share => ({ user_id: share.user_id, email: share.email, role: share.role })) };
}

export function portal(c: DemoRequest): Response | undefined {
  const { path, method, state, body } = c;
  const requestMatch = path.match(/^\/(portal\/requests|admin\/portal-requests)(?:\/(\d+)\/(approve|reject|messages))?$/);
  if (requestMatch) {
    const admin = requestMatch[1].startsWith("admin");
    const account = admin ? undefined : scopedAccount(c);
    if (method === "GET" && !requestMatch[2]) {
      const status = c.url.searchParams.get("status"), type = c.url.searchParams.get("request_type"), aid = account?.id ?? Number(c.url.searchParams.get("account_id"));
      return json(state.requests.filter(r => (!aid || r.account_id === aid) && (!status || status === "all" || r.status === status) && (!type || r.request_type === type)).sort((a, b) => b.id - a.id));
    }
    if (method === "POST" && !admin && !requestMatch[2]) {
      const type = textField(body, "request_type") as PortalAdminRequest["request_type"];
      if (!["portal_user_access", "portal_user_removal", "account_quota_change"].includes(type)) throw new DemoError(403, "Global and project settings stay locked in this demo. Try a user-access or quota request.");
      const now = new Date().toISOString(); const { request_type: _type, ...payload } = body;
      const request: PortalAdminRequest = { id: state.nextId++, account_id: account!.id, account_name: account!.name, request_type: type, status: "pending", payload, requester_user_id: c.user.id, requester_email: c.user.email, created_at: now, updated_at: now, messages: [] };
      state.requests.push(request); return json(request, 201);
    }
    if (admin && method === "POST" && requestMatch[2]) {
      const request = required(state.requests.find(r => r.id === Number(requestMatch[2])));
      const account = required(state.accounts.find(a => a.id === request.account_id));
      const now = new Date().toISOString();
      if (requestMatch[3] !== "messages") {
        if (request.status !== "pending") throw new DemoError(409, "This request has already been processed");
        if (requestMatch[3] === "approve") {
          if (request.request_type === "account_quota_change") {
            const units: Record<string, number> = { MiB: 1 / 1024, GiB: 1, TiB: 1024 };
            const quota = Number(request.payload.target_quota_value) * units[String(request.payload.target_quota_unit)];
            if (!Number.isFinite(quota) || quota <= 0) throw new DemoError(422, "Quota must be positive");
            account.quota_max_size_gb = quota; request.result = { quota_max_size_gb: quota };
          } else if (request.request_type === "portal_user_access") {
            const email = textField(request.payload, "target_email"); let user = state.users.find(u => u.email === email);
            if (!user) { user = { id: state.nextId++, email, full_name: String(request.payload.target_name ?? ""), role: "ui_user", is_active: true, ui_language: "en", account_links: [] }; state.users.push(user); }
            user.account_links = [...(user.account_links ?? []).filter(l => l.account_id !== account.id), { account_id: account.id, manager_role: null, portal_role: "portal_user" }];
            account.user_links = [...account.user_links.filter(l => l.user_id !== user!.id), { user_id: user.id, user_email: email, user_full_name: user.full_name, manager_role: null, portal_role: "portal_user" }];
            request.result = { user_id: user.id, email };
          } else if (request.request_type === "portal_user_removal") {
            const user = required(state.users.find(u => u.email === request.payload.target_email));
            if (user.id <= 5) throw new DemoError(409, "Demo persona memberships are reserved");
            user.account_links = user.account_links?.filter(l => l.account_id !== account.id);
            account.user_links = account.user_links.filter(l => l.user_id !== user.id);
          } else throw new DemoError(403, "This setting is locked in the demo");
        }
        request.status = requestMatch[3] === "approve" ? "approved" : "rejected";
        request.decided_at = now; request.decided_by_user_id = c.user.id; request.decided_by_email = c.user.email;
      }
      if (body.message) request.messages.push({ id: state.nextId++, author_user_id: c.user.id, author_email: c.user.email, author_role: c.user.role, message: String(body.message), created_at: now });
      request.updated_at = now; return json(request);
    }
  }
  if (!path.startsWith("/portal/")) return undefined;
  if (path === "/portal/accounts" && method === "GET") return json(state.accounts.filter(a => accountGrant(c, a).portal_role).map(a => ({ ...a, portal_role: accountGrant(c, a).portal_role })));
  const account = scopedAccount(c);
  const manager = accountGrant(c, account).portal_role === "portal_manager";
  const candidates = state.users.filter(u => accountGrant(c, account, u.id).portal_role).map(user => {
    const l = accountGrant(c, account, user.id);
    return { user_id: user.id, email: user.email, display_name: user.full_name, portal_role: l.portal_role, access_source: "direct", member_since: state.initializedAt, can_review_access: manager };
  });
  if (path === "/portal/state" && method === "GET") return json({ portal_role: manager ? "portal_manager" : "portal_user", can_manage_buckets: manager, can_create_private_storage_spaces: true, can_create_team_storage_spaces: manager, can_create_external_sharing: false, can_manage_portal_users: manager, allow_named_bucket_create: true, storage_space_version_cleanup_enabled: false, server_access_logging_enabled: true });
  if (path === "/portal/settings") {
    if (method !== "GET") throw new DemoError(403, "Project settings are read-only in this demo");
    return json({ effective: settings.portal, project_override: {}, delegated_to_portal_managers: false, can_update: false });
  }
  if (path === "/portal/collaborators" && method === "GET") return json({ summary: { collaborator_count: candidates.length, external_access_key_count: 0 }, collaborators: candidates });
  if (path === "/portal/share-candidates" && method === "GET") return json(candidates);
  const review = path.match(/^\/portal\/collaborators\/(\d+)\/access$/);
  if (review && method === "GET") return json({ collaborator: required(candidates.find(u => u.user_id === Number(review[1]))), can_request_project_removal: manager, space_accesses: state.spaces.filter(s => s.accountId === account.id && s.visibility === "shared").map(s => ({ storage_space_id: s.id, storage_space_name: s.name, role: s.account_member_role ?? "Viewer", source: "team", can_revoke: false })) });
  const match = path.match(/^\/portal\/storage-spaces(?:\/([^/]+)(?:\/(settings|shares|share-candidates|access-summary|public-links)(?:\/(\d+))?)?)?$/);
  if (!match) return undefined;
  if (!match[1]) {
    if (method === "GET") {
      const search = (c.url.searchParams.get("search") ?? "").toLowerCase();
      return json(state.spaces.filter(s => s.accountId === account.id && spaceRole(c, s) && (!s.archived_at || c.url.searchParams.get("include_archived") === "true") && s.name.toLowerCase().includes(search)).map(s => spaceView(c, s)));
    }
    if (method === "POST") {
      const name = textField(body, "name"); const id = state.nextId++;
      if (body.visibility === "shared" && !manager) throw new DemoError(403, "Switch to the project manager to create a team space");
      const bucketName = body.naming_mode === "named_bucket" ? name : `portal-space-${id}`;
      if (state.buckets.some(b => b.name === bucketName)) throw new DemoError(409, "This bucket already exists");
      const bucket = newBucket(bucketName, account); state.buckets.push(bucket);
      const space: DemoSpace = { id: `space-${id}`, name, accountId: account.id, bucketName, internal_bucket_name: bucketName, description: String(body.description ?? ""), role: manager ? "Manager" : "Owner", visibility: body.visibility === "shared" ? "shared" : "private", owner_user_id: body.visibility === "shared" ? null : c.user.id, share_scope: body.share_scope === "restricted" ? "restricted" : "account", account_member_role: body.account_member_role === "Viewer" ? "Viewer" : "Editor", shares: [], status: "active", origin: "portal_generic", created_at: bucket.creation_date, name_editable: true };
      if (Array.isArray(body.initial_shares)) space.shares = body.initial_shares.map((input: { user_id: number; role: string }) => {
        const target = required(candidates.find(u => u.user_id === input.user_id));
        if (input.role !== "Viewer" && input.role !== "Editor") throw new DemoError(422, "Choose Viewer or Editor");
        return { id: `share-${state.nextId++}`, storage_space_id: space.id, storage_space_name: space.name, user_id: target.user_id, email: target.email, role: input.role, direction: "by_me" };
      });
      state.spaces.push(space); return json(spaceView(c, space), 201);
    }
  }
  const space = required(state.spaces.find(s => s.id === decodeURIComponent(match[1]) && s.accountId === account.id));
  if (!spaceRole(c, space)) throw new DemoError(403, "This space is not shared with the selected identity");
  const writable = manager || space.owner_user_id === c.user.id;
  if (space.archived_at && method !== "GET" && !(method === "PATCH" && body.archived === false && Object.keys(body).length === 1)) throw new DemoError(403, "Unarchive this space before editing it");
  if (method !== "GET" && !writable) throw new DemoError(403, "This action requires the owner or project manager identity");
  if (!match[2]) {
    if (method === "GET") return json(spaceView(c, space));
    if (method === "PATCH") { for (const field of ["name", "description", "visibility", "share_scope", "account_member_role"]) if (field in body) Object.assign(space, { [field]: body[field] });
      if ("archived" in body) space.archived_at = body.archived ? new Date().toISOString() : null;
      return json(spaceView(c, space)); }
    if (method === "DELETE") {
      const bucket = required(state.buckets.find(b => b.name === space.bucketName));
      if (bucket.objects.some(o => o.versions.length)) throw new DemoError(409, "This space still has files or versions. Create an empty space to try deletion.");
      state.spaces = state.spaces.filter(s => s !== space); state.buckets = state.buckets.filter(b => b !== bucket); return done();
    }
  }
  if (match[2] === "settings") {
    const bucket = required(state.buckets.find(b => b.name === space.bucketName));
    if (method === "PUT" && manager) { bucket.config.versioning = { enabled: Boolean(body.versioning_enabled), status: body.versioning_enabled ? "Enabled" : "Suspended" }; bucket.config.lifecycle = { rules: body.lifecycle_enabled ? [{ ID: "ExpireOldVersions", Status: "Enabled", NoncurrentVersionExpiration: { NoncurrentDays: Number(body.version_history_retention_days) } }] : [] }; }
    else if (method !== "GET") throw new DemoError(403, "Switch to project manager to change space settings");
    return json({ versioning_enabled: (bucket.config.versioning as { enabled: boolean }).enabled, versioning_status: (bucket.config.versioning as { status: string }).status, lifecycle_enabled: Boolean((bucket.config.lifecycle as { rules: unknown[] }).rules.length), version_history_retention_days: (bucket.config.lifecycle as { rules: { NoncurrentVersionExpiration?: { NoncurrentDays: number } }[] }).rules.find(r => r.NoncurrentVersionExpiration)?.NoncurrentVersionExpiration?.NoncurrentDays ?? 90, can_update: manager && !space.archived_at });
  }
  if (match[2] === "share-candidates" && method === "GET") return json(candidates.map(u => ({ ...u, already_shared: space.shares.some(s => s.user_id === u.user_id) })));
  if (match[2] === "access-summary" && method === "GET") return json({ mode: space.visibility === "private" ? "private" : space.share_scope === "account" ? "all" : "restricted", default_account_member_role: space.account_member_role,
    owner: space.owner_user_id ? { user_id: space.owner_user_id, email: state.users.find(u => u.id === space.owner_user_id)?.email, role: "Owner", access_source: "owner" } : null,
    effective_member_count: space.share_scope === "account" ? candidates.length : space.shares.length + 1, explicit_shares: space.shares, public_link_count: 1, can_manage_access: writable, can_create_public_links: false });
  if (match[2] === "public-links" && method === "GET") return json([{ id: 1, storage_space_id: space.id, storage_space_name: space.name, object_key: "README.txt", object_name: "README.txt", url: "#demo-example-only", label: "Example only · not shareable", created_by_email: c.user.email, created_at: state.initializedAt, expires_at: null, status: "Example" }]);
  if (match[2] === "shares") {
    if (method === "GET") return json(space.shares);
    const target = required(candidates.find(u => u.user_id === Number(match[3] ?? body.user_id) || u.email === body.email));
    if (method === "DELETE") { space.shares = space.shares.filter(s => s.user_id !== target.user_id); return json(space.shares); }
    if (method === "POST" || method === "PUT") {
      if (body.role !== "Viewer" && body.role !== "Editor") throw new DemoError(422, "Choose Viewer or Editor");
      const share: PortalStorageSpaceShare = { id: `share-${state.nextId++}`, storage_space_id: space.id, storage_space_name: space.name, user_id: target.user_id, email: target.email, role: body.role, direction: "by_me", activity_label: "Just now" };
      space.shares = [...space.shares.filter(s => s.user_id !== target.user_id), share]; return json(share);
    }
  }
  return undefined;
}
