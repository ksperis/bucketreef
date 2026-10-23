# Operations: Upgrade and Compatibility Notes

## 2026-10 bucket quota updates use PATCH

Manager and Ceph Admin bucket quota updates now use `PATCH` on their existing
quota resource URLs. Quota payloads intentionally allow individual limits to
be updated independently, while an empty payload disables the quota, so the
former `PUT` routes have been removed instead of retained as compatibility
aliases. Other bucket configuration resources keep their replacement-style
`PUT` semantics.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 access-key metadata updates use PATCH

Manager access-key metadata updates now use `PATCH` for both RGW-user keys and
IAM-user keys. Metadata payloads intentionally preserve omitted fields and only
apply values present in the request, so the former `PUT` routes have been
removed instead of retained as compatibility aliases. Access-key status
updates remain `PUT` because the status payload is a complete boolean state.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 Manager IAM identity updates use PATCH

Manager IAM user, group, and role updates now use `PATCH` on their existing
identity resource URLs. Their update payloads are intentionally sparse and
apply only supplied fields, so the former top-level `PUT` routes have been
removed instead of retained as compatibility aliases. `PUT` remains in use for
complete IAM sub-resources such as inline policies and role tags.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 Ceph Admin account and user config updates use PATCH

Ceph Admin account and user configuration updates now use
`PATCH /ceph-admin/endpoints/{endpoint_id}/accounts/{account_id}/config` and
`PATCH /ceph-admin/endpoints/{endpoint_id}/users/{user_id}/config`. Both
contracts are intentionally sparse and apply only supplied fields, so the
former `PUT` routes have been removed instead of retained as compatibility
aliases.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 Portal project settings partial updates use PATCH

Delegated Portal project settings now use `PATCH /portal/settings`. Project
overrides are intentionally sparse and apply only supplied fields, so the
former `PUT` route has been removed instead of retained as a compatibility
alias.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 current-user profile partial updates use PATCH

Authenticated profile updates now use `PATCH /users/me`. The profile payload is
intentionally sparse and applies only supplied fields, so the former `PUT`
route has been removed instead of retained as a compatibility alias. Avatar
replacement remains `PUT /users/me/avatar`.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 private S3 connection partial updates use PATCH

User-owned S3 connection updates now use `PATCH /connections/{connection_id}`.
The payload is intentionally sparse and applies only supplied fields, including
credential and endpoint changes, so the former `PUT` route has been removed
instead of retained as a compatibility alias.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 RGW User partial updates use PATCH

Admin RGW User updates now use `PATCH /admin/s3-users/{user_id}`. The update
payload is intentionally sparse and applies only supplied fields, so the former
`PUT` route has been removed instead of retained as a compatibility alias.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 RGW Account partial updates use PATCH

Admin RGW Account updates now use `PATCH /admin/accounts/{account_id}`. Account
Portal overrides now use `PATCH /admin/accounts/{account_id}/portal-settings`.
Both payloads intentionally apply only supplied fields, so their former `PUT`
routes have been removed instead of retained as compatibility aliases.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 shared S3 connection partial updates use PATCH

The admin shared-S3-connection update now uses
`PATCH /admin/s3-connections/{connection_id}` because
`S3ConnectionAdminUpdate` intentionally applies only supplied fields. The
former `PUT` route has been removed instead of retained as a compatibility
alias.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 storage endpoint partial updates use PATCH

The admin storage-endpoint configuration update now uses
`PATCH /admin/storage-endpoints/{endpoint_id}` because
`StorageEndpointUpdate` intentionally applies only supplied fields. The
former `PUT` route has been removed instead of retained as a compatibility
alias.

The dedicated tags/default operations keep their existing `PUT` routes. The
bundled frontend has been updated with the API cutover. No database migration
is required.

## 2026-10 UI user partial updates use PATCH

The admin UI-user update endpoint now uses `PATCH /admin/users/{user_id}`
because `UserUpdate` intentionally applies only supplied fields. The former
`PUT` route has been removed instead of retained as a compatibility alias.

Avatar replacement and administrator password replacement keep their existing
`PUT` endpoints. The bundled frontend has been updated with the API cutover.
No database migration is required.

## 2026-10 UI group partial updates use PATCH

The admin UI-group update endpoint now uses `PATCH /admin/groups/{group_id}`
because its payload is intentionally partial. The former `PUT` route has been
removed instead of retained as a compatibility alias.

The bundled frontend has been updated with the API cutover. No database
migration is required.

## 2026-10 explicit identity-provider configuration payloads

OIDC and LDAP provider create/update requests now require the complete
non-secret configuration. Nullable configuration fields must be sent
explicitly as `null` when unset.

Secret controls remain optional so an update can preserve an existing OIDC
client secret or LDAP bind password. The bundled frontend already sends the
complete provider configuration. No database migration is required.

## 2026-10 explicit webhook endpoint payloads

Webhook endpoint create and update requests now require both `enabled` and
`event_types`. Requests no longer inject `false` and `["*"]` when those
fields are omitted, preventing incomplete PUT payloads from silently resetting
the endpoint state.

The bundled frontend already sends both fields. No database migration is
required.

## 2026-10 canonical static website payloads

Bucket static-website reads and updates now use separate contracts and require
the complete four-field shape: `index_document`, `error_document`,
`redirect_all_requests_to`, and `routing_rules`. Nullable values remain
nullable, but callers must send them explicitly instead of relying on omission
defaults.

The bundled frontend already sends the complete update payload. No database
migration is required.

## 2026-10 canonical Object Lock payloads

Bucket Object Lock reads and updates now require the complete four-field shape:
`enabled`, `mode`, `days`, and `years`. Each value remains nullable, but callers
must state the intended value instead of relying on omission defaults.

The bundled frontend already sends the complete payload. No database migration
is required.

## 2026-10 canonical public access block updates

Bucket public-access-block reads now return all four nullable state fields,
while update requests require all four boolean values explicitly. Omitted or
`null` write fields are no longer interpreted as `false`.

The bundled frontend already normalizes and sends the complete write payload.
No database migration is required.

## 2026-10 explicit Ceph Admin user caps updates

Ceph Admin RGW user-capability updates now require an explicit `values` array.
An omitted array no longer means an empty replacement set; callers that intend
to clear all caps must send `values: []` explicitly.

The bundled frontend already sends the canonical payload. No database
migration is required.

## 2026-10 explicit tag update payloads

Bucket and storage-endpoint tag updates now require the `tags` field instead of
silently treating an omitted field as an empty list. The bundled frontend
already sends the intended tag list for every update; bucket tags can also be
cleared through the dedicated delete route.

Deploy the backend and bundled frontend together. No database migration is
required.

## 2026-10 canonical storage endpoint responses

Admin storage-endpoint responses now require the complete normalized endpoint
state, including nullable metadata, service-identity status, capabilities,
permissions, tags, and feature configuration. The nested Admin Ops permission
object likewise requires all eight read/write flags. The backend already
materialized these fields; the bundled frontend no longer carries omission
fallbacks.

Deploy the backend and bundled frontend together. No database migration is
required.

## 2026-10 canonical Browser object protection payloads

Browser ACL, legal-hold, and retention writes now use dedicated update payloads.
Legal-hold status plus retention mode and retain-until are required on writes.
Read responses always include their nullable state and version fields, and
retention responses no longer expose the write-only governance-bypass option.

Deploy the backend and bundled frontend together. No database migration is
required.

## 2026-10 canonical Browser object-tag payloads

Browser object-tag updates now require an explicit `tags` collection. Object-tag
responses always include `tags` and nullable `version_id`.

Deploy the backend and bundled frontend together. Direct callers must send the
canonical update object. No database migration is required.

## 2026-10 canonical SNS policy and configuration payloads

Manager SNS topic policy responses and updates now require `policy`, and topic
configuration responses and updates require `configuration`. Empty state is an
explicit empty object instead of an omitted field or model default.

Deploy the backend and bundled frontend together. Direct callers must send the
canonical objects for update requests. No database migration is required.

## 2026-10 canonical bucket scalar configuration responses

Bucket versioning responses now always include nullable `status` plus boolean
`enabled`. Bucket policy responses always include nullable `policy`, and access
logging responses always include `enabled`, `target_bucket`, and
`target_prefix`; disabled logging uses explicit `null` targets.

Deploy the backend and bundled frontend together. Direct callers should no
longer rely on omitted fields for these successful reads. No database migration
is required.

## 2026-10 canonical bucket detail collections

Bucket property responses now always include `lifecycle_rules`, ACL responses
always include `grants`, and static website responses always include
`routing_rules`. Empty state is represented by an empty array instead of an
omitted field or a model default.

Deploy the backend and bundled frontend together. Direct callers should expect
these collections on successful reads. No database migration is required.

## 2026-10 canonical encryption, notification, and replication payloads

Bucket encryption responses and updates now require a `rules` array. Bucket
notification and replication responses and updates likewise require their
`configuration` objects. The backend already materialized these fields for
successful reads, and the bundled frontend already models them as required.

Deploy the backend and bundled frontend together. Direct callers must send the
canonical fields instead of relying on empty defaults. No database migration
is required.

## 2026-10 canonical lifecycle and CORS rule collections

Bucket lifecycle and CORS application responses now always require their
`rules` arrays. The backend already materialized these collections for every
successful read and update, and the bundled frontend already treats them as
required fields; omission fallbacks have been removed from shared bucket
operations.

Deploy the backend and bundled frontend together. Direct callers must include
`rules` when updating lifecycle configuration and must expect `rules` on
successful lifecycle and CORS responses. No database migration is required.

## 2026-10 canonical OIDC provider collection payloads

Admin OIDC provider create and update requests now require JSON arrays for
`scopes` and `trusted_email_domains`. The application API no longer accepts
comma-separated strings or explicit `null` for those fields. The bundled
frontend already sends canonical arrays.

Environment OIDC configuration keeps its existing string parsing because
environment variables are text. No database migration is required.

## 2026-10 canonical bucket Object Lock properties

Bucket property responses now expose Object Lock state only through the
`object_lock` object. The redundant top-level `object_lock_enabled` field has
been removed because it duplicated `object_lock.enabled` from the same storage
read and could drift from the detailed configuration.

Deploy the backend and bundled frontend together. Internal callers of bucket
property routes must read `object_lock.enabled`. No database migration is
required.

## 2026-10 API prefix configuration rename

The backend runtime setting formerly named `API_V1_PREFIX` has been renamed to
`API_PREFIX`. The configured route prefix remains `/api` by default; this change
removes the misleading version suffix from the configuration contract because
the application API is not mounted below a `/v1` path.

Update custom environment files, deployment manifests, and secret/configuration
management to use `API_PREFIX`. The removed `API_V1_PREFIX` variable is no
longer read by the backend and has no compatibility alias. The bundled Helm
values now use `API_PREFIX`.

## 2026-10 canonical bucket migration diagnostic metadata

Migration `0182_canonical_bucket_migration_diagnostics` makes nullable
diagnostic metadata explicit in persisted bucket migration precheck reports.
Existing checks gain `null` values for missing `impact`, `remediation`,
`permission`, `context_id`, `bucket`, and `details` fields instead of relying on
field omission.

Deploy the migration, backend, and frontend together. New diagnostics always
emit the complete canonical shape. Downgrade removes nullable fields whose value
is `null` for compatibility with the previous application version.

## 2026-10 bucket migration execution strategy column

Migration `0179_bucket_migration_execution_strategy` replaces the generic
`execution_plan_json` blob with a nullable `execution_strategy` column on
bucket migration items. Earlier cleanup reduced the plan to one runtime value;
precheck pass/fail state and blocking diagnostics already live in the migration
precheck report.

Deploy the migration and backend together. Draft items keep a null strategy
until precheck assigns one, and runnable items require an explicit supported
strategy. Downgrade reconstructs the former JSON payload from the strategy and
the persisted precheck report.

## 2026-10 canonical bucket migration execution strategy

Migration `0178_canonical_bucket_migration_plan_strategy` makes the execution
strategy explicit in current workflow-v2 item plans. Missing or blank strategy
values that previously meant `current_only` at runtime are rewritten once in
the database; surrounding whitespace is removed. Historical workflow-v1 rows
remain untouched because they cannot be replayed.

Deploy the migration and backend together. The worker no longer supplies a
default strategy for persisted plans and rejects malformed plans instead.
Downgrade keeps the explicit strategy because it is already accepted by the
previous application version.

## 2026-10 bucket migration execution-plan safety cleanup

Migration `0177_remove_bucket_migration_plan_safety` removes
`delete_source_safe`, `rollback_safe`, and `same_endpoint_copy_safe` from
persisted per-bucket execution plans. These values already live in the
precheck report and the worker never reads the execution-plan copies.

Deploy the migration and backend together. New execution plans contain only
the fields needed to execute or reject an item. Downgrade reconstructs the
retired safety fields from the canonical per-item precheck report when those
values are available.

## 2026-10 bucket migration execution-plan cleanup

Migration `0176_remove_bucket_migration_plan_blocked` removes the redundant
`blocked` flag from persisted per-bucket execution plans. The worker already
uses the canonical `supported` field to decide whether an item may run, so
persisting both booleans allowed contradictory state without adding behavior.

Deploy the migration and backend together. New execution plans omit `blocked`.
Downgrade reconstructs it as the inverse of `supported` for the previous
application version.

## 2026-10 bucket migration report version cleanup

Migration `0175_remove_bucket_migration_report_version` removes the unused
`report_version` metadata from persisted bucket migration precheck reports and
per-bucket execution plans. Runtime code never selected behavior from this value,
so retaining it only implied a compatibility contract that did not exist.

Deploy the migration, backend, and frontend together. New reports and execution
plans omit `report_version`. Downgrade restores version `3` on valid persisted
objects for the previous application version.

## 2026-10 canonical bucket migration item identities

Migration `0174_remove_bucket_migration_item_identities` removes duplicated
`source_identity` and `target_identity` fields from persisted per-bucket
precheck items. The execution contexts already belong to the migration record
and report context block, so keeping a copy on every item created redundant
state that could drift.

Deploy the migration, backend, and frontend together. New precheck reports no
longer emit the per-item identity copies. Downgrade reconstructs them from the
canonical migration source and target context IDs for the previous application
version.

## 2026-10 canonical bucket migration diagnostic severity

Migration `0173_canonical_bucket_migration_severity` rewrites persisted bucket
migration diagnostics to use only `severity`. Historical diagnostics that have
only the retired `level` alias are promoted to `severity`; when both fields
exist, `severity` remains authoritative and `level` is removed.

Deploy the migration, backend, and frontend together. New precheck diagnostics
no longer duplicate severity under `level`, and runtime readers no longer carry
the fallback. Migration event records still use their distinct `level` field.
Downgrade recreates diagnostic `level` from canonical severity.

## 2026-10 canonical bucket migration precheck diagnostics

Migration `0172_canonical_bucket_migration_checks` rewrites persisted bucket
migration precheck reports so item diagnostics use only the canonical `checks`
field. Historical reports that contain only the retired `messages` alias are
migrated into `checks`; when both fields exist, `checks` remains authoritative
and `messages` is removed.

Deploy the migration, backend, and frontend together. New reports no longer
emit duplicate `messages` data, and the frontend reads only `checks`. Downgrade
recreates `messages` from canonical checks for the previous application version.

## 2026-10 context-bound direct transfer workers

Deploy the backend and frontend together. Direct transfers now obtain their
authorized endpoint policy through `/api/browser/direct-transfer-policy` and
load an HTTP worker below `/api/browser/direct-transfer-worker/`. Route that
worker prefix to the frontend Nginx, preserving its query string and the
existing `/api` session cookie. The bundled Helm ingress includes the exception
to its general backend API route. Outer proxies must preserve the worker's
single dynamic CSP and disable caching. No database migration is required.

Failed direct writes are no longer automatically replayed through the proxy;
check the destination before retrying an uncertain write.

## 2026-10 Ceph Admin access-key read contract

Ceph Admin user access-key list and user-detail responses no longer include
`secret_key`. Existing RGW keys remain unchanged; this only tightens the
application API so ordinary reads cannot disclose stored or upstream-returned
secret material. Newly created access keys still return their secret once from
the dedicated creation response.

Deploy the backend and bundled frontend together. Direct callers must stop
expecting `secret_key` on existing-key reads. No database migration is required.

## 2026-10 surface-specific bucket operation requests

Bucket integrity checks, purge operations, and targeted usage-statistics scans
now expose separate request schemas for their execution surface. Manager and
Ceph Admin routes accept `buckets`; Storage Ops routes accept `targets` with an
explicit execution context. A request can no longer include, omit, or switch to
the other surface's target collection and rely on router-side compatibility
validation.

Deploy the backend and bundled frontend together. The canonical frontend JSON
payloads are unchanged, but direct callers using the wrong collection now fail
request validation with HTTP `422`. No database migration is required for this
API cutover.

## 2026-10 Ceph Admin tenant-aware bucket identity

Ceph Admin bucket operations now treat the physical bucket identity as the
endpoint, RGW tenant, and unqualified bucket name. Targeted integrity, purge,
usage-statistics, configuration backup, comparison, and bulk UI requests carry
the tenant explicitly so two tenants may contain buckets with the same name
without collapsing into one selection or persisted statistics row. The bundled
frontend and backend must be deployed together because these internal request
payloads changed without compatibility aliases.

Migration `0180_bucket_usage_stats_tenant_identity` adds `bucket_tenant` to
persisted bucket usage snapshots and includes it in their uniqueness key.
Existing rows are assigned the default RGW tenant (`''`). Apply the Alembic
migration with the matching application release before resuming bucket usage
statistics collection.

## 2026-10 Manager and Browser execution-context selector

Manager and Browser routes that select an S3 execution identity now use the
`context_id` query parameter. The former `account_id` parameter is removed from
those routes because the selector may represent an account, S3 connection,
S3 user, or authorized Ceph Admin context. Portal routes continue to use
`account_id` because Portal selects a real BucketReef account.

There is no runtime alias from `account_id` to `context_id`. Deploy the matching
backend and frontend together, and update local scripts or functional clients
that call `/manager` or `/browser` directly.

## 2026-10 canonical production-readiness CLI

The deployment-check CLI now uses the same `production_readiness` terminology
as the Admin surface and service contract:

```bash
python -m app.scripts.check_production_readiness
```

The former `app.scripts.check_production_hardening` module was only a naming
compatibility holdover and has been removed rather than retained as an alias.
Update local operational commands when deploying this backend version.

## 2026-10 canonical audit execution context

Migration `0155_canonical_audit_context` completes the audit execution-context
cutover introduced by migration `0150`. It backfills account-scoped audit rows
created while the compatibility columns still existed, converts historical
Portal account rows to `context_kind=portal_account`, and then removes
`audit_logs.account_id`, `audit_logs.account_name`, their foreign key, and their
account lookup index.

The Admin Audit and Manager Activity APIs now expose only `context_kind`,
`context_id`, and `context_name`; deploy the backend and frontend together. The
webhook event payload keeps its existing optional `account` object so external
webhook consumers are unaffected by the database/API cleanup.

## 2026-10 canonical Portal collaborator requests

Migration `0156_canonical_portal_user_access_requests` completes the Portal
collaborator request cutover. Historical `portal_user_access` additions that
predate explicit collaborator intents and roles are rewritten with
`intent=add` and `portal_role=portal_user`. Current role-change requests and
explicit `portal_manager` additions are preserved.

After this migration, the runtime no longer supplies missing intent or role
defaults when executing a persisted collaborator request. A malformed row is
failed instead of being interpreted as a Portal User addition. Persisted
intent, role, and role-change identifiers are consumed with their canonical
JSON types and values; the runtime does not trim or coerce malformed values.
Apply the database migration before starting the matching backend version.

## 2026-10 canonical audit statuses

Migration `0157_canonical_audit_status` reduces persisted audit outcomes to the
canonical values `success`, `failure`, and `partial`. Historical `failed` and
`error` rows are rewritten to `failure`, including differences in case or
surrounding whitespace. The migration stops if another unknown status exists so
operators can repair it explicitly instead of silently changing its meaning.

After the migration, the database enforces the canonical status set. Manager
Activity therefore filters and renders `failure` directly and no longer carries
aliases for historical values. Apply the database migration before starting the
matching backend version.

## RGW tenant identity

Migration `0152_rgw_principal_tenants` adds non-null `rgw_tenant` fields to
`s3_accounts` and `s3_users`, with the empty string as the canonical
representation of the default RGW tenant. Existing pre-tenant BucketReef
identities are migrated directly to that default tenant instead of retaining an
unknown runtime state.

Migration `0153_rgw_tenant_default_compat` repairs development databases that
may already have executed an earlier, nullable draft of `0152`. It converts
remaining `NULL` tenant values to `''`, restores the non-null/default schema,
and removes the obsolete expression index used by that draft. Current
installations still run the revision in sequence, but normal runtime code does
not keep a nullable-tenant compatibility path.

S3 user uniqueness covers endpoint, tenant and UID. Downgrade is refused if UIDs
would violate the former global uniqueness constraint. Back up the database
before upgrading, as for other schema changes.

## Bucket migration workflow v2

Migration `0135_bucket_migration_workflow` adds persisted preparation, revision-bound
reports, recovery journals, destination provenance and independent cleanup state.
Deploy backend, worker, and frontend together.

Before upgrading, stop admitting new migration commands. Finish or explicitly stop
all queued, running, paused and awaiting-cutover operations using the old version.
Verify restoration of destination protections and of source protections for failed
or canceled operations. Back up the database and configuration, then stop the old
application/workers before applying Alembic. The schema upgrade refuses to proceed
while active operations or unresolved protections are recorded. This check does
not contact S3: operators must also verify the actual storage policies.

Historical final operations remain visible as workflow v1 and cannot be replayed.
Their records are not queued again. Old draft reports and item plans are invalidated;
source deletion is disabled on these drafts and checks must be repeated. Successfully
retained read-only sources can be restored explicitly after upgrading.

API compatibility changes:

- `POST /manager/migrations/{id}/precheck` queues preparation and returns **202**.
  `{ "active_checks": false }` (the default) is read-only; `true` explicitly
  acknowledges active tests after the UI has displayed their effects.
- `GET /manager/migrations/{id}` and its existing SSE stream publish progress,
  preparation state, typed diagnostics and backend-authorized actions.
- `POST /manager/migrations` accepts only draft configuration fields. The update-only
  `configuration_revision` field is rejected on creation. `PATCH` draft updates require
  `configuration_revision`; they increment it and invalidate the report. `POST /start`
  requires the checked revision and, for
  immediate mode, `confirm_write_interruption: true`. Reports expire after 15 minutes.
- `POST /continue` requires `{ "confirmed": true }` for cutover.
- `POST /restore-access`, `/cleanup-target` and `/cleanup-source` require explicit
  confirmation and return **202**. Their status is independent of the transfer result.
- Creation/update rejects `delete_source: true`. The combined rollback endpoints
  reject execution and direct clients to the separate recovery operations.

Preparation has its own worker loop, separate from long copies. Both loops renew
leases during blocking storage requests. Mutation intents and original policies
are saved before active probes; expired leases allow recovery by another worker.
Incomplete restoration blocks preparation. Diagnostics/events exclude secrets and
policy backups; only operator commands are added to the audit log.

Do not downgrade while any operation or protection is active: downgrade refuses
that state. For rollback, use the verified database backup and matching previous
application only after stopping writers and verifying storage protection restoration.
Never allow old and new workers to process the same migration database concurrently.


## 2026-09 canonical onboarding journeys

Migration `0131_canonical_onboarding_journeys` removes pre-v2 onboarding
journey rows. A configured historical journey is reduced to the per-admin
`initial_setup_completed_at` marker so the setup assistant stays completed
until that administrator starts a new current journey. Historical incomplete
journeys were already hidden by the current UI and are discarded.

After the migration, runtime onboarding code accepts only version-2 journey
payloads and no longer parses older journey formats. Downgrade removes the
completion marker and cannot reconstruct deleted historical drafts.

## 2026-09 canonical S3 identity whitespace

Migration `0127_canonical_s3_identity_whitespace` trims surrounding whitespace
from persisted `s3_accounts.rgw_account_id`, `s3_accounts.rgw_user_uid`, and
`s3_users.rgw_user_uid`, then requires those database values to remain already
trimmed and non-empty. Case and all non-surrounding characters are preserved.

The migration stops before changing data if trimming would make two unique
identities collide (`s3_accounts.rgw_account_id` or `s3_users.rgw_user_uid`).
Repair those conflicting rows before upgrading. After the migration, runtime
code consuming persisted account and S3-user identities trusts the database
invariant instead of retaining whitespace cleanup compatibility paths.

Downgrade restores the previous non-empty constraints but cannot restore
whitespace removed by the upgrade.

## 2026-09 canonical S3 user identities

Migration `0126_canonical_s3_user_identities` makes the existing S3-user RGW
identity contract explicit in the database: `s3_users.rgw_user_uid` must contain
at least one non-whitespace character. Creation and import normalize explicit UID
input before persistence. Current creation treats whitespace-only optional UID
input the same as an omitted UID and generates a namespaced
`bkr-s3u-<uuid>` identifier.

The migration stops with an explicit error if an existing row contains a blank
UID because BucketReef cannot safely invent the corresponding remote RGW
identity. Repair those rows before upgrading. After the migration, the runtime
does not retain a blank-UID compatibility path. The downgrade removes the check
constraint but does not recreate invalid values.

## 2026-09 canonical Manager usage snapshot scopes

Migration `0124_canonical_manager_usage_scopes` replaces accepted alternative
spellings of Manager context IDs in bucket usage snapshots, such as `0001`,
`conn-0008`, and `s3u-0003`, with the resolved identifiers `1`, `conn-8`, and
`s3u-3`. Account, connection, and S3-user scopes stay separate. Direct-session
IDs, unrecognized scopes, other workspaces, and historical audit rows are
unchanged.

When several snapshots map to the same context and bucket, the migration keeps
the newest `calculated_at`, breaking ties by `updated_at` and then the highest
row ID. It preserves that row's statistics, warnings, and timestamps and
removes only its superseded duplicate snapshots. Back up the database first;
downgrade leaves canonical snapshots intact and cannot restore discarded
duplicates or their original selector spellings.

Stop old backend instances and ongoing usage scans before applying the
migration, then deploy the matching backend so subsequent scans use the
resolved context ID. No runtime alias lookup is retained. Native storage
permissions and the accepted request selectors are unchanged.

## 2026-09 least-privilege containers and strict network policy

The application images now run with fixed non-root identities and a read-only
root filesystem. nginx moved from container port `80` to `8080`; Compose host
port `8080` and the Helm frontend Service port `80` are unchanged. Replace the
old runtime-installing Compose scheduler with the matching dedicated scheduler
image. Preserve the backend `/data` volume and provide a writable `/tmp` only;
do not make the image root writable to work around startup failures.

Before the first rootless Compose start, stop the old backend and inspect the
existing named volume ownership. If its files were created by root, perform a
single controlled ownership migration to UID/GID `10001:10001` using the exact
volume name from `docker volume ls`; back up the volume first. Do not recreate
or replace it, because it contains the SQLite database and historical encrypted
credentials.

Helm enables the strict NetworkPolicy profile by default and intentionally
refuses incomplete values. Before upgrading, inventory the namespace/pod labels
of the ingress controller and DNS service, the exact proxy pod CIDRs, every
external database CIDR, and all private storage or webhook target CIDRs and
ports. Configure `networkPolicy.ingressController`, `networkPolicy.dns`,
`networkPolicy.publicHttpsEgress`, and any required
`networkPolicy.privateEgress` entries. Public HTTPS ranges must explicitly
exclude private, loopback, link-local, metadata, multicast, and reserved
networks. Render and review the resulting policies before applying them.

This is a breaking deployment boundary: old Helm values that lack selectors or
egress rules no longer render in the strict profile. Disabling the profile is
reserved for an isolated migration validation; production operators must
complete the inventory rather than leave it disabled.

## 2026-09 trusted proxy boundary

The application now reports an empty `TRUSTED_PROXY_CIDRS` as a Warning: with
no trusted peers it safely ignores forwarded client addresses. Trusting the
entire IPv4 or IPv6 address space is a startup security blocker in production.
The Helm chart intentionally keeps a stricter deployment contract and requires
the structured `backend.trustedProxyCidrs` value; it rejects a raw
`backend.env.TRUSTED_PROXY_CIDRS` override. Before upgrading, identify the
actual direct peers that connect to the backend and configure their narrow
CIDRs. Requests from any other peer ignore `X-Forwarded-For`; trusted chains
continue to be evaluated from right to left so an injected left-most value
cannot select a new rate-limit identity.

For Docker Compose with a fixed proxy address, a `/32` entry is preferred. For
Kubernetes, use the verified ingress-controller pod subnet or addresses rather
than the entire cluster or private address space. The chart intentionally fails
to render until this boundary is supplied.

## 2026-09 outbound target allowlists

Production now fails closed for user-controlled outbound destinations. Populate
`USER_SUPPLIED_S3_ENDPOINT_ALLOWED_HOSTS` for user-created S3 connections and
`WEBHOOK_ALLOWED_HOSTS` for webhook endpoints before the
upgrade. A plain entry authorizes only that exact hostname; subdomains require
an explicit `*.example.com` entry, which does not authorize the apex.

Run the preflight against the existing database before deploying:

```bash
cd backend
python -m app.scripts.preflight_outbound_targets
```

The command prints only uncovered hostnames. Existing user-created manual
connections outside the allowlist remain stored but cannot be used until the
operator updates the allowlist. Admin-registered storage endpoints remain
available. Existing webhook URLs outside the webhook allowlist cannot be saved
or delivered. Production webhooks use HTTPS unless the private-target option
and an explicit host allowlist entry are both configured.

Migration `0132_webhook_endpoints` replaces the former per-migration
`bucket_migrations.webhook_url` field with global Admin-managed webhook
endpoints and a durable delivery queue. Distinct legacy migration callback URLs
are imported once as disabled endpoints subscribed to
`manager.bucket_migration.event`; they intentionally have no signing secret and
must be reviewed, assigned a new secret, and enabled by a super-administrator.

The temporary `BUCKET_MIGRATION_WEBHOOK_*` configuration aliases have been
removed. Before upgrading, migrate any remaining webhook settings to the
canonical `WEBHOOK_*` variables. The durable database queue has no queue-size
environment setting.

## 2026-09 Manager and Portal account-role split

Migration `0122_split_account_access_roles` replaces the single association
`role` with independent `manager_role` and `portal_role` columns on direct user
and UI-group links. It also removes the obsolete BucketReef `users.is_root` and
`user_s3_accounts.is_root` columns. Ceph `account-root` identities, RGW account
credentials, and the corresponding technical sessions are unchanged.

The migration maps `account_administrator` and former root links to Manager
administrator only; `portal_user` and `portal_manager` map to the matching
Portal role only. It adds database constraints requiring at least one role and
allowing Manager Browser data access only with a Manager administrator role.
Backend, frontend, and migration must be deployed together because the old
`role` contract is rejected.

Alembic does not contact RGW, delete `AccountIAMUser` rows, reconcile Portal IAM,
or install a post-migration cleanup hook. Historical IAM identities are left
untouched. This project is treated as not yet deployed in production; if an
existing development environment is inconsistent, recreate its database and
RGW test resources instead of adding migration compatibility machinery.

Normal runtime synchronization remains active for explicit Portal-role grants
and revocations after the migration. Downgrade is refused when any association
contains both a Manager and Portal role because the former schema cannot
represent that state without losing access information.

## 2026-08 first-administrator bootstrap cutover

Migration `0119_first_admin_bootstrap` adds the one-time bootstrap singleton.
The former `SEED_` + `SUPER_ADMIN_{EMAIL,PASSWORD,FULL_NAME,MODE}` environment
family and automatic startup creation have been removed without aliases or
runtime warnings.

Before upgrading a deployment that depended on those variables, use the old
release to confirm the administrator exists. If the database is empty, deploy
the migration/backend, then immediately either issue a temporary URL with
`python -m app.scripts.issue_first_admin_bootstrap` or create the administrator
with `python -m app.scripts.create_first_admin`; only then remove the former
variables from Compose, Helm values and secret management. Existing user
databases do not reopen bootstrap. Existing-administrator recovery remains a
separate command and never creates a new first user.

Deploy migration, backend and frontend together. The Admin onboarding response
uses `complete` and the journey list as its setup-state contract; obsolete
endpoint/storage readiness summary fields are no longer returned.

## 2026-08 authentication cutover

Migrations `0107` through `0110` replace legacy browser Bearers and refresh
rows with revocable database sessions, single-use refresh families, separate
external identities, WebAuthn, recovery codes, persistent rate limits, and
scoped API tokens. The cutover revokes every existing UI session and API token,
deletes every S3 session and its credential material, and purges OIDC states.

This is a backend/frontend/configuration big-bang boundary; there is no legacy
Bearer compatibility. Verify a restorable backup and complete credential
re-encryption before deployment, then set
`BUCKETREEF_DB_BACKUP_VERIFIED=true` for the migration run. The `0109`
downgrade deliberately fails because it cannot reconstruct erased secrets.
Follow [Authentication security and cutover](../security/authentication.md).

## 2026-08 strict API object contracts

All backend application request and response objects now reject unknown
properties. Canonical frontend requests are unchanged, but an API request that
still sends a removed field now receives `422` instead of silently discarding
it. Deploy the backend and frontend together, and remove obsolete properties
from any local scripts before upgrading.

## 2026-08 canonical object data plane

The unused Manager object upload, folder creation, deletion, and presigned
download routes under `/api/manager/buckets/{bucket_name}/objects/*` have been
removed. The Manager bucket detail keeps its read-only object listing endpoint.
Use the Browser object endpoints for data-plane operations; there is no Manager
compatibility alias. Deploy the backend and frontend together, and migrate any
local functional tooling to the Browser routes before upgrading.

## 2026-08 strict environment-managed provider configuration

Entries nested under `OIDC_PROVIDERS`, `LDAP_PROVIDERS`, and
`ENV_STORAGE_ENDPOINTS` now reject unknown fields instead of silently ignoring
them. Before deploying, remove obsolete fields and correct misspelled names in
those environment values. Valid configurations and the top-level handling of
unrelated process environment variables are unchanged.

## 2026-08 canonical Storage Endpoint feature configuration

Migration `0115_canonical_storage_endpoint_features` rewrites every persisted
Storage Endpoint feature document under the single `features` root. It converts
the former health-check `url` and `endpoint` aliases to `healthcheck_url`,
normalizes configured URLs and modes, and removes unknown feature names or
fields that the runtime previously ignored.

After this boundary, new API, automation, seed, and `ENV_STORAGE_ENDPOINTS`
`features_config` values must use the canonical shape emitted by the Admin
frontend. Unknown names and fields are rejected instead of being silently
discarded. The database migration cannot rewrite environment values, so update
those values before deploying. Invalid active values with the wrong type stop
the migration explicitly. The downgrade keeps the canonical YAML because
discarded inert keys and aliases cannot be reconstructed.

## 2026-08 canonical Storage Endpoint providers

Migration `0116_canonical_storage_endpoint_providers` trims and lowercases the
persisted provider values `ceph`, `aws`, and `other`, converts every missing or
unsupported historical value to the previously effective `ceph` default, and
adds a database constraint. New invalid values now fail validation instead of
being interpreted silently as Ceph. The downgrade removes the constraint but
keeps the canonicalized values.

## 2026-08 canonical Storage Endpoint admin endpoint

Migration `0117_remove_storage_endpoint_admin_endpoint` removes the redundant
`storage_endpoints.admin_endpoint` column. The configured override already
lives in `features_config` at `features.admin.endpoint`, which is now the only
persisted source. The downgrade recreates an empty nullable column but cannot
reconstruct its former duplicate values.

Storage Endpoint create and update requests now reject the removed
`admin_endpoint` property. Put the override in the canonical `features_config`
document instead. Storage Endpoint responses expose it through
`features.admin.endpoint`; the separate feature-detection request keeps its
transient `admin_endpoint` probe input. Deploy migration, backend, and frontend
together.

## 2026-08 canonical Storage Endpoint URLs

Migration `0118_canonical_storage_endpoint_urls` trims persisted Storage
Endpoint URLs, removes trailing slashes, and adds a database constraint that
keeps new values canonical. The migration stops before changing the schema if
an URL becomes empty or if two endpoints would become duplicates after
normalization; repair or delete the reported rows and retry the upgrade.

Runtime Ceph Admin consumers now trust this database contract instead of
repairing endpoint URLs or supplying missing provider, region, and TLS values.
The downgrade removes the constraint but keeps the normalized URLs.

## 2026-08 Clipboard API requirement

Frontend copy actions now rely exclusively on the browser Clipboard API. The
deprecated `document.execCommand("copy")` fallback has been removed. Serve the
application from a context where `navigator.clipboard.writeText` is available;
otherwise copy actions report that the clipboard is unavailable.

## 2026-08 minimal Topic contract

Manager Topic responses no longer expose the unused `owner` and `is_ceph`
properties. Provider-specific listing remains an internal backend concern;
clients receive only the canonical topic name, ARN, and configurable
attributes. Deploy the backend and frontend together.

## 2026-08 minimal Portal state contract

`GET /api/portal/state` now returns only effective Portal role, permissions,
and feature flags. The duplicated project ID, IAM identity, access-key list,
provisioning marker, endpoint, usage, quota, and creation marker fields have
been removed. Use the selected `/api/portal/accounts` entry for project
identity, `/api/portal/access-keys` for IAM identity and keys, and
`/api/portal/usage` for usage and quotas. Deploy the backend and frontend
together.

## 2026-08 removal of temporary S3 connections

Migration `0106_remove_temporary_s3_connections` removes the retired
`is_temporary`, `temp_user_uid`, and `temp_access_key_id` columns. The internal
temporary-connection cleanup route and the hidden execution-context contract
are removed with them. Expiring STS credentials remain supported through
`session_token` and `expires_at`.

The migration stops before changing the schema if a temporary connection still
exists. While the previous release is running, revoke every remote RGW access
key recorded by those rows and then delete the corresponding temporary
connections. Verify a restorable database backup before retrying the upgrade.
Deploy the migration, backend, and frontend together. Downgrade recreates empty
compatibility columns but cannot restore the removed subsystem or remote keys.

## 2026-08 canonical execution-context catalogue

The unused `GET /api/manager/accounts` endpoint has been removed. The frontend
already uses `GET /api/me/execution-contexts?workspace=manager`, whose explicit
context kinds and capabilities replace the heterogeneous account-shaped
response. Requests to the removed endpoint now return `404`. Canonical account
responses now always include a non-null Storage Endpoint ID, name, URL, and
capability map, plus an explicit default-endpoint flag. Execution-context
responses likewise always include endpoint name, URL, default flag, and
capabilities; only the endpoint ID remains nullable for custom connections.
The catalogue no longer returns `quota_max_size_gb`, `quota_max_objects`,
`max_buckets`, `max_users`, `max_roles`, or `max_groups`: these fields were
always `null` after dynamic RGW limit lookups moved to the dedicated Manager
context endpoint. Deploy the backend and frontend together.

## 2026-08 removal of the dead Portal key setting

Migration `0093_remove_dead_portal_key_setting` removes `allow_portal_key`
from global application settings and account-level Portal overrides. The flag
was persisted and exposed by the API but never affected Portal behavior.

Deploy the migration, backend, and frontend together. Portal settings payloads
containing the removed field are rejected, including custom bootstrap JSON
files. Invalid bootstrap files now fail explicitly instead of silently loading
defaults. Downgrade does not recreate this no-op value.

## 2026-08 canonical Portal access-key bucket field

Portal access-key responses now expose the selected S3 bucket only as
`bucket_name`. The duplicate response field `storage_space_id` has been
removed; it remains the request field used when creating an external key.
Deploy the backend and frontend together.

## 2026-08 canonical UI user roles

Migration `0092_canonical_user_roles` converts `users.role` to exactly one of
`ui_superadmin`, `ui_admin`, `ui_user`, or `ui_none`, installs a database check
constraint, and sets the database default to `ui_user`. Known historical names
are mapped to their canonical role; unknown or empty values become `ui_none` so
the migration never widens access.

Deploy the migration, backend, and frontend together. Admin user APIs reject
removed role names with `422`, and the frontend no longer repairs roles from
API responses or persisted sessions. Downgrade drops
the constraint but does not recreate historical role spellings.

## 2026-08 control-plane audit boundary

Migration `0091_purge_data_plane_audit_logs` irreversibly removes historical
object data-plane actions and non-audit operational noise from `audit_logs`.
Take a verified application database backup immediately before applying it;
downgrade is intentionally unsupported and recovery requires restoring that
backup. Deploy the migration, backend, and frontend together.

The application audit now contains only control-plane, security,
configuration, and global workflow-control events. Object evidence moves to
Server Access Logging or the provider's equivalent. Portal clients must use
`/api/portal/access-logs/page` and `/api/portal/access-logs/raw`; the
removed non-paginated `/api/portal/access-logs` route,
`/api/portal/transfers`, and
`/api/portal/transfers/server-access-logs*` routes return `404`. The
remaining access log routes do not accept `mode` and expose all S3 categories
with action, space, path, identity, and result filters.

## 2026-08 canonical bucket migration JSON state

Migration `0090_canonical_bucket_migration_json` rewrites persisted bucket
migration reports, snapshots, plans, replication state, policy backups, diff
samples, and event metadata to JSON objects or SQL `NULL`. Invalid operational
state becomes `NULL`, forcing safe recomputation or a new precheck. Historical
diff and event values remain available under `value` or `unparsed` envelopes.
The absence of an original bucket policy is now stored directly as SQL `NULL`
instead of the JSON scalar `null`.

Deploy the migration and backend together. Worker and API readers now reject
malformed or non-object persisted JSON rather than silently treating it as
missing state. The cleanup is not reversed on downgrade.

## 2026-08 canonical custom S3 connection endpoints

Migration `0089_canonical_s3_connection_endpoints` rewrites every manual S3
connection endpoint with the exact current fields, maps the removed
`provider_hint` key to `provider`, supplies current boolean defaults, and clears
custom JSON from connections bound to a registered Storage Endpoint. The
migration stops with the affected connection ID if a manual connection has no
usable endpoint URL; repair or delete that invalid row before retrying.

Deploy the migration and backend together. Runtime readers now reject malformed,
partial, or unknown custom endpoint data instead of repairing it or consulting
removed model attributes. Registered endpoints also propagate their configured
TLS verification flag to connections. The cleanup is not reversed on downgrade.

## 2026-08 canonical account Portal settings overrides

Migration `0088_canonical_portal_settings_override` replaces the historical
`{"admin": {...}}` envelope with the direct `PortalSettingsOverride` object.
It removes obsolete `portal_manager` data and unknown or invalid fields while
retaining every valid current override. Empty, malformed, and non-object values
become `NULL`, the canonical representation of no account override.

Deploy the migration and backend together. The backend no longer unwraps old
payloads or hides invalid persisted values, and the API rejects unknown override
fields. The data cleanup is not reversed on downgrade.

## 2026-08 canonical audit metadata

Migration `0087_canonical_audit_metadata` rewrites every non-null audit metadata
payload as a JSON object. Existing objects retain their fields, other valid JSON
values move under `value`, and malformed historical text moves under `unparsed`
so old audit evidence is not discarded. New oversized metadata uses a bounded,
valid JSON envelope with a preview and the original serialized length.

Deploy the migration and backend together. Audit and Portal readers now share a
strict object contract instead of hiding malformed storage independently. The
data cleanup is not reversed on downgrade.

## 2026-08 canonical cost operation breakdowns

Migration `0086_canonical_cost_ops_breakdown` rewrites each available daily
operation breakdown as a JSON object mapping operation names to integer counts.
Malformed, non-object, and empty payloads become `NULL`, which remains the
canonical representation when detailed operation data was not collected.

Deploy the migration and backend together. Cost aggregation now rejects any
remaining non-canonical breakdown instead of skipping it or coercing values at
runtime. The data cleanup is not reversed on downgrade.

## 2026-08 canonical bucket usage statistics JSON

Migration `0085_canonical_bucket_usage_stats_json` rewrites every persisted
bucket distribution as a JSON list of objects and every non-null warning set as
a JSON list of strings. Malformed containers and entries are removed once;
`warnings_json = NULL` remains the canonical representation of no warnings.

Deploy the migration and backend together. Snapshot loading now validates every
distribution entry and warning instead of returning empty data for malformed
storage. The data cleanup is not reversed on downgrade.

## 2026-08 canonical managed-access IAM state

Migration `0084_canonical_managed_access_iam_lists` rewrites the tracked IAM
groups, managed policies, and inline policy names for every managed private
access as ordered, deduplicated JSON lists of non-empty strings. Malformed or
non-list values become empty lists.

Deploy the migration and backend together. Saga replay and cleanup now reject
any remaining malformed or non-string IAM state instead of coercing or dropping
values at runtime. The data cleanup is not reversed on downgrade.

## 2026-08 legacy Portal application settings

Migration `0099_migrate_legacy_portal_app_settings` updates every database-backed
application settings payload that still uses the former Portal contract. It
renames `allow_portal_user_bucket_create` to
`allow_private_storage_space_create` without overwriting an existing current
value, and removes the obsolete `bucket_access_policy`,
`iam_group_manager_policy`, and `iam_group_user_policy` fields. Deployments that
already applied the equivalent manual repair are left unchanged.

The migration validates all rows before writing any update. It stops explicitly
when a payload or its `portal` section is not a JSON object, or when the legacy
create setting is not a boolean. Restore or correct that source value before
retrying the upgrade. The optional `APP_SETTINGS_PATH` bootstrap file is outside
Alembic's database scope and must already use the current field names. Removed
policy values and renamed settings are not reconstructed on downgrade.

## 2026-08 canonical UI-managed OIDC scopes

Migration `0083_canonical_oidc_provider_scopes` rewrites every UI-managed OIDC
scope set as a non-empty JSON list of trimmed strings. Empty, malformed, or
non-list values receive the current `openid`, `email`, and `profile` defaults.

Deploy the migration and backend together. OIDC provider loading now rejects
any remaining malformed, empty, or non-string scope set instead of repairing it
at runtime. The ORM and database defaults are also aligned. Data cleanup is not
reversed on downgrade.

## 2026-08 canonical persisted application settings

Migration `0082_canonical_app_settings_payload` rewrites every database-backed
application settings payload as a JSON object and replaces malformed or
non-object values with `{}`. Valid object fields remain unchanged.

Deploy the migration and backend together. Once settings have been imported to
the database, loading now uses the strict `AppSettings` contract and exposes
invalid values instead of reverting silently to defaults. The optional disk
bootstrap uses defaults only when the configured bootstrap file is absent; an
invalid file fails validation and must already use the current schema. Data
cleanup is not reversed on downgrade.

## 2026-08 canonical Portal request JSON

Migration `0081_canonical_portal_request_json` rewrites every Portal request
payload and non-null result as a JSON object. Malformed and non-object values
become `{}` while an absent result remains `NULL` for undecided requests.

Deploy the migration and backend together. Portal request execution and API
serialization now reject any remaining malformed or non-object JSON instead of
repairing it at runtime. The data cleanup is not reversed on downgrade.

## 2026-08 canonical user notification payloads

Migration `0080_canonical_user_notification_payloads` rewrites notification
payloads as JSON objects, replaces null or malformed values with `{}`, and makes
`user_notifications.payload_json` non-nullable with the same database default.

Deploy the migration and backend together. Notification serialization now
rejects non-object or malformed payloads instead of silently returning an empty
object. Downgrade makes the column nullable again but keeps canonicalized data.

## 2026-08 canonical user UI preferences

Migration `0079_canonical_user_ui_preferences` rewrites every persisted user UI
preference payload to the current `theme` and `selected_portal_account_id`
contract. Malformed or invalid payloads become empty preferences, removed fields
are discarded, and account identifiers are trimmed.

Deploy the migration and backend together. The backend now treats any remaining
non-canonical payload as data corruption instead of repairing it during profile
serialization. The data cleanup is intentionally not reversed on downgrade.

## 2026-08 normalized tags only

Migration `0078_remove_legacy_tags_json` removes the `tags_json` mirrors from
storage endpoints, S3 accounts, S3 users, and S3 connections. Normalized tag
definitions and ordered link tables have been the only read source since their
introduction; the backend now writes only that canonical model.

Deploy the migration and backend together because older instances still write
the removed columns. Downgrade recreates each JSON mirror from the normalized
links in stored order, but the current backend never reads or maintains it.

## 2026-08 canonical S3 connection capabilities

Migration `0077_canonical_s3_connection_capabilities` rewrites every cached S3
connection capability profile to a JSON object containing the required boolean
`can_manage_iam`. Malformed profiles and the removed `iam_capable` key resolve
to the safe value `false`; unrelated current extension fields are retained. The
database default is changed to the same canonical profile.

Deploy the migration and backend together. The backend now treats missing,
malformed, or non-canonical profiles as data corruption instead of repairing
them at runtime. Downgrade restores the old empty-object default but cannot
recreate discarded malformed or legacy values.

## 2026-08 schema index reconciliation

Migration `0076_remove_redundant_provider_indexes` removes the non-unique LDAP
and OIDC `provider_id` indexes that duplicated the existing unique constraints.
It does not rewrite provider data or weaken uniqueness. The SQLAlchemy metadata
now also reflects the indexes already installed by earlier migrations, and the
full Alembic head is checked against that metadata in the backend test suite.

## 2026-08 canonical S3 session capabilities

Migration `0075_canonical_s3_session_capabilities` materializes a complete
capability snapshot for every existing direct S3 session, replaces missing or
malformed snapshots with the current safe defaults, and makes
`s3_sessions.capabilities` non-nullable. The backend no longer repairs invalid
session capability data at runtime.

Stop backend instances while applying the migration so no session is created
during the table alteration. Existing direct S3 sessions remain usable with
their canonicalized snapshot. Downgrade makes the column nullable again but
does not recreate missing or malformed values; deploy matching code if a
downgrade is unavoidable.

## 2026-08 timezone-aware UTC migration

Migration `0074_timezone_aware_utc_timestamps` converts every persisted
PostgreSQL timestamp to `TIMESTAMP WITH TIME ZONE`. Existing values are
interpreted explicitly as UTC during the conversion; no server or session
timezone is consulted. The application now rejects timezone-naive datetime
writes and serializes persisted values with an explicit UTC offset.

Stop all backend instances and workers before applying the migration, because
old code still writes and compares naive values. Back up the database, run
Alembic through revision `0074`, then deploy the backend and frontend together.
On large PostgreSQL tables, plan a maintenance window: each altered table is
locked while PostgreSQL rewrites or validates its timestamp columns.

SQLite has no timezone-bearing timestamp storage, so the migration does not
rewrite its columns. The SQLAlchemy adapter still rejects naive application
writes, stores the normalized UTC wall-clock representation, and restores an
aware UTC value on every read. Back up the database, `-wal`, and `-shm` files as
one consistent set before upgrading.

Downgrade converts PostgreSQL values back to timezone-naive UTC. It does not
restore the old application contract; deploy compatible code at the same time
if a downgrade is unavoidable.

## 2026-08 managed private access migration

Migration `0070_managed_private_access` is DB-only. It adds
`s3_connections.server_managed` with a false default and creates the durable
`managed_private_accesses` saga table. Existing connections and remote RGW/IAM
resources are not modified, adopted, or contacted during Alembic.

Deploy backend and frontend together so Manager does not expose a provisioning
action before the specialized endpoints and immutable-credential rules are
available. After upgrade, smoke-test both **Create my private access** branches,
Profile deletion, and **Retry cleanup**. A `cleanup_pending` row is operational
state, not disposable bookkeeping: retain it until the idempotent remote
cleanup succeeds.

Downgrade removes only the new table and marker column. It cannot clean up
remote identities or keys already created by the application; delete every
server-managed private connection through the running orchestrator before
downgrading.

## 2026-08 canonical access model migration

!!! note "Historical migration boundary"
    This section describes the intermediate schema and API at revision `0069`.
    The later [Manager and Portal account-role split](#2026-09-manager-and-portal-account-role-split)
    replaces that single role with two independent axes. Current payloads use
    `manager_role` and `portal_role`, not `role`; see the
    [current access contract](/developer/en/architecture/identity-and-execution/#account-access-axes).

Migration `0069_canonical_account_access_roles` was a breaking, DB-only
migration. It replaced the previous account-association dimensions with one ordered
`role`, removed the legacy columns in the same release, and made shared S3
connections Manager-only.

At that release, the backend API accepted and returned only the canonical
`role`; backend and frontend had to be deployed together across that boundary.

### Required deployment sequence

Rolling upgrade is prohibited because old backend instances and workers still
expect the removed columns.

1. Stop old application instances and every background worker.
2. Create and verify a restorable database backup. For SQLite, include the
   database, `-wal`, and `-shm` files as one consistent set. For PostgreSQL,
   validate the dump by restoring it to a separate database.
3. If the migration reports associations without useful rights, set
   `BUCKETREEF_DB_BACKUP_VERIFIED=true` only after that restore verification.
   Empty databases and databases without such associations do not require this
   override.
4. Run Alembic through revision `0069` while the old processes remain stopped.
5. Deploy the new backend and frontend together, then start new workers.
6. Run `python -m app.scripts.reconcile_portal_iam` first in its default dry-run
   mode. Review the per-account summary and then rerun with `--apply`.
7. Smoke-test Admin associations, shared-connection remediation, empty/private
   Browser, Manager Browser, Portal, direct S3 sessions, and Ceph Admin Browser.

Alembic never contacts RGW. Portal IAM reconciliation is intentionally a
separate, resumable command; a partial IAM failure must not alter the canonical
database role.

### Data transformation

- At revision `0069`, `portal_user`, `portal_manager`, and
  `account_administrator` were the only stored association `role` values.
- Root account links always become `account_administrator`.
- A legacy admin flag outranks a legacy Portal role.
- Associations that previously granted no useful right are **deleted**, not
  retained with `role = NULL`. No tombstone or compatibility row is written.
- Shared connections have Browser access disabled. Those with Manager access
  stay ready; the others receive the stable remediation reason
  `shared_connection_manager_access_disabled`.
- Private connection owners, credentials, activity flags, and access flags are
  unchanged.

The downgrade reconstructs the legacy schema and fields for surviving rows. It
cannot recreate deleted no-right associations; restoring the verified backup is
the only recovery path for that explicitly non-reversible data.

## 2026-07 Portal Storage Space access migration

Migration `0066_portal_storage_space_access_model` clears the database state of
existing Portal Storage Spaces before installing the strict private/team access
model. It removes their grants, external-credential records, and public links.
It does not contact RGW or delete storage-side resources.

1. Back up the application database and record the spaces that must be recreated.
2. Before upgrading, remove the old Storage Spaces and revoke their external IAM
   credentials through the application workflow. This must happen before Alembic
   because a database migration cannot revoke RGW-side credentials.
3. Apply the database migration. Any remaining Portal database metadata is
   purged transactionally; unrelated public links are preserved.
4. Recreate private spaces or re-import team spaces so bucket policies, IAM
   identities, and fixed Portal groups are provisioned with the strict model.

There is no runtime conversion or compatibility path for old Owner grants,
shared-space owners, or editable Portal IAM policies.

## 2026-08 S3 connection credential owner types

Migration `0073_canonical_connection_owner_types` makes connection identity
metadata strict. It converts `rgw_user` to the canonical `s3_user`, trims and
normalizes the supported values, clears unsupported owner types, and installs a
database constraint. The only stored values are now `iam_user`, `account_user`,
`s3_user`, or `NULL`.

The downgrade removes the constraint but does not recreate noncanonical values.
Back up the application database before the migration if those values must be
inspected or exported.

## 2026-08 canonical S3 user endpoints

Migration `0094_canonical_s3_user_endpoints` assigns every detached S3 user to
the current default Ceph endpoint, then makes `s3_users.storage_endpoint_id`
non-nullable. Before upgrading, verify that a Ceph endpoint is marked as the
default. The migration stops with an explicit error when detached users exist
without such an endpoint; it does not guess another backend or retain a runtime
fallback.

After this boundary, S3 user creation and import APIs require
`storage_endpoint_id`. Existing S3 users cannot change endpoint. Deploy the
backend and frontend together because the request and response contracts are
both strict.

## 2026-08 canonical S3 account endpoints

Migration `0095_canonical_s3_account_endpoints` assigns every detached S3
account to the current default Ceph endpoint, then makes
`s3_accounts.storage_endpoint_id` non-nullable. Before upgrading, verify that a
Ceph endpoint is marked as the default. The migration stops with an explicit
error when detached accounts exist without such an endpoint; it does not retain
a runtime fallback.

After this boundary, S3 account creation and import APIs require
`storage_endpoint_id`, and update requests reject an explicit `null` endpoint.
Account-specific RGW operations always use the persisted endpoint. Deploy the
backend and frontend together because the request and response contracts are
both strict.

## 2026-08 canonical secret keyrings

The backend now accepts only the keyring settings `JWT_KEYS` and
`CREDENTIAL_KEYS`. Before upgrading, replace a singular `FERNET_KEY` with a
one-item `JWT_KEYS` list and replace a singular `CREDENTIAL_KEY` with a one-item
`CREDENTIAL_KEYS` list. Keep every historical key required to validate active
JWTs or decrypt stored credentials, with the key used for new values first.

Empty keyrings are rejected at startup. The singular environment variables are
ignored and no longer provide runtime compatibility.

## 2026-08 strict credential encryption

Migration `0098_encrypt_plaintext_secrets` encrypts any remaining plaintext
credentials in storage endpoints, S3 accounts, IAM users, S3 users, S3
connections, authentication providers, and S3 sessions. After this boundary,
the ORM rejects plaintext or otherwise unreadable values instead of returning
them as usable secrets.

Before upgrading, configure `CREDENTIAL_KEYS` with the current key followed by
every historical credential key still needed by the database. The migration
stops when a stored Fernet token cannot be decrypted, rather than encrypting an
unreadable token a second time. Its downgrade keeps credentials encrypted.

## 2026-08 Manager Browser active context

Migration `0103_manager_browser_data_access` adds the non-null
`allow_manager_browser_data_access` flag to UI-user and UI-group associations
with S3 Accounts and RGW users. The secure default is `false`; no existing
association is enabled automatically.

Deploy the backend and frontend together. The embedded `/manager/browser` now
uses the active Manager `ctx` and sends `X-S3-Workspace: manager-browser` on all
Browser API calls. An older frontend will not send that explicit surface, while
an older backend cannot enforce the new per-association permission. After
deployment, verify Account, RGW-user, owned private-connection, shared-
connection, and immediate-revocation scenarios. Standalone `/browser`, Portal,
and Ceph Admin Browser execution policies are unchanged.

## 2026-08 canonical S3 user execution context

The execution-context API now reports managed RGW users with
`kind="s3_user"`. The obsolete `legacy_user` value is rejected throughout the
backend and frontend; no runtime alias is retained. Context identifiers remain
`s3u-<id>`, so persisted bucket migrations and workspace selections do not
require a database migration. Deploy the backend and frontend together.

## 2026-08 canonical S3 user association payloads

Admin user and group writes now accept only structured `s3_user_links` entries.
The obsolete `s3_user_ids` request field is rejected with `422`; every link
must state its `s3_user_id` and may explicitly enable
`allow_manager_browser_data_access`. Responses continue to expose the
association details needed by the frontend. The duplicate `accounts`,
`s3_users`, and `s3_connections` identifier arrays are no longer returned by
Admin user or group responses; consume `account_links`, `s3_user_links`, and
`s3_connection_details` instead. The nested `effective_access` projection also
stops duplicating canonical links and details through `accounts`, `s3_users`,
`s3_connections`, and `manager_browser_s3_users`. Admin user responses expose
group membership only through `group_details`, and group responses expose
members only through `user_details`; the duplicate `group_ids` and `user_ids`
response fields are removed. Deploy the backend and frontend together.

## 2026-08 canonical RGW user principal links

Admin RGW user responses now expose UI-user and UI-group associations only
through `user_links` and `group_links`. The duplicate `user_ids`, `user_details`,
`group_ids`, and `group_details` response fields are removed. Updates also accept
only the structured link fields; sending `user_ids` or `group_ids` returns `422`.
Deploy the backend and frontend together.

## 2026-08 canonical S3 connection principal details

Admin S3 connection responses no longer duplicate `user_details` and
`group_details` through `user_ids` and `group_ids`. The structured details are
the only response representation. The `group_ids` update field remains the
canonical write contract for replacing group links. Deploy the backend and
frontend together.

## 2026-08 redundant API route removal

Four backend routes that had no frontend consumer are removed without runtime
aliases:

- `GET /api/admin/stats/overview`: use the canonical
  `/api/admin/stats/summary`, `/api/admin/stats/storage`, and
  `/api/admin/stats/traffic` resources.
- `POST /api/admin/users/{user_id}/assign-account`: replace account links
  atomically through `PATCH /api/admin/users/{user_id}` with `account_links`.
- `GET /api/connections/{connection_id}/capabilities`: consume the
  `capabilities` field returned by the connection list and write resources.
- `GET /api/portal/eligibility`: load `/api/portal/state`, which enforces the
  same eligibility check and returns `403` when Portal is unavailable.

Requests to the removed paths return `404`. Deploy the backend and frontend
together.

## 2026-08 canonical RGW account principal links

Admin RGW account responses and minimal summaries now expose UI-user and
UI-group associations only through `user_links` and `group_links`. The duplicate
`user_ids` and `group_ids` response fields are removed. Updates also accept only
the structured link fields, which require an explicit role for every principal;
sending `user_ids`, `group_ids`, or a null link list returns `422`. Send an empty
list to clear an association set. The obsolete `is_s3_user` discriminator is
also removed because these endpoints return RGW accounts exclusively. Consumers
that operate on mixed execution contexts must use the canonical `kind` field.
The unused `root_user_email` and `root_user_id` projections are no longer
returned, eliminating per-account root-link lookups. Account response models now
reject unknown fields internally so obsolete projections cannot be silently
reintroduced. Deploy the backend and frontend together.

## 2026-08 schema drift reconciliation

Migration `0105_reconcile_schema_drift` converges databases created by two
historical schema variants. It converts legacy text-backed
`storage_endpoints.latitude` and `storage_endpoints.longitude` columns to
floating-point columns, while leaving already-canonical databases unchanged.
Blank coordinate strings become `NULL`. Non-numeric, non-finite, or out-of-range
coordinates stop the migration with the affected endpoint ID and name; repair
those values before retrying.

Some older databases also contain the orphan
`can_access_manager_bucket_usage_stats` column on `users` or `ui_groups`. No
application model, permission check, or API consumes that flag. The migration
drops the column only when it exists and requires a tested restorable backup:

1. Back up the database and verify a restore.
2. Set `BUCKETREEF_DB_BACKUP_VERIFIED=true` for the migration process.
3. Run the Alembic upgrade.

Fresh databases without the orphan columns do not require the backup flag. A
downgrade recreates both legacy columns with `false`; it cannot restore discarded
orphan values.

## 2026-08 canonical RGW account identities

Migration `0104_canonical_s3_account_identities` requires every persisted RGW
account to have non-empty `rgw_account_id` and `rgw_user_uid` values. The
migration intentionally stops with the affected database IDs and names when an
incomplete row exists; repair those identities from the authoritative Ceph RGW
configuration before retrying the upgrade.

Admin RGW account responses now use the database identifier as the numeric `id`
and expose the external RGW identifier through the required `rgw_account_id`
field. The duplicate `db_id` field and the unused root `rgw_user_uid` projection
are removed. Deploy the backend and frontend together.

Portal account responses use the same numeric database `id`; URL parameters and
browser preferences may still serialize that value as text. Linked account
details returned with UI groups now require `rgw_account_id`. Backend services
that operate on persisted accounts consume the stored `rgw_user_uid` directly
instead of deriving an `-admin` identity from the account ID.

## 2026-03 compatibility cleanup

Current behavior after cleanup:

- API context selectors reject legacy account inputs (`-1`, `null`, negative ids) with `400`.
- Frontend context persistence uses the independent
  `selectedManagerExecutionContextId` and `selectedBrowserExecutionContextId`
  preferences, with `ctx` as the authoritative URL parameter in each tab.
- Legacy shared local storage keys (`selectedExecutionContextId`,
  `selectedS3AccountId`, and `selectedBrowserContextId`) are ignored.
- Removed runtime env flags `COST_ENABLED` and `HEALTHCHECK_ENABLED` are no
  longer accepted; use the explicit `FEATURE_COST_ENABLED` and
  `FEATURE_ENDPOINT_STATUS_ENABLED` force-locks.

## Operator guidance

- Remove scripts relying on legacy selector values.
- Validate UI context persistence after upgrades.
- Use explicit `FEATURE_*` controls for forced feature state.
- Back up the application database before migrations.
- Confirm the credential encryption key is unchanged after restore or redeploy.
- Validate the Admin, Manager, Portal, and Browser entry routes with the intended roles after upgrade.

## Related pages

- [Configuration](../configuration/index.md)
- [Production readiness](production-readiness.md)
- [Backup and restore](backup-restore.md)
- [Developer docs maintenance](/developer/en/documentation/maintenance/)


## Durable endpoint identity and rotation boundary

Every Ceph entry in `ENV_STORAGE_ENDPOINTS` must now explicitly declare
`service_identity_mode` (`managed` or `external`). Add this field to deployment
inventories before upgrading, including inventories shared with user instances.
The whole inventory is validated before endpoint writes; missing mode or incomplete
external credentials prevents synchronization/startup. Generated managed secrets
stay encrypted in the database and are preserved across unchanged ENV reloads.

Runtime is required for Admin/Accounts; Supervision is required for Metrics, Usage
or signed S3 healthchecks. Ceph Admin alone requires neither service identity.
On upgrade from `0.2.13`, migration creates the previously absent Runtime identity for
each existing Ceph endpoint using the endpoint's migrated `external` mode and a
`missing` status. Configure Runtime Read Ops with exactly
`accounts=read;user-info-without-keys=read;buckets=read` and no admin/system flag
before Manager/Portal live account, user and bucket enrichment resumes. There is no
Admin Ops fallback for these reads.

Existing Supervision credentials migrate as external without changing their RGW
users. They must validate with exactly `usage=read;buckets=read` and no admin/system
flag; adjust or replace credentials whose RGW user carries broader or different
capabilities. External mode requires complete pairs for enabled features; unused
pairs can remain empty, while partial pairs prevent startup. Managed mode
provisions the required identities at save/apply or during recovery; disabling
features keeps configured identities intact. Unused empty placeholders are skipped.
Existing managed endpoints needing Supervision require Admin Ops `users=write`
once to provision it. Usage availability is determined by Supervision and no longer
requires Admin Ops `usage=read`. Ready managed identities survive removal of
`users=write`; creating, converting or rotating them requires restoring that
permission.

Migration `0141_durable_key_rotation` replaces `previous_access_key` with an encrypted
rotation journal, including existing pending retirements. Preserve the database and
credential encryption ring together. Resume pending operations through
[Key Rotation](../platform/key-rotation.md); finish them before downgrading.
Administration and dedicated Ceph Admin instances reconcile persisted endpoints on
startup. User instances never perform those remote mutations.
