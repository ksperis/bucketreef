import type { BucketTag } from "../api/bucketContracts";
import { bucketView, GiB, newBucket } from "./state";
import { spaceRole, DemoError, done, json, listing, scopedAccount, scopedBucket, textField, type DemoRequest } from "./http";
import { objectListing } from "./objects";

export function buckets(c: DemoRequest): Response | undefined {
  const { state, method, path, body } = c;
  const ceph = path.match(/^\/ceph-admin\/endpoints\/(\d+)\/buckets(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  const match = path.match(/^\/(manager|browser)\/buckets(?:\/config)?(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  if (!match && !ceph) return undefined;
  const name = ceph?.[2] ?? match?.[2]; const resource = ceph?.[3] ?? match?.[3];
  const endpointId = ceph ? Number(ceph[1]) : undefined;
  const account = ceph ? undefined : scopedAccount(c);
  if (!name || name === "stream" || (match?.[1] === "browser" && name === "search")) {
    const selected = state.buckets.filter(b => endpointId ? b.endpointId === endpointId : b.accountId === account!.id);
    if (method === "GET") {
      let views = selected.map(bucketView);
      if (match?.[1] === "browser" && ["member", "project-manager"].includes(c.persona)) views = views.filter(b => state.spaces.some(s => s.bucketName === b.name && spaceRole(c, s) && !s.archived_at)).map(b => { const space = state.spaces.find(s => s.bucketName === b.name)!; return { ...b, display_name: space.name, internal_bucket_name: b.name, workspace_label: "Storage Space", role: spaceRole(c, space), status: space.status }; });
      return ceph || match?.[1] === "browser" ? listing(views, c) : json(views);
    }
    if (method === "POST" && match?.[1] === "manager") {
      const name = textField(body, "name"); if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) throw new DemoError(422, "Use a valid S3 bucket name (3–63 characters)");
      if (state.buckets.some(b => b.name === name)) throw new DemoError(409, "This bucket already exists");
      const bucket = newBucket(name, account!, Boolean(body.versioning)); state.buckets.push(bucket); return json(bucketView(bucket), 201);
    }
    return undefined;
  }
  if (name === "compare" && !resource && method === "POST") return json({
    source_context_id: String(account!.id), target_context_id: body.target_context_id, source_bucket: body.source_bucket, target_bucket: body.target_bucket, has_differences: true,
    content_diff: { source_count: 120, target_count: 119, matched_count: 118, different_count: 1, only_source_count: 1, only_target_count: 0, only_source_sample: ["quarterly-report.csv"], only_target_sample: [], different_sample: [{ key: "README.txt", compare_by: "size", source_size: 320, target_size: 280 }] },
    config_diff: { changed: true, sections: [{ key: "versioning_status", label: "Versioning (predefined example)", source: "Enabled", target: "Suspended", changed: true }] },
  });
  const bucket = scopedBucket(c, name, endpointId);
  if (!resource && method === "DELETE" && match?.[1] === "manager") {
    if (bucket.objects.some(o => o.versions.length)) throw new DemoError(409, "Bucket is not empty. History cleanup is disabled in the demo; create an empty bucket to try deletion.");
    state.buckets = state.buckets.filter(b => b !== bucket); return done();
  }
  if ((resource === "stats" || resource === "detail") && method === "GET") return json(bucketView(bucket));
  if (resource === "objects" && ceph && method === "GET") return json(objectListing(bucket, c.url));
  if (resource === "properties" && method === "GET") return json({
    versioning_status: (bucket.config.versioning as { status: string }).status,
    object_lock_enabled: (bucket.config["object-lock"] as { enabled: boolean }).enabled,
    object_lock: bucket.config["object-lock"], public_access_block: bucket.config["public-access-block"],
    lifecycle_rules: ((bucket.config.lifecycle as { rules: Record<string, unknown>[] }).rules).map(rule => ({ id: rule.ID, status: rule.Status, prefix: "" })),
    cors_rules: (bucket.config.cors as { rules: unknown[] }).rules,
  });
  if (match?.[1] === "browser" && method !== "GET") throw new DemoError(403, "Browser technical settings are read-only");
  if (resource === "quota" && method === "PUT") { bucket.quota_max_size_bytes = body.max_size_gb == null ? null : Number(body.max_size_gb) * GiB; bucket.quota_max_objects = body.max_objects == null ? null : Number(body.max_objects); return done(); }
  if (resource === "tags") {
    if (method === "GET") return json({ tags: bucket.tags ?? [] });
    if (method === "PUT") { bucket.tags = body.tags as BucketTag[]; return done(); }
    if (method === "DELETE") { bucket.tags = []; return done(); }
  }
  if (resource === "versioning" && method === "PUT") { bucket.config.versioning = { enabled: Boolean(body.enabled), status: body.enabled ? "Enabled" : "Suspended" }; return done(); }
  if (resource && Object.hasOwn(bucket.config, resource)) {
    if (method === "GET") return json(bucket.config[resource]);
    if (match?.[1] === "browser") throw new DemoError(403, "Browser technical settings are read-only");
    if (method === "PUT") { bucket.config[resource] = body; return json(body); }
    if (method === "DELETE") {
      const empty = ["lifecycle", "cors", "encryption"].includes(resource) ? { rules: [] } : resource === "policy" ? { policy: null } : ["notifications", "replication"].includes(resource) ? { configuration: {} } : {};
      bucket.config[resource] = empty; return done();
    }
  }
  if (resource === "cors" && method === "GET") return json({ enabled: false, rules: [] });
  return undefined;
}
