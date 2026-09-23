# Ceph Admin high-security deployment

Use this profile when Ceph RGW administration must be exposed through a
separate instance with a smaller application and network boundary.

`ceph-admin-high-security` mounts the authentication/profile APIs and Ceph
Admin only. Admin governance, Storage Ops, Manager, Portal, Browser, private S3
connections, execution-context APIs, and scheduled-job endpoints are not
mounted. The profile also sets `CEPH_ADMIN_HIGH_SECURITY_MODE=true`; startup
fails if the required surface kill switches or `SCHEDULED_JOBS_ENABLED=false`
are not present.

## Isolation levels

Two deployment models are supported.

### Shared database and application secrets

Point the high-security instance at the same PostgreSQL database and key rings
as the main deployment. Existing admin identities, passkeys, endpoint records,
and Ceph Admin grants remain available. This provides network and runtime
surface isolation, but compromise of the shared database or credential ring
still crosses the instance boundary.

When the same passkeys are used on multiple origins, configure every public
origin in `PUBLIC_ORIGIN`/`PUBLIC_ORIGINS` and
`WEBAUTHN_ORIGIN`/`WEBAUTHN_ORIGINS`, with a common `WEBAUTHN_RP_ID` that is
valid for all hosts.

### Isolated database and secrets

Use a dedicated PostgreSQL database and distinct UI JWT, API JWT and credential
key rings. Bootstrap a separate superadministrator on this database. In
high-security mode the first bootstrap superadmin receives Ceph Admin access so
the instance is usable without exposing the general Admin surface.

For the strongest separation, manage Ceph endpoints through
`ENV_STORAGE_ENDPOINTS` and inject only the Ceph Admin credentials required by
this instance. Those endpoint rows are synchronized into the isolated database
at startup and remain environment-managed/read-only. Back up and rotate the
isolated database and credential ring independently from the main deployment.

## Docker Compose

The release bundle contains `docker-compose.ceph-admin-high-security.yml`.
Use a dedicated project name and preferably a separate env file:

```bash
docker compose --project-name bucketreef-ceph-admin \
  --env-file .env.ceph-admin \
  -f docker-compose.yml \
  -f docker-compose.ceph-admin-high-security.yml \
  up -d --wait backend frontend
```

To share state, put the main deployment's PostgreSQL `DATABASE_URL` and key
rings in `.env.ceph-admin`. To isolate state, use a dedicated PostgreSQL URL and
new values for `UI_JWT_KEYS`, `API_JWT_KEYS`, and `CREDENTIAL_KEYS`. Do not
start the `operations` profile for this instance.

Validate the running backend:

```bash
docker compose --project-name bucketreef-ceph-admin \
  --env-file .env.ceph-admin \
  -f docker-compose.yml \
  -f docker-compose.ceph-admin-high-security.yml \
  exec backend python -m app.scripts.check_production_hardening \
    --profile ceph-admin-high-security
```

## Helm

Use a separate release and the `ceph-admin-high-security` deployment profile:

```bash
helm upgrade --install bucketreef-ceph-admin \
  oci://ghcr.io/ksperis/charts/bucketreef \
  --version X.Y.Z \
  --values production-security-values-ceph-admin.yaml \
  --set deploymentProfile=ceph-admin-high-security \
  --set backend.existingSecret=bucketreef-ceph-admin-auth
```

For shared state, `bucketreef-ceph-admin-auth` may reference the same database
URL and key-ring values as the main release. For isolated state, create a
dedicated Secret containing its own `database-url`, `ui-jwt-keys`,
`api-jwt-keys`, and `credential-keys`. This profile does not consume
`internal-cron-token` and the chart refuses to render built-in CronJobs for it.

Use a dedicated ingress host/TLS secret and narrow NetworkPolicy rules. If the
database or RGW Admin endpoints are private, add only their exact CIDRs/ports to
the high-security release's private egress policy.

## Bootstrap and verification

With an isolated empty database, issue the normal first-admin token from the
high-security backend and enroll a passkey. After login, the only workspace
available to that user should be Ceph Admin.

Verify before publication:

1. `/api/ceph-admin/...` is present while `/api/admin`, `/api/manager`,
   `/api/portal`, `/api/browser`, `/api/storage-ops`, `/api/connections`, and
   `/api/internal/...` are absent.
2. The hardening checker exits successfully with
   `--profile ceph-admin-high-security`.
3. The ingress is reachable only from the intended administrator network.
4. Only the required Ceph RGW endpoint credentials are present in this
   instance's secret boundary.
5. Database backup/restore and credential-key recovery have been tested for
   the chosen shared or isolated model.

## Related pages

- [Deploy with Docker Compose](deploy-docker-compose.md)
- [Deploy with Helm](deploy-helm.md)
- [Configuration](configuration.md)
- [Production readiness](production-readiness.md)
- [Operations: security](operations-security.md)
