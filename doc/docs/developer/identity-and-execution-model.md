# Identity and Execution Model

The application separates UI access from storage execution. A UI role decides
which workspace can be opened; the selected execution context decides which
credentials perform S3, IAM, or RGW operations.

## Separation of identities

| Identity | What it controls | Examples |
|---|---|---|
| UI identity | Workspace visibility, Admin settings, Manager tool access, and audit actor. | `ui_none`, `ui_user`, `ui_admin`, `ui_superadmin`, UI groups, `can_access_storage_ops`, `can_access_ceph_admin`. |
| Execution context | Credentials and account scope used by storage actions. | RGW account, S3 connection, S3 user, session context, Ceph Admin endpoint. |
| Portal grant model | User-facing Storage Space visibility and role. | Private Owner, team Viewer/Editor grants, project Manager, Portal account links. |
| Backend workflow identity | Explicit technical credential used for controlled orchestration. | Portal IAM provisioning, healthchecks, billing, quota, key rotation. |

UI sessions are represented by `auth_sessions` and single-use
`refresh_tokens`. `external_identities` binds an immutable provider subject to
a user; email collisions are held in `external_identity_link_requests` for
superadmin approval. `users.auth_version` is the immediate invalidation boundary
for password, role, activation, MFA, and external-identity changes.

## Personal storage identity contract

- Every human operator uses a dedicated IAM identity or owned private S3
  connection; credentials are never shared between people.
- One personal identity may temporarily have multiple keys during rotation.
  Every key must still identify that same person and be retired after rotation.
- Portal already executes S3 operations with the signed-in user's personal IAM
  identity. Portal external access is assigned to one named person and must
  preserve that attribution.
- Application audit identifies control-plane actors. Object-level attribution
  comes from provider S3 access logs. Without provider logging and retention,
  the application cannot reconstruct an exhaustive object audit trail.

## Context and executor

- `/manager` and `/browser` rely on execution context selection.
- `/portal` requires explicit Portal account access and uses Portal Storage
  Space metadata and grants as the source of truth.
- One RGW account represents one Portal project. The account-local
  `portal-manager` IAM group can therefore grant the fixed Manager data-plane
  action set once for all project Storage Spaces; technical buckets apply an
  explicit principal-scoped resource-policy `Deny`.
- `/ceph-admin` uses an endpoint-scoped Ceph Admin context.
- `/storage-ops` lists and operates only over contexts the user is authorized to
  use.
- Backend services resolve the executor from the requested context and reject
  incompatible contexts instead of silently switching to another identity.

Account-scoped Portal routes receive `AccountAccess` for a persisted RGW `S3Account` after
the dependency has checked the explicit account selection and Portal role.
Connection, S3-user, and Ceph Admin selectors are rejected at that boundary.
Portal bucket statistics therefore read Manager snapshots using the account
ID directly; current Storage Space visibility and content-access checks still
determine which snapshots can be returned.

The transversal execution-context boundary uses the explicit, non-persistent
`S3ExecutionContext`. Persistent RGW accounts selected through this boundary
are copied before credentials are attached. Connections, S3 users,
direct sessions, Portal Browser identities, and Ceph Admin endpoints never
instantiate synthetic `S3Account` ORM records. `context_id` and `context_kind`
are authoritative; database-like negative IDs and dynamically attached private
attributes are not part of the contract.

Browser listing/detail caches and the shared Manager/Storage Ops bucket cache
use the same `s3_execution_cache_key` fingerprint. It includes the explicit
context kind and ID, credentials, session token, endpoint, region, addressing
mode, and TLS verification option. Rotating credentials or changing execution
configuration must not reuse a previous cached response. Cache keys store the
digest, never raw credentials. Existing TTLs and mutation invalidation remain
independent from authorization; a cache hit does not authorize a context or
replace Portal's current Storage Space visibility checks.

The shared Manager/Storage Ops bucket cache invalidates every execution variant
of the selected `context_id` (or the persisted account ID), without inferring a
scope from source metadata or display names. Account, Portal, and bound-session
contexts retain the same account invalidation scope while their cached results
remain separated by execution fingerprint. Invalidation also detaches pending
loads: existing callers may finish with their original result, but subsequent
reads start a fresh load and an older result cannot repopulate the cache.

Ceph Admin bucket listings have two endpoint-scoped cache layers: raw RGW
payloads and prepared listing snapshots. Refresh and mutation invalidation
atomically discard both layers and detach their pending loads. Old loads may
finish for existing callers but cannot restore invalidated entries or displace
new loads. Raw requests remain serialized per endpoint within the current
load generation: a payload with statistics can satisfy a request without them,
while a waiter rechecks its needs after an incomplete or failed request.
Coordination state is released when loads finish; no idle endpoint locks are
retained. The 30-minute TTL and limits of 16 raw payloads and 64 snapshots remain
unchanged.

Browser STS sessions reuse that execution fingerprint, together with the
resolved STS endpoint and the caller's cache partition. Exported credentials
remain isolated by authenticated UI session. The cache requests 900-second
credentials, renews them two minutes before their provider expiration, purges
expired entries across contexts, and retains at most 512 entries with
least-recently-used eviction. Failure logs identify the explicit context, never its access key;
the existing fallback to that context's original credentials is preserved.
Provider responses must contain nonempty string credentials and an explicit
timezone-aware expiration. SDK datetimes and ISO timestamps are normalized to
UTC; missing, malformed, or already expired values produce a provider error,
never a fabricated expiration or a cached invalid session.

Usage-history subjects are local RGW accounts or S3 users, scoped to their
storage endpoint. Trend filters use the explicit execution kind and the
corresponding local subject ID. A direct S3 session bound to a local account
can read that account's history; an unregistered session has no local history
and returns empty baselines or an unavailable trend response. Connections and
Ceph Admin contexts must not be reinterpreted as local history subjects, and
missing IDs must never broaden a query to other subjects.

## Canonical UI roles

`users.role` stores exactly one role: `ui_none`, `ui_user`, `ui_admin`, or
`ui_superadmin`. The database constraint, backend request models, and
frontend API types share this contract. Historical aliases are
migrated by revision `0092`; they are not accepted or normalized at runtime.

`ui_none` is the explicit no-workspace role. Unknown historical values migrate
to `ui_none` so canonicalization cannot grant access accidentally.

## Account access axes

Account associations carry two independent, nullable rights:

- `manager_role`: `account_administrator` or `NULL`;
- `portal_role`: `portal_user`, `portal_manager`, or `NULL`.

At least one axis must be present. Direct and UI-group associations are
combined separately: Manager access is the union of administrator grants,
while Portal access takes the highest Portal role only. The effective-access
response exposes separate direct and group provenance for both axes. There is
no conversion between Manager and Portal roles.

Account-association API payloads require both fields, using `null` for an absent
right. The removed `role` and `is_root` fields, missing role fields, empty
associations, and Manager Browser access without `manager_role` are rejected.
Ceph's technical `account-root` identity and RGW account credentials remain
execution details; they do not grant a BucketReef Portal role.

## Workspace authorization matrix

`EffectiveAccessService` is the authority for catalogue construction and
execution of a selected context.

| Workspace | Allowed UI-user contexts |
|---|---|
| Manager | `account_administrator` accounts, assigned RGW users, assigned shared Manager connections, and the owner's active private Manager connections. |
| Manager Browser | The active Manager context only. Accounts require `account_administrator` and `allow_manager_browser_data_access = true` on the same direct or group link and execute as root. RGW users require the flag on any direct or group link and execute with that RGW user's credentials. Owned private connections require both Manager and Browser access. Shared connections are rejected. |
| Browser | The owner's active, unexpired private connections with `access_browser = true`, plus compatible Portal projects whose effective `portal.browser_access_enabled` setting is true. Portal project execution uses the personal Portal IAM identity and Portal profile. |
| Portal | Explicit `portal_user` or `portal_manager` account membership only. Execution always uses the user's personal Portal IAM identity. |
| Ceph Admin Browser | The explicit endpoint-wide Ceph Admin branch. |
| Direct S3 session | The explicit session principal and its session capabilities. |

Generic account contexts, RGW users, and shared connections are rejected by
standard Browser before credential resolution. An enabled Portal project is
published as the distinct `portal_account` context and resolved through the
Portal authorization branch, never through account administrator credentials.
The embedded Manager Browser has no catalogue or selection of its own. It
reuses the active Manager identity and `ctx`, and every `/api/browser` request
uses `X-S3-Workspace: manager-browser`. Account permission cannot be assembled
from separate links: the administrator role and data-access flag must coexist
on one direct or group association. Authorization is revalidated before any
credential resolution so forged and revoked contexts return `403`.

`GET /api/me/workspace-access` returns availability, context counts, and the
backend-selected default workspace. Password login, LDAP, OIDC, redirects, and
the workspace selector consume this contract instead of reconstructing access
from a cached user profile.

## Practical impact

A single UI user can have access to multiple accounts, connections, and
endpoints while keeping execution explicit and attributable. Granting a menu item
or Manager tool access does not grant native storage permission by itself; S3,
IAM, RGW Admin Ops, or Portal grants still decide whether the storage action is
allowed.

## Multi-tab context contract

- The visible query parameter is the authority for each tab: `ctx` for Manager
  and standalone Browser, `project` for Portal, and `ep` for Ceph Admin.
  `/manager/browser` uses the Manager `ctx` and topbar selector.
- Manager and standalone Browser keep distinct default-context preferences. If a Browser
  preference or `ctx` value is no longer authorized, the client removes both,
  shows a warning, and requires an explicit selection. It never falls back to
  the first available context.
- Portal follows the same rule for project selection. Internal navigation that
  omits `project` keeps the current tab's project and restores it in the URL.
- Browser bucket and prefix position, Bucket Ops row selections, and the Bucket
  Ops configuration clipboard are operational tab state. They are not shared
  through `localStorage`; bucket/prefix position and the clipboard use
  `sessionStorage`, while row selections start empty after a remount.
- Cookie refresh is serialized across tabs with Web Locks and a storage lease
  fallback. After one tab rotates the single-use refresh cookie, waiting tabs
  reuse the resulting server session and call `/api/auth/session`; no access
  token is stored in browser storage.

These rules intentionally do not migrate former shared selector, selection, or
Browser-position snapshots. Old values are ignored rather than kept through a
compatibility layer.

## Server-managed private access

Manager exposes two specialized provisioning branches that never return the
new secret to the frontend:

- an authorized, IAM-capable RGW Account or S3 Connection creates a dedicated
  deterministic IAM user, applies validated groups and policies, creates the
  access key last, then stores it in an owned private S3 Connection;
- an assigned RGW User with Ceph key-management permission creates a distinct
  RGW key and immediately stores it in an owned private S3 Connection.

S3 Connection identity metadata uses only `iam_user`, `account_user`, or
`s3_user` as `credential_owner_type`. The durable provisioning saga may retain
the storage-side principal kind `rgw_user`, but the resulting connection always
uses the canonical `s3_user` API and database value. Migration `0073` converts
existing rows and removes the frontend fallback for unknown owner types.

The identity is independent of `AccountIAMUser` and every Portal identity. A
shared connection is only an administration context; its credentials,
associations, capabilities, and tags are never copied. Endpoint data is derived
server-side from the selected Manager context.

`managed_private_accesses` records the UI owner, immutable source context,
remote principal, access key ID, private connection, applied IAM resources, and
saga state. It deliberately contains no secret. A partial unique index permits
only one `provisioning`, `active`, `deleting`, or `cleanup_pending` row per UI
user and source context. Remote mutations are checkpointed, compensated in
reverse order on failure, and retained as `cleanup_pending` when compensation
cannot finish.

Connections created through this flow have `server_managed = true`. Generic
connection APIs may change only their name, tags, active state, and workspace
flags. Endpoint, credentials, principal, provenance, rotation, and deletion are
owned by the orchestrator. IAM/RGW key inventories expose the managed link and
reject direct status or delete operations.

## Quick troubleshooting matrix

| Symptom | Check first |
|---|---|
| Workspace is missing | Global feature flag, UI role, user or group entitlement. |
| Context is missing | Explicit Manager or Portal account role, assigned RGW user/shared Manager connection, owned private connection flags/activity/expiry, or endpoint availability. |
| Menu item is hidden in Manager | Global Manager tool setting, user or group Manager tool access, endpoint capability, and selected context type. |
| Portal Storage Space is missing | Portal account link, Storage Space metadata, access mode, collaborator grant, and archived state. |
| Action is visible but returns `AccessDenied` | Storage-side IAM/S3/RGW permission and the selected execution identity. |
