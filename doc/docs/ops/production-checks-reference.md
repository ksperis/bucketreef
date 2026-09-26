# Production Checks Reference

This page is the remediation reference for the checks shown in **Admin > Settings > Production readiness** and by:

```bash
cd backend
python -m app.scripts.check_production_hardening
```

The CLI name is kept for compatibility. Startup diagnostics, the CLI, and the Admin page use the same deployment-check engine.

## How to read a result

Each automated check has a result and a severity. These are intentionally separate.

| Display | Meaning | Application startup |
|---|---|---|
| **Blocked** | An obvious security problem is present. | Blocks only when `blocks_startup=true`. General security blockers become startup-blocking in `APP_ENV=production`; the explicit Ceph Admin high-security boundary is always enforced. |
| **Critical** | The deployment should be corrected before publication, but remains available for remediation. | Does not block. |
| **Warning** | The configuration may be valid depending on topology or operating model. | Does not block. |
| **Manual** | The property cannot be proven safely from this backend alone. | Does not block. |
| **OK** | The automated check passes. | Does not block. |

The CLI exits non-zero for **Blocked** and **Critical** findings. Warnings and Manual checks do not change its exit code.

Technical startup failures such as an unreadable/corrupt database, an Alembic migration failure, or structurally invalid configuration remain ordinary application errors and are outside this readiness classification.

## Automated checks

### `app-env`

**Classification:** Critical when `APP_ENV` is not `production`.

Set `APP_ENV=production` for the final runtime. Development and test environments remain Critical so the other checks can be used as a preflight before the switch.

### `trusted-origins`

**Classification:** Critical.

`PUBLIC_ORIGIN`/`PUBLIC_ORIGINS` and WebAuthn origins must be HTTPS production origins without paths. Every WebAuthn origin must also be public/trusted, and `WEBAUTHN_RP_ID` must cover every WebAuthn hostname.

**Fix:** configure the exact external UI origins and a valid RP ID. In split deployments, configure the complete shared origin set on both runtimes.

### Authentication cookies

Checks: `authentication-cookie-secure`, `authentication-cookie-scope`.

`authentication-cookie-secure` is **Blocked** when a non-local browser origin is used with `REFRESH_TOKEN_COOKIE_SECURE=false`. Enable secure cookies behind HTTPS before production.

`authentication-cookie-scope` is **Critical** when cookies are not host-only or use a SameSite mode other than `Lax` or `Strict`. `Strict` is accepted as secure, although it can be too restrictive for some authentication flows.

### Network boundary

Checks: `allowed-hosts`, `cors-boundary`.

Both are **Critical**. Configure explicit `ALLOWED_HOSTS`, and make `CORS_ORIGINS` match the trusted public origins exactly. Wildcard CORS or wildcard hosts should not be used for an authenticated production deployment.

### `trusted-proxies`

An empty `TRUSTED_PROXY_CIDRS` is a **Warning**, because BucketReef safely ignores forwarded client addresses when no proxy is trusted. This is valid for direct connections but normally wrong behind a reverse proxy.

Trusting an entire address space (`0.0.0.0/0` or `::/0`) is **Blocked** because an untrusted peer could influence proxy-derived client identity.

**Fix:** configure only the direct reverse-proxy or ingress peers/subnets that connect to the backend.

### Secret key rings

Checks: `key-strength`, `key-separation`.

`key-strength` is **Blocked** when an effective UI JWT, API JWT, or credential-encryption key is weak/default.

`key-separation` is **Critical** when the UI JWT, API JWT and credential-encryption rings share key material.

**Fix:** create high-entropy values, store them in the deployment secret manager, and configure distinct `UI_JWT_KEYS`, `API_JWT_KEYS`, and `CREDENTIAL_KEYS`. Follow the authentication cutover procedure before rotating existing rings.

### `seed-security`

**Classification:** Critical.

If seed endpoints/secrets are explicitly configured, use HTTPS and non-default secrets. Remove unused seed configuration instead of carrying development credentials into production.

### `scheduler-token`

A weak/default `INTERNAL_CRON_TOKEN` is **Blocked** when scheduled jobs are enabled. A weak token configured while jobs are disabled is only a **Warning**.

**Fix:** rotate the token when internal scheduler endpoints are mounted, or remove the unused token when jobs are disabled.

### OIDC providers

Checks: `environment-oidc-transport`, `environment-oidc-integrity`, `persisted-oidc-transport`, `persisted-oidc-integrity`.

Environment-defined and UI-managed providers use the same policy:

- HTTP discovery or redirect transport is **Blocked**.
- Missing PKCE/nonce or a redirect outside trusted public origins is **Critical**.

**Fix:** use HTTPS discovery and callback URLs, require PKCE and nonce, and use a configured public origin for callbacks.

### LDAP providers

Checks: `environment-ldap-transport`, `environment-ldap-legacy-tls`, `persisted-ldap-transport`, `persisted-ldap-legacy-tls`.

Environment-defined and UI-managed providers use the same policy:

- Plain/unverified authentication transport (`ldap://` without StartTLS, `allow_insecure`, or disabled certificate verification) is **Blocked**.
- Explicit legacy TLS compatibility is a **Warning**.

**Fix:** use LDAPS or StartTLS with certificate verification. Keep legacy cipher compatibility only for a documented temporary migration.

### `app-settings`

**Classification:** Critical when application settings cannot be loaded.

The report is incomplete because application-level checks such as the administrator passkey policy cannot be evaluated.

### `admin-passkey-policy`

**Classification:** Critical.

Enroll an administrator passkey from **Profile > Security**, then enable **Require passkeys for administrators**. This remains a publication gate but does not take the application offline.

### `admin-passkey-enrollment`

**Classification:** Critical.

Every active `ui_admin` and `ui_superadmin` account must have at least one non-revoked WebAuthn credential. The report exposes only the number of affected administrator accounts, never user identifiers or credential material.

### `s3-login-endpoint-boundary`

**Classification:** Critical only when access-key login can use arbitrary custom endpoints.

The check is OK when access-key login is disabled, custom endpoint login is disabled, or `REQUIRE_REGISTERED_S3_LOGIN_ENDPOINTS=true`.

### Database topology

Checks: `database`, `sqlite-bucket-migration-worker`.

PostgreSQL is a **Critical** production condition for split profiles, Ceph Admin high-security deployments, and multi-replica backends. A single full-profile SQLite deployment is accepted with a **Warning**.

Running the long-lived bucket migration worker with SQLite is also a **Warning**.

Database corruption, migration failures, and unmanaged schemas remain technical startup errors and still stop the backend.

### `scheduled-job-ownership`

For split profiles, incorrect scheduler ownership is **Critical**. The `admin`
and `admin-no-ceph-admin` profiles own scheduled jobs; `user` does not.

For `ceph-admin-high-security`, scheduled jobs violate the dedicated security boundary and are **Blocked**.

A full-profile instance with jobs disabled receives a **Warning** because another scheduler owner may be intentional.

### Runtime surfaces

Checks: `surface-admin`, `surface-ceph-admin`, `surface-storage-ops`, `surface-manager`, `surface-portal`, `surface-browser`.

A mismatch with the normal `admin`, `admin-no-ceph-admin`, or `user` profile is
**Blocked** and prevents startup in production. Outside production it remains
**Critical** so the same check can be used as a preflight.

A mismatch involving the Ceph Admin high-security contract is **Blocked** and prevents startup because that profile exists specifically to enforce a reduced attack surface.

### `ceph-admin-high-security-boundary`

**Classification:** Blocked.

`CEPH_ADMIN_HIGH_SECURITY_MODE=true` and `DEPLOYMENT_PROFILE=ceph-admin-high-security` must be selected together. The dedicated runtime surface and scheduler contract is enforced as a startup security boundary.

### Split deployment contract

Checks: `shared-origins`, `webauthn-origins`.

**Classification:** Critical.

Admin/user split deployments must carry both trusted public origins and the same WebAuthn origin set on each runtime. Database/key-ring equivalence between two processes remains a manual check.

### `outbound-target-allowlists`

**Classification:** Critical.

Persisted user-controlled S3 endpoints and global webhook endpoints must be covered by their configured outbound allowlists. The check reports only hostnames, never URLs, credentials, query strings, or secrets.

The compatibility preflight remains available:

```bash
cd backend
python -m app.scripts.preflight_outbound_targets
```

Existing uncovered targets remain stored, but their protected operations stay unavailable until the allowlist is corrected.

### `storage-endpoint-tls`

**Classification:** Warning.

Stored storage endpoints should keep TLS certificate verification enabled. A disabled `verify_tls` setting can be valid for a temporary lab or migration case, but it should be corrected before normal production exposure.

### `storage-identity-separation`

**Classification:** Warning.

Admin Ops, supervision, and Ceph Admin credentials should use distinct access-key identities on each storage endpoint where practical. The check compares only access-key identifiers and reports the number of affected endpoints; secret keys are never returned.

## Manual checks

### `manual-backup-restore`

Confirm that the database backup can be restored and that matching credential-encryption keys are recoverable. Keep the latest restore-test evidence with the deployment runbook.

### `manual-secret-management`

Confirm production secrets are injected through the approved secret manager or platform Secret boundary, and verify the documented rotation and recovery procedure before publication.

### `manual-ingress-boundary`

Confirm the effective ingress/TLS/network policy from outside the process: public exposure, administrator-only routes where applicable, direct proxy peers, and internal scheduler/API paths.

### `manual-auth-flow`

Run the real administrator and enabled OIDC/LDAP authentication flows. Include a denied or revoked case.

### `manual-jobs-runtime`

Confirm healthcheck, billing, quota-monitor, and usage-history jobs actually execute on the intended owner. In split mode, only the admin runtime should own them.

### `manual-observability-audit`

Confirm central backend logging, application control-plane audit retention, and provider S3/object access logging.

### `manual-image-supply-chain`

Confirm deployed images and charts are pinned to approved versions or digests and that the current vulnerability, SBOM, and image-scanning policy has passed for the release.

### `manual-storage-endpoint`

Validate the first supported S3 endpoint with healthchecks and representative allowed and denied operations using the intended execution identities.

### `manual-split-state`

For admin/user split deployments, compare both runtimes and confirm the intended database, compatible key rings, complete origin set, and a single scheduler owner.

## Related pages

- [Production readiness](production-readiness.md)
- [Configuration](configuration.md)
- [Operations: security](operations-security.md)
- [Authentication security and cutover](authentication-hardening.md)
- [Backup and restore](backup-restore.md)
- [Ceph Admin high-security deployment](ceph-admin-high-security.md)
