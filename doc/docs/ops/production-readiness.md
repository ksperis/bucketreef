# Production Readiness

Use this page before exposing BucketReef to real users.

## Scope

BucketReef uses one deployment-check engine for startup diagnostics, the CLI, and **Admin > Settings > Production readiness**. The same check code therefore keeps the same meaning in logs, automation, and the UI.

The report evaluates the production target even while the runtime still uses `APP_ENV=development` or `test`. It combines configuration checks, application settings, database-backed authentication providers, and persisted outbound-target allowlists, then adds the operational checks that still require manual verification.

A successful automated report is instance-local. It cannot prove that another split runtime uses the intended database/key rings, that ingress/network policy is effective, that backups restore correctly, or that external providers and scheduled jobs work end to end.

For the correction procedure for every code, use [Production checks reference](production-checks-reference.md).

## Result model

The report separates severity from startup behavior:

| Result | Meaning |
|---|---|
| **Blocked** | Obvious security problem. General blockers stop startup only in `APP_ENV=production`; the explicit Ceph Admin high-security boundary is always enforced. |
| **Critical** | Must normally be corrected before publication, but does not take the application offline. |
| **Warning** | May be valid depending on topology or operating model; review explicitly. |
| **Manual** | Requires operator evidence because the backend cannot prove it alone. |
| **OK** | Automated check passes. |

The CLI exits non-zero for Blocked and Critical findings. Warnings and Manual checks do not change its exit code.

This distinction is intentional: a deployment can remain available so an administrator can correct a Critical finding such as the passkey policy, database topology, scheduler ownership, or a normal profile mismatch.

Technical failures are separate. Database corruption, failed Alembic migrations, an unmanaged schema, or structurally invalid settings still stop the backend because the application cannot operate safely.

## Startup blockers

Startup refusal is deliberately narrow.

In production, BucketReef blocks startup for direct security exposures such as weak/default effective signing or encryption keys, insecure public authentication cookies, globally trusted proxy address space, weak scheduler secrets while scheduler endpoints are active, and insecure OIDC/LDAP authentication transport.

The Ceph Admin high-security profile also blocks startup whenever its reduced-surface contract is violated, including a mismatched profile/mode, an unexpected runtime surface, or enabled scheduled jobs.

An empty `TRUSTED_PROXY_CIDRS` is not a blocker: without trusted peers BucketReef ignores forwarded client addresses. It appears as a Warning so deployments behind a reverse proxy can correct client attribution without creating an unnecessary outage.

## Operator workflow

1. Deploy with a pinned image/version.
2. Open **Admin > Settings > Production readiness** when the Admin surface is available.
3. Correct **Blocked** findings first, then **Critical** findings.
4. Review every **Warning** and record why the effective topology is acceptable.
5. Complete every **Manual** check and keep the evidence with the deployment/runbook.
6. Run the CLI in every backend runtime:

   ```bash
   cd backend
   python -m app.scripts.check_production_hardening
   ```

7. In split deployments, compare both runtime reports and complete `manual-split-state`.
8. Switch the final runtime to `APP_ENV=production` and rerun the checker before publication.

User-only and Ceph Admin high-security runtimes do not expose the Admin page, so the CLI remains the authoritative local view for those instances.

## Publish gates

Do not publish the URL broadly until these gates are explicit:

| Gate | Minimum evidence |
|---|---|
| Runtime | Image tag/digest, database, secret store, ingress/TLS, and trusted UI origins. |
| Data safety | Database backup plus a tested restore path with credential-encryption keys. |
| Jobs | Intended owner and latest successful healthcheck/billing/quota/usage-history jobs. |
| Access | Initial roles, UI groups, account links, and enabled workspaces. |
| Storage backend | First supported endpoint, health evidence, and expected capabilities. |
| Authentication | Admin passkey plus real OIDC/LDAP flows when enabled. |
| Audit | Central backend logs, application control-plane audit, and provider object-access logs with retention. |
| Support | User/admin troubleshooting and escalation path. |

## Automated areas

The shared engine covers:

- production environment target and trusted browser/WebAuthn origins
- authentication cookie transport/scope and S3 login endpoint boundary
- allowed hosts, CORS, and trusted proxies
- effective secret strength, key-ring separation, seed configuration, and scheduler token
- environment-defined and UI-managed OIDC/LDAP providers
- administrator passkey policy and application-settings availability
- database topology, SQLite migration-worker warning, and scheduler ownership
- runtime surface/profile contract and Ceph Admin high-security boundary
- split public/WebAuthn origins
- persisted user-controlled S3/webhook outbound allowlists

Each finding includes a direct documentation link.

## Manual evidence

The report exposes checks that cannot be inferred reliably from a single process:

- database backup/restore and credential-key recovery
- effective ingress/TLS/network boundary
- real authentication flows including a denied/revoked case
- actual scheduled-job execution
- observability and audit retention
- storage endpoint acceptance
- cross-runtime state for split deployments

## First rollout sequence

1. Deploy with Docker Compose or Helm using pinned images.
2. Configure strong, separate secret rings and the exact external origins/hosts.
3. Enroll an administrator passkey, then enable **Require passkeys for administrators**.
4. Review Production readiness and follow each finding's documentation link.
5. Configure and healthcheck the first storage endpoint.
6. Create/import the first account or execution context.
7. Enable only the intended workspaces and feature flags.
8. Run the [Storage Admin Runbook](../user/admin-runbook-storage-admin.md).
9. Confirm scheduled jobs, observability, and audit evidence.
10. Communicate the user start page and support path.
11. Rerun the CLI in every runtime after setting `APP_ENV=production`.

## Before every upgrade

- Read [Operations: upgrade and compatibility](operations-upgrade-compatibility.md).
- Back up the database and verify that the backup is restorable.
- Record current feature flags, profile, and scheduler ownership.
- Run any release-specific preflight, including outbound-target inventory when documented.
- Validate the new image in a lab or staging environment.
- Run Production readiness again after the upgrade.

## Related pages

- [Production checks reference](production-checks-reference.md)
- [Recommended production architecture](deployment-architecture.md)
- [Deploy with Docker Compose](deploy-docker-compose.md)
- [Deploy with Helm](deploy-helm.md)
- [Configuration](configuration.md)
- [Backup and restore](backup-restore.md)
- [Operations: security](operations-security.md)
- [Operations: observability](operations-observability.md)
