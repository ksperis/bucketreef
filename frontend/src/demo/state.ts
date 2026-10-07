import type { BrowserFavorite } from "../api/browserFavorites";
import type { User } from "../api/users";
import type { S3Account } from "../api/accounts";
import type { UiGroup } from "../api/groups";
import type { StorageEndpoint } from "../api/storageEndpoints";
import type { Bucket } from "../api/bucketContracts";
import type { ObjectMetadata, ObjectTag } from "../api/browserContracts";
import type { PortalStorageSpaceSummary } from "../api/portal";
import type { PortalStorageSpaceShare } from "../api/portalSharing";
import type { PortalAdminRequest } from "../api/portalRequests";
import type { AppSettings } from "../api/appSettings";
import type { IAMUser, AccessKey } from "../api/managerIamUsers";
import type { CephAdminRgwUserDetail } from "../api/cephAdminUsers";
import type { IAMGroup } from "../api/managerIamGroups";
import type { IAMRole } from "../api/managerIamRoles";
import type { IamPolicy, InlinePolicy } from "../api/managerIamPolicies";
import { disabledFlags } from "./registry";
import type { S3Connection } from "../api/connections";
import type { S3ConnectionAdminItem } from "../api/s3ConnectionsAdmin";
import type { UserNotification } from "../api/userNotifications";
import type { CephAdminRgwAccountDetail } from "../api/cephAdminAccounts";

const MiB = 1024 ** 2;
export const GiB = 1024 ** 3;
export const FILE_LIMIT = 20 * MiB;
export const TOTAL_LIMIT = 100 * MiB;
export const tools = { bucket_compare: true, bucket_migration: false, bucket_integrity_check: false, bucket_purge: false, feature_rules: false };
export type Persona = "admin" | "manager" | "member" | "project-manager" | "ceph-admin";
export const personaIds: Record<Persona, number> = { admin: 1, manager: 2, member: 3, "project-manager": 4, "ceph-admin": 5 };
export type DemoObjectVersion = ObjectMetadata & { version_id: string; body: Blob; imported: boolean; deleted?: boolean };
export type DemoObject = { key: string; tags: ObjectTag[]; versions: DemoObjectVersion[] };
export type DemoBucket = Bucket & { accountId: number; endpointId: number; objects: DemoObject[]; config: Record<string, unknown> };
export type DemoSpace = PortalStorageSpaceSummary & { accountId: number; bucketName: string; shares: PortalStorageSpaceShare[] };
export type DemoIam = {
  users: (IAMUser & { rgw?: Partial<CephAdminRgwUserDetail> })[]; groups: IAMGroup[]; roles: IAMRole[]; policies: IamPolicy[];
  keys: Record<string, AccessKey[]>; attachments: Record<string, IamPolicy[]>; inline: Record<string, InlinePolicy[]>;
};
export type DemoState = {
  browserFavorites?: Record<number, BrowserFavorite[]>;
  initializedAt: string; nextId: number; users: User[]; groups: UiGroup[];
  accounts: (S3Account & { rgw?: Partial<CephAdminRgwAccountDetail> })[]; endpoints: StorageEndpoint[]; buckets: DemoBucket[]; spaces: DemoSpace[];
  requests: PortalAdminRequest[]; iam: Record<number, DemoIam>;
  connections: (S3Connection & S3ConnectionAdminItem)[];
  notifications: Record<number, UserNotification[]>;
  snapshotInventory: { accountId: number; endpointId: number; bucketName: string; bytes: number; objects: number }[];
  history: { timestamp: string; bytes_in: number; bytes_out: number; ops: number; success_ops: number }[];
};
export const settings: AppSettings = {
  general: {
    rgw_account_id_prefix: "80",
    manager_enabled: true, ceph_admin_enabled: true, storage_ops_enabled: false,
    browser_enabled: true, browser_root_enabled: true, browser_manager_enabled: true,
    browser_portal_enabled: true, browser_ceph_admin_enabled: true, portal_enabled: true,
    billing_enabled: true, endpoint_status_enabled: true, quota_alerts_enabled: true,
    usage_history_enabled: true, bucket_compare_enabled: true, bucket_usage_stats_enabled: true,
    bucket_quota_management_enabled: true, manager_ceph_s3_user_keys_enabled: true,
    manager_access_key_metadata_enabled: false,
    allow_login_access_keys: false, allow_login_endpoint_list: false, allow_login_custom_endpoint: false,
    require_passkey_for_admins: false, require_passkey_for_users: false,
    allow_user_profile_name_edit: true, allow_user_external_identity_unlink: false, ...disabledFlags,
  },
  portal: {
    browser_access_enabled: true, allow_private_storage_space_create: true,
    allow_portal_named_bucket_create: true, allow_portal_user_access_key_create: true,
    allow_portal_user_external_sharing: false, server_access_logging_enabled: true,
    server_access_log_retention_days: 90, storage_space_version_cleanup_enabled: false,
    max_portal_user_access_keys: 3,
    bucket_defaults: { versioning: true, enable_cors: true, enable_lifecycle: true,
      noncurrent_version_expiration_days: 90, cors_allowed_origins: [] },
  },
  manager: { manager_rgw_usage_metrics_enabled: true, bucket_migration_parallelism_default: 1, bucket_migration_parallelism_max: 1, bucket_migration_max_active_per_endpoint: 1 },
  browser: { allow_proxy_transfers: true, direct_upload_parallelism: 2, proxy_upload_parallelism: 2,
    direct_download_parallelism: 2, proxy_download_parallelism: 2, other_operations_parallelism: 2, streaming_zip_threshold_mb: 200 },
  onboarding: { dismissed: true }, branding: { primary_color: "#0569f8", login_logo_url: null },
  quota_notifications: { threshold_percent: 80, include_subject_contact_email: false, smtp_port: 587, smtp_starttls: true, smtp_timeout_seconds: 10 },
};

export function newBucket(name: string, account: S3Account, versioning = true): DemoBucket {
  return { name, accountId: account.id, endpointId: account.storage_endpoint_id,
    owner: account.rgw_account_id, owner_name: account.name, creation_date: new Date().toISOString(),
    quota_max_size_bytes: 100 * GiB, quota_max_objects: 100000, tags: [{ key: "environment", value: "demo" }],
    objects: [], config: {
      versioning: { enabled: versioning, status: versioning ? "Enabled" : "Suspended" },
      lifecycle: { rules: [{ ID: "retain-previous-versions", Status: "Enabled", Filter: { Prefix: "" }, NoncurrentVersionExpiration: { NoncurrentDays: 90 } }] },
      cors: { rules: [] }, policy: { policy: null }, encryption: { rules: [] },
      logging: { enabled: false, target_bucket: null, target_prefix: null },
      "object-lock": { enabled: false }, website: {}, notifications: { configuration: {} }, replication: { configuration: {} },
      acl: { owner: account.rgw_account_id, grants: [] },
      "public-access-block": { block_public_acls: true, ignore_public_acls: true, block_public_policy: true, restrict_public_buckets: true },
    } };
}

export function putObject(bucket: DemoBucket, key: string, body: Blob, imported: boolean, date = new Date().toISOString()): DemoObject {
  let object = bucket.objects.find(item => item.key === key);
  if (!object) { object = { key, tags: [], versions: [] }; bucket.objects.push(object); }
  const version: DemoObjectVersion = { key, body, size: body.size, content_type: body.type || "application/octet-stream",
    imported, metadata: { source: imported ? "local-upload" : "demo-scenario" }, last_modified: date,
    etag: `"demo-${body.size}-${date.replace(/\D/g, "")}"`, storage_class: "STANDARD", version_id: crypto.randomUUID() };
  if (!(bucket.config.versioning as { enabled: boolean }).enabled) object.versions = [];
  object.versions.unshift(version);
  return object;
}

export function bucketView(bucket: DemoBucket): Bucket {
  const objects = bucket.objects.map(object => object.versions[0]).filter(v => v && !v.deleted);
  const { objects: _objects, config: _config, accountId: _accountId, endpointId: _endpointId, ...view } = bucket;
  return { ...view, used_bytes: objects.reduce((total, object) => total + object.size, 0), object_count: objects.length,
    features: Object.fromEntries(["versioning", "lifecycle", "cors", "object_lock"].map(feature => {
      const data = bucket.config[feature.replace("_", "-")] as { enabled?: boolean; rules?: unknown[] };
      const active = Boolean(data?.enabled || data?.rules?.length);
      return [feature, { state: active ? "enabled" : "disabled", tone: active ? "active" : "inactive" }];
    })) };
}

export function emptyIam(): DemoIam { return { users: [], groups: [], roles: [], policies: [], keys: {}, attachments: {}, inline: {} }; }

export function createSeed(): DemoState {
  const now = new Date(); const at = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
  const endpoints: StorageEndpoint[] = ["Paris · Production", "Lyon · Archive"].map((name, i) => ({
    id: 11 + i, name, endpoint_url: `https://ceph-${i ? "lyon" : "paris"}.demo.invalid`, provider: "ceph",
    region: i ? "eu-lyon-1" : "eu-paris-1", force_path_style: true, verify_tls: true,
    latitude: i ? 45.764 : 48.8566, longitude: i ? 4.8357 : 2.3522,
    has_admin_secret: true,
    admin_access_key: "DEMO_NOT_A_REAL_KEY",
    service_identities: [
      { kind: "runtime", mode: "managed", status: "ready", credentials_configured: true },
      { kind: "supervision", mode: "managed", status: "ready", credentials_configured: true },
    ],
    capabilities: { admin: true, account: true, usage: true, metrics: true, iam: true, sts: false, sns: false, sse: true, replication: true, static_website: true },
    admin_ops_permissions: { users_read: true, users_write: true, buckets_read: true, buckets_write: true, accounts_read: true, accounts_write: true },
    features: { admin: { enabled: true }, account: { enabled: true }, usage: { enabled: true }, metrics: { enabled: true },
      iam: { enabled: true }, sts: { enabled: false }, sns: { enabled: false }, sse: { enabled: true }, replication: { enabled: true },
      static_website: { enabled: true }, healthcheck: { enabled: true, mode: "http" } },
    tags: [{ id: 1, label: "demo", color_key: "sky", scope: "standard" }], is_default: i === 0, is_editable: true, created_at: at(120), updated_at: at(2),
  }));
  const names = ["Helios Retail", "Northwind Research", "BlueHarbor Media", "Alpine Analytics", "Orion Operations"];
  const accounts: S3Account[] = names.map((name, i) => ({
    id: 101 + i, name, rgw_account_id: `RGW${58084876167649330n + BigInt(i)}`, email: `team-${i}@example.com`,
    tags: [], user_links: [], group_links: [], quota_max_size_gb: 500, quota_max_objects: 500000,
    storage_endpoint_id: endpoints[i % 2].id, storage_endpoint_name: endpoints[i % 2].name,
    storage_endpoint_url: endpoints[i % 2].endpoint_url, storage_endpoint_is_default: i % 2 === 0,
    storage_endpoint_capabilities: endpoints[i % 2].capabilities!, allow_bucket_quota_management: true,
  }));
  const first = ["Alex", "Sam", "Jordan", "Morgan", "Taylor", "Casey", "Robin", "Avery", "Jamie", "Riley", "Cameron", "Drew"];
  const last = ["Martin", "Chen", "Patel", "Garcia", "Kim"];
  const users: User[] = Array.from({ length: 60 }, (_, i) => {
    const full_name = `${first[i % 12]} ${last[Math.floor(i / 12)]}`;
    return { id: i + 1, email: `${full_name.toLowerCase().replace(" ", ".")}@example.com`, full_name,
      role: i === 0 ? "ui_superadmin" : i === 4 ? "ui_admin" : "ui_user", is_active: true, has_local_password: true,
      can_access_ceph_admin: i === 0 || i === 4, can_access_storage_ops: false, ui_language: "en",
      can_create_manual_private_connections: true, can_provision_managed_private_connections: false,
      browser_advanced_features_enabled: true, manager_tool_access: { ...tools }, last_login_at: at(i % 9),
      account_links: [{ account_id: 101 + (i < 5 ? 0 : i % 5), manager_role: i === 1 ? "account_administrator" : null,
        portal_role: i === 3 ? "portal_manager" : i === 1 ? null : "portal_user", allow_manager_browser_data_access: i === 1 }],
      group_details: [], s3_user_details: [], s3_connection_details: [] };
  });
  users[1].account_links = accounts.map(a => ({ account_id: a.id, manager_role: "account_administrator", portal_role: null, allow_manager_browser_data_access: true }));
  users[2].account_links = accounts.slice(0, 2).map(a => ({ account_id: a.id, manager_role: null, portal_role: "portal_user" }));
  users[3].account_links = accounts.slice(0, 2).map(a => ({ account_id: a.id, manager_role: null, portal_role: "portal_manager" }));
  for (const account of accounts) account.user_links = users.flatMap(user => user.account_links?.filter(link => link.account_id === account.id).map(link => ({ ...link, user_id: user.id, user_email: user.email, user_full_name: user.full_name })) ?? []);
  const groups: UiGroup[] = ["Platform", "Engineering", "Design", "Research", "Operations", "Contractors"].map((name, i) => ({
    id: 201 + i, name, description: `${name} team · demo organisation`, user_details: users.filter(u => u.id % 6 === i),
    account_links: [], account_details: [], s3_user_details: [], s3_connection_details: [], created_at: at(90), updated_at: at(i),
  }));
  const designGroupGrant = { account_id: accounts[0].id, manager_role: "account_administrator" as const, portal_role: null, allow_manager_browser_data_access: true };
  groups[2].account_links = [designGroupGrant];
  groups[2].account_details = [{ id: accounts[0].id, name: accounts[0].name, rgw_account_id: accounts[0].rgw_account_id }];
  accounts[0].group_links = [{ ...designGroupGrant, group_id: groups[2].id, group_name: groups[2].name }];
  const buckets: DemoBucket[] = [];
  // Different account workloads, ordered as documents/media/reports/backups/logs/datasets.
  const objectCounts = [
    [38, 87, 156, 24, 269, 146],
    [64, 43, 118, 21, 181, 353],
    [52, 314, 73, 36, 129, 56],
    [46, 68, 194, 28, 241, 263],
    [41, 59, 92, 32, 287, 89],
  ];
  for (const [accountIndex, account] of accounts.entries()) for (const [bucketIndex, suffix] of ["documents", "media", "reports", "backups", "logs", "datasets"].entries()) {
    const bucket = newBucket(`${account.name.toLowerCase().split(" ")[0]}-${suffix}`, account);
    bucket.creation_date = at(90 - buckets.length);
    putObject(bucket, "README.txt", new Blob([`Welcome to ${account.name}.\nThis is the previous demo revision.\n`], { type: "text/plain" }), false, at(3));
    putObject(bucket, "README.txt", new Blob([`Welcome to ${account.name}\n\nThis is a local, interactive BucketReef demo.\nTry uploading a file, editing its tags, or restoring the previous README version in Portal.\nNo data is sent to a storage service.\n`], { type: "text/plain" }), false, at(1));
    putObject(bucket, "quarterly-report.csv", new Blob(["month,requests,storage_gib\nJuly,128450,42\nAugust,148090,49\nSeptember,175280,58\n"], { type: "text/csv" }), false, at(2));
    putObject(bucket, "architecture.json", new Blob([JSON.stringify({ project: account.name, endpoints: ["Paris", "Lyon"], replicas: 3 }, null, 2)], { type: "application/json" }), false, at(4));
    putObject(bucket, "reef.svg", new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#073b4c"/><circle cx="320" cy="170" r="100" fill="#06d6a0"/><text x="320" y="315" text-anchor="middle" fill="white" font-family="sans-serif" font-size="30">BucketReef · demo</text></svg>'], { type: "image/svg+xml" }), false, at(5));
    const exportCount = objectCounts[accountIndex][bucketIndex] - bucket.objects.length;
    for (let i = 0; i < exportCount; i++) { const object = putObject(bucket, `exports/2026/${String(i + 1).padStart(4, "0")}.json`, new Blob([JSON.stringify({ record: i + 1, project: account.name, status: "processed", amount: 120 + i * 7, note: "Demo payload excerpt. Seeded dataset sizes represent a production inventory." })], { type: "application/json" }), false, at(i % 90)); object.versions[0].size = (4 + (i % 32) * 16) * MiB; }
    buckets.push(bucket);
  }
  const spaces: DemoSpace[] = buckets.slice(0, 12).map((b, i) => ({
    id: `space-${i + 1}`, name: `${b.name.split("-").at(-1)!.replace(/^./, s => s.toUpperCase())} · ${accounts.find(a => a.id === b.accountId)!.name}`,
    accountId: b.accountId, bucketName: b.name, internal_bucket_name: b.name, description: "Shared working files and project deliverables.",
    role: "Editor", visibility: i % 4 === 0 ? "private" : "shared", share_scope: "account", account_member_role: "Editor",
    owner_user_id: i % 4 === 0 ? 3 : null, owner_label: i % 4 === 0 ? users[2].full_name : null,
    status: "active", origin: "portal_generic", name_editable: true, created_at: b.creation_date, shares: [],
    project_key: accounts.find(a => a.id === b.accountId)!.name, region: "Paris", can_browse: true,
  }));
  const requests: PortalAdminRequest[] = ["account_quota_change", "portal_user_access", "portal_user_access"].map((type, i) => ({
    id: 501 + i, account_id: 101, account_name: accounts[0].name, request_type: type as PortalAdminRequest["request_type"], status: "pending",
    payload: type === "account_quota_change" ? { direction: "increase", target_quota_value: 750, target_quota_unit: "GiB", reason: "Upcoming autumn campaign" } : { target_name: `${first[6 + i]} Williams`, target_email: `new-colleague-${i}@example.com`, reason: "Join the project team" },
    requester_user_id: 4, requester_email: users[3].email, created_at: at(i + 1), updated_at: at(i + 1), messages: [],
  }));
  const iam: Record<number, DemoIam> = {};
  for (const account of accounts) {
    iam[account.id] = { ...emptyIam(), users: ["backup-service", "analytics-reader", "media-editor"].map(name => ({ name, arn: `arn:aws:iam::${account.rgw_account_id}:user/${name}`, groups: ["applications"], policies: [], inline_policies: [], has_keys: false })),
      groups: [{ name: "applications" }],
      roles: [{ name: "ApplicationReadOnly", arn: `arn:aws:iam::${account.rgw_account_id}:role/ApplicationReadOnly`, assume_role_policy_document: { Version: "2012-10-17", Statement: [] } }], policies: [{ name: "ReadProjectObjects", arn: `arn:aws:iam::${account.rgw_account_id}:policy/ReadProjectObjects`, document: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject", "s3:ListBucket"], Resource: ["*"] }] } }] };
  }
  for (const u of users) u.group_details = groups.filter(g => g.user_details?.some(m => m.id === u.id)).map(g => ({ id: g.id, name: g.name }));
  return { initializedAt: now.toISOString(), nextId: 1000, endpoints, accounts, users, groups, buckets, spaces, requests, iam,
    connections: endpoints.map((e, i) => ({ id: 301 + i, name: `${e.name} · service connection`, storage_endpoint_id: e.id, endpoint_url: e.endpoint_url, region: e.region, provider_hint: "ceph", created_by_user_id: 2, created_by_email: users[1].email, is_shared: true, is_active: true, access_manager: true, access_browser: false, access_key_id: "DEMO_NOT_A_REAL_KEY", execution_status: "ready", user_count: 1, user_details: [users[1]], group_details: [], tags: [], created_at: at(60) })),
    notifications: Object.fromEntries(users.map(u => [u.id, [{ id: 1, type: "demo", severity: "info", title: "Welcome to your live demo", message: "Changes stay in this browser. Use the profile bar to follow a Portal request through approval.", created_at: at(0), read_at: null }, { id: 2, type: "endpoint", severity: "warning", title: "Paris latency recovered", message: "Historical incident · service returned to normal after 8 minutes.", created_at: at(2), read_at: at(0) }]])),
    snapshotInventory: buckets.map(b => ({ accountId: b.accountId, endpointId: b.endpointId, bucketName: b.name, bytes: bucketView(b).used_bytes ?? 0, objects: bucketView(b).object_count ?? 0 })),
    history: Array.from({ length: 90 }, (_, i) => ({ timestamp: at(89 - i), bytes_in: (2 + i / 18 + Math.sin(i) * .4) * GiB, bytes_out: (3 + i / 12) * GiB, ops: 24000 + i * 850, success_ops: 23980 + i * 849 })),
  };
}
