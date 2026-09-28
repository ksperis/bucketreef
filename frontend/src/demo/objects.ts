import type { BrowserObject, ListBrowserObjectsResponse, ObjectTag } from "../api/browserContracts";
import { FILE_LIMIT, TOTAL_LIMIT, putObject, type DemoBucket, type DemoObject, type DemoObjectVersion } from "./state";
import { spaceRole, DemoError, done, json, required, scopedBucket, textField, type DemoRequest } from "./http";

function objectView(version: DemoObjectVersion): BrowserObject {
  return { key: version.key, size: version.size, last_modified: version.last_modified, etag: version.etag, storage_class: version.storage_class, version_id: version.version_id, is_delete_marker: Boolean(version.deleted) };
}
export function objectListing(bucket: DemoBucket, url: URL): ListBrowserObjectsResponse {
  const prefix = url.searchParams.get("prefix") ?? "";
  const query = url.searchParams.get("query") ?? "";
  const recursive = url.searchParams.get("recursive") === "true";
  const prefixes = new Set<string>();
  const objects: BrowserObject[] = [];
  for (const object of bucket.objects) {
    const current = object.versions[0]; if (!current || current.deleted || !object.key.startsWith(prefix)) continue;
    const rest = object.key.slice(prefix.length); if (!rest) continue;
    const type = url.searchParams.get("item_type") ?? "all";
    const extensions = (url.searchParams.get("extensions") ?? "").split(",").map(value => value.trim().replace(/^\./, "").toLowerCase()).filter(Boolean);
    const min = url.searchParams.get("min_size"), max = url.searchParams.get("max_size");
    const after = url.searchParams.get("modified_after"), before = url.searchParams.get("modified_before");
    const fileFilters = min !== null || max !== null || Boolean(after || before || extensions.length);
    const caseSensitive = url.searchParams.get("query_case_sensitive") === "true";
    const matches = (value: string) => { const candidate = caseSensitive ? value : value.toLowerCase(); const needle = caseSensitive ? query : query.toLowerCase(); return !needle || (url.searchParams.get("query_exact") === "true" ? candidate === needle : candidate.includes(needle)); };
    if (rest.includes("/")) {
      const folder = prefix + rest.split("/")[0] + "/";
      if (!fileFilters && type !== "file" && matches(folder.slice(prefix.length, -1))) prefixes.add(folder);
      if (!recursive) continue;
    }
    if (type === "folder" || !matches(rest)) continue;
    if (min !== null && current.size < Number(min) || max !== null && current.size > Number(max)) continue;
    if (extensions.length && !extensions.some(extension => object.key.toLowerCase().endsWith("." + extension))) continue;
    if (after && new Date(current.last_modified ?? "") < new Date(after) || before && new Date(current.last_modified ?? "") > new Date(before)) continue;
    const storage = url.searchParams.get("storage_class");
    if (storage && current.storage_class !== storage) continue;
    objects.push(objectView(current));
  }
  const sort = url.searchParams.get("sort_by") ?? "name";
  objects.sort((a, b) => (sort === "size" ? a.size - b.size : sort === "modified" ? String(a.last_modified).localeCompare(String(b.last_modified)) : a.key.localeCompare(b.key)) * (url.searchParams.get("sort_dir") === "desc" ? -1 : 1));
  const start = Math.max(0, Number(url.searchParams.get("continuation_token")) || 0);
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("max_keys")) || 1000));
  return { prefix, objects: objects.slice(start, start + limit), prefixes: [...prefixes].sort(), is_truncated: start + limit < objects.length, next_continuation_token: start + limit < objects.length ? String(start + limit) : null };
}
function selectedVersion(object: DemoObject, versionId?: string | null) {
  const version = required(versionId ? object.versions.find(v => v.version_id === versionId) : object.versions[0], "Object version not found");
  if (version.deleted) throw new DemoError(404, "This version is a delete marker");
  return version;
}
function removeObject(bucket: DemoBucket, key: string, versionId?: string | null) {
  const object = required(bucket.objects.find(o => o.key === key));
  if (versionId) throw new DemoError(403, "Permanent history deletion is disabled in the demo");
  if ((bucket.config.versioning as { enabled: boolean }).enabled) {
    object.versions.unshift({ ...object.versions[0], version_id: crypto.randomUUID(), deleted: true, body: new Blob(), size: 0, imported: false, last_modified: new Date().toISOString() });
  } else bucket.objects = bucket.objects.filter(o => o !== object);
}
function checkUpload(c: DemoRequest, blob: Blob) {
  if (blob.size > FILE_LIMIT) throw new DemoError(413, "Demo uploads are limited to 20 MiB per file");
  const used = c.state.buckets.reduce((n, b) => n + b.objects.reduce((total, o) => total + o.versions.reduce((v, item) => v + (item.imported ? item.body.size : 0), 0), 0), 0);
  if (used + blob.size > TOTAL_LIMIT) throw new DemoError(413, "Demo storage is limited to 100 MiB of imported files, including retained versions. Reset the demo to release all storage.");
}
export async function objects(c: DemoRequest): Promise<Response | undefined> {
  const match = c.path.match(/^\/browser\/buckets\/([^/]+)\/(objects(?:\/columns)?|versions|object-meta|object-tags|object-legal-hold|object-retention|write-preflight|presign|proxy-upload|download|delete|folders|local-upload)$/);
  const portal = c.path.match(/^\/portal\/storage-spaces\/([^/]+)\/objects(?:\/(detail|versions|restore|download))?$/);
  if (!match && !portal) return undefined;
  const space = portal ? required(c.state.spaces.find(s => s.id === decodeURIComponent(portal[1]))) : c.state.spaces.find(s => s.bucketName === decodeURIComponent(match![1]));
  const bucket = scopedBucket(c, space?.bucketName ?? match![1]);
  const endUser = c.persona === "member" || c.persona === "project-manager";
  const role = space && spaceRole(c, space);
  if (endUser && (!space || !role)) throw new DemoError(403, "This space is not shared with the selected identity");
  const writes = c.method !== "GET" && !(match?.[2] === "write-preflight" || match?.[2] === "objects/columns" || (match?.[2] === "presign" && c.body.operation === "get_object"));
  if (endUser && writes && (role === "Viewer" || space?.archived_at)) throw new DemoError(403, "This space is read-only for the selected identity");
  const action = portal ? (portal[2] ? `portal-${portal[2]}` : "objects") : match![2];
  const { method, url, body } = c;
  const key = String(body.key ?? url.searchParams.get("key") ?? "");
  if (action === "write-preflight" && method === "POST") return json({ protection: "preflight", objects: (body.keys as string[]).map(key => {
    const version = bucket.objects.find(object => object.key === key)?.versions[0];
    return version && !version.deleted ? { key, exists: true, etag: version.etag, size: version.size, modified: version.last_modified } : { key, exists: false, etag: null };
  }) });
  if (action === "objects" && method === "GET") return json(objectListing(bucket, url));
  if ((action === "versions" || action === "portal-versions") && method === "GET") {
    const list = bucket.objects.filter(o => action === "portal-versions" ? o.key === key : o.key.startsWith(url.searchParams.get("prefix") ?? key));
    const versions = list.flatMap(o => o.versions.map((v, i) => ({ ...objectView(v), is_latest: i === 0, is_delete_marker: Boolean(v.deleted) })));
    if (portal) return json({ key, versioning_status: (bucket.config.versioning as { status: string }).status, can_restore: role !== "Viewer" && !space?.archived_at && location.pathname.startsWith("/portal"), versions, is_truncated: false });
    return json({ prefix: url.searchParams.get("prefix"), common_prefixes: [], versions: versions.filter(v => !v.is_delete_marker), delete_markers: versions.filter(v => v.is_delete_marker), is_truncated: false });
  }
  if (action === "objects/columns" && method === "POST") return json({ items: (body.keys as string[] ?? []).map(k => {
    const o = required(bucket.objects.find(o => o.key === k)); const v = o.versions[0];
    return { key: k, content_type: v.content_type, tags_count: o.tags.length, metadata_count: Object.keys(v.metadata).length, metadata_status: "ready", tags_status: "ready" };
  }) });
  if (action === "folders" && method === "POST") { const prefix = textField(body, "prefix"); putObject(bucket, prefix.endsWith("/") ? prefix : prefix + "/", new Blob(), false); return done(); }
  if ((action === "delete" && method === "POST") || (action === "objects" && method === "DELETE")) {
    const targets = portal ? [{ key }] : body.objects as { key: string; version_id?: string }[];
    if (!Array.isArray(targets) || !targets.length) throw new DemoError(422, "Select objects to delete");
    for (const target of targets) removeObject(bucket, target.key, target.version_id);
    return portal ? done() : json({ deleted: targets.length });
  }
  if ((action === "proxy-upload" && method === "POST") || (action === "local-upload" && method === "PUT")) {
    const form = action === "proxy-upload" ? await c.request.formData() : null;
    const blob = form ? form.get("file") : await c.request.blob();
    if (!(blob instanceof Blob)) throw new DemoError(422, "A file is required");
    checkUpload(c, blob); putObject(bucket, form ? String(form.get("key")) : key, blob, true); return done();
  }
  if (action === "presign" && method === "POST" && body.operation === "put_object") {
    const destination = new URL(`/api/browser/buckets/${encodeURIComponent(bucket.name)}/local-upload`, location.origin);
    destination.searchParams.set("key", key); destination.searchParams.set("account_id", String(bucket.accountId));
    return json({ url: destination.href, method: "PUT", expires_in: 900, headers: { "Content-Type": String(body.content_type || "application/octet-stream") } });
  }
  const object = required(bucket.objects.find(o => o.key === key), "Object not found");
  if (action === "portal-restore" && method === "POST") {
    const version = selectedVersion(object, String(body.version_id ?? object.versions.find(v => !v.deleted)?.version_id));
    checkUpload(c, version.imported ? version.body : new Blob());
    const restored = putObject(bucket, key, version.body, version.imported).versions[0];
    restored.size = version.size;
    restored.metadata = { ...version.metadata };
    restored.content_type = version.content_type;
    return json({ key, restored_from_version_id: version.version_id, message: "Version restored in this browser" });
  }
  const version = selectedVersion(object, String(body.version_id ?? url.searchParams.get("version_id") ?? "") || undefined);
  if (action === "object-meta") {
    if (method === "PUT") { const allowed = ["content_type", "cache_control", "content_disposition", "content_encoding", "content_language", "metadata", "storage_class", "expires"];
      for (const field of allowed) if (field in body) Object.assign(version, { [field]: body[field] });
    } else if (method !== "GET") return undefined;
    const { body: _body, imported: _imported, deleted: _deleted, ...metadata } = version; return json(metadata);
  }
  if (action === "object-tags") {
    if (method === "PUT") { if (!Array.isArray(body.tags) || body.tags.length > 10) throw new DemoError(422, "Use at most 10 tags"); object.tags = body.tags as ObjectTag[]; }
    else if (method !== "GET") return undefined;
    return json({ key, tags: object.tags, version_id: version.version_id });
  }
  if (action === "object-legal-hold" && method === "GET") return json({ key, status: "OFF" });
  if (action === "object-retention" && method === "GET") return json({ key, mode: null, retain_until: null });
  if (action === "portal-detail" && method === "GET") return json({ ...objectView(version), name: key.split("/").at(-1), content_type: version.content_type,
    preview_type: version.body.type.startsWith("text/") || version.body.type === "application/json" ? "text" : version.body.type.startsWith("image/") ? "image" : "unavailable",
    preview_text: version.body.size < FILE_LIMIT ? await version.body.slice(0, 64 * 1024).text() : null });
  if ((action === "download" || action === "portal-download") && method === "GET") return new Response(version.body, { headers: { "Content-Type": version.body.type, "Content-Length": String(version.body.size), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(key.split("/").at(-1)!)}` } });
  if (action === "presign" && method === "POST") {
    if (body.operation === "delete_object") { removeObject(bucket, key); return json({ url: URL.createObjectURL(new Blob()), method: "GET", expires_in: 900 }); }
    if (body.operation === "get_object") return json({ url: URL.createObjectURL(version.body), method: "GET", expires_in: 900, headers: {} });
  }
  return undefined;
}
