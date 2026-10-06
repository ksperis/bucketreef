# Dedicated Ceph Admin instance

Use a separate instance when Ceph RGW administration needs its own network and
secret boundary. BucketReef has only three deployment profiles: `full`, `admin`
and `user`. A dedicated instance uses `full` with explicit runtime switches;
there is no separate security mode or implicit isolation guarantee.

The recommended isolated deployment has its own PostgreSQL database, UI/API JWT
and credential key rings, RGW identity, administrator bootstrap, and restricted
ingress. Sharing the database and credential ring would retain access to the
same secrets and would provide only surface/network separation.

Disable Ceph Admin on the main `admin` instance with
`FEATURE_CEPH_ADMIN_ENABLED=false` and do not store the dedicated Ceph Admin key
there. Admin Ops and Supervision remain separate credentials.

## Runtime configuration

```dotenv
DEPLOYMENT_PROFILE=full
FEATURE_ADMIN_ENABLED=false
FEATURE_CEPH_ADMIN_ENABLED=true
FEATURE_STORAGE_OPS_ENABLED=false
FEATURE_MANAGER_ENABLED=false
FEATURE_PORTAL_ENABLED=false
FEATURE_BROWSER_ENABLED=false
SCHEDULED_JOBS_ENABLED=false
WEBHOOK_WORKER_ENABLED=false
BUCKET_MIGRATION_WORKER_ENABLED=false
```

All five other surfaces must be explicitly disabled: unset `FEATURE_*` switches
permit mounting by default. Authentication/profile APIs and first-administrator
bootstrap remain available. Admin governance, Storage Ops, Manager, Portal,
Browser, connections, execution-context and internal scheduled-job routes are
not mounted. The first superadministrator automatically receives Ceph Admin
access only when Ceph Admin is the sole enabled surface.

Configure endpoints with `ENV_STORAGE_ENDPOINTS`. Each Ceph entry specifies
`ceph_admin_allowed: true` and separate
`ceph_admin_access_key` and `ceph_admin_secret_key` from an externally configured RGW
user with `admin=true` and `system=false`. BucketReef validates that pair without
creating or modifying the Ceph Admin user. For example:

```json
[{
  "name": "Ceph Admin",
  "endpoint_url": "https://rgw.example.com",
  "provider": "ceph",
  "service_identity_mode": "managed",
  "ceph_admin_allowed": true,
  "ceph_admin_access_key": "CEPH_ADMIN_ACCESS_KEY",
  "ceph_admin_secret_key": "CEPH_ADMIN_SECRET_KEY"
}]
```

Ceph Admin validation does not require Admin Ops credentials. If Runtime/Supervision
are also needed, provide their external pairs or Admin Ops credentials with
`users=read,write;accounts=read` for managed provisioning. Any additional stored
secrets require the same network/database isolation as the Ceph Admin identity.
Startup reconciles persisted endpoints even if they were not
changed by ENV synchronization. Disabling the global feature blocks access and
preserves the stored Ceph Admin keys and endpoint authorization; it does not revoke RGW users.

ENV endpoint metadata are synchronized into this instance's isolated
database and remain environment-managed/read-only. Back up the database and its
credential ring together, independently of the main deployment.

## Docker Compose

Put the runtime switches above, the isolated `DATABASE_URL` and new key rings in
an operator-owned `.env.ceph-admin`. Also configure its own public origin, hosts,
WebAuthn origin/RP ID, published port and TLS/reverse-proxy boundary.

```bash
docker compose --project-name bucketreef-ceph-admin \
  --env-file .env.ceph-admin -f compose.yaml \
  up -d --wait backend frontend

docker compose --project-name bucketreef-ceph-admin \
  --env-file .env.ceph-admin -f compose.yaml \
  exec backend python -m app.scripts.issue_first_admin_bootstrap
```

Start only backend and frontend; do not start the scheduler. The main
Administration project still uses `compose.admin.yaml`, with
`FEATURE_CEPH_ADMIN_ENABLED=false` in its env file.

## Helm

Use a separate release with an operator-owned values file containing:

```yaml
deploymentProfile: full
backend:
  databaseType: postgresql
  persistence:
    enabled: false
  existingSecret: bucketreef-ceph-admin-auth
  env:
    FEATURE_ADMIN_ENABLED: "false"
    FEATURE_CEPH_ADMIN_ENABLED: "true"
    FEATURE_STORAGE_OPS_ENABLED: "false"
    FEATURE_MANAGER_ENABLED: "false"
    FEATURE_PORTAL_ENABLED: "false"
    FEATURE_BROWSER_ENABLED: "false"
    SCHEDULED_JOBS_ENABLED: "false"
    WEBHOOK_WORKER_ENABLED: "false"
    BUCKET_MIGRATION_WORKER_ENABLED: "false"
billingCronJob:
  enabled: false
healthcheckCronJob:
  enabled: false
quotaMonitorCronJob:
  enabled: false
usageHistoryCronJob:
  enabled: false
notificationRetentionCronJob:
  enabled: false
```

Complete this file with the instance's ingress/TLS, exact trusted proxy CIDRs,
origins and strict NetworkPolicy selectors/egress. The dedicated Secret contains
its isolated `database-url`, `ui-jwt-keys`, `api-jwt-keys` and `credential-keys`.
With scheduled jobs disabled, `internal-cron-token` is not consumed. Rendering
fails if a built-in CronJob is enabled while scheduled-job endpoints are off.

```bash
helm upgrade --install bucketreef-ceph-admin \
  oci://ghcr.io/ksperis/charts/bucketreef --version X.Y.Z \
  --values production-ceph-admin.yaml
```

On the main `admin` release set
`backend.env.FEATURE_CEPH_ADMIN_ENABLED: "false"`; other profile-controlled
switches remain fixed. Configure switches in `backend.env`, not `extraEnv`.

## Verification and migration

Migration `0143_external_ceph_admin_credentials` preserves complete Ceph Admin pairs
from `0.2.13`, removes pending managed rotations and managed-only metadata, then
revalidates the preserved external pair. Supply credentials again only when the
stored pair is incomplete or invalid. Migration intentionally resets per-endpoint
Ceph Admin authorization to disabled, so explicitly re-enable it after validating the
preserved credentials. Existing RGW users are left untouched; inspect and remove
obsolete users manually without purging data.

Issue the normal bootstrap token against the empty isolated database. After
login, the only workspace should be Ceph Admin. Enroll a passkey from **Profile
> Security**, then enable **Require passkeys for administrators**.

Before exposing the ingress, verify the runtime routes, run
`python -m app.scripts.check_production_hardening`, check the restricted network
path and ensure the privileged RGW identity is absent from other instances.
An intentional Ceph Admin-only runtime does not warn about disabled jobs.

The removed profiles and overlays have no compatibility aliases. Before upgrade:

- Replace `admin-no-ceph-admin` with `admin` and explicitly disable Ceph Admin.
- Replace `ceph-admin-high-security` with `full` and the switches above; remove
  `CEPH_ADMIN_HIGH_SECURITY_MODE` and the old Compose/Helm overlay references.
- Release tooling and external installers that validate an exact bundle file list
  must accept the remaining base/admin/user Compose files before distributing
  a new bundle.
- Preserve the existing database and key rings during this configuration change.
  Moving a shared-state installation to an isolated database is a separate
  migration and requires its own administrator bootstrap.

## Related pages

- [Recommended production architecture](../install/production-architecture.md)
- [Deploy with Docker Compose](../install/docker-compose.md)
- [Deploy with Helm](../install/helm.md)
- [Configuration](../configuration/index.md)
- [Production readiness](../operations/production-readiness.md)
