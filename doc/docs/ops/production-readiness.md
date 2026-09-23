# Production Readiness

Use this checklist before exposing BucketReef to real users.

## Scope

This page turns deployment, security, observability, and user-handover pages into one operator checklist.

The optional [guided onboarding](sysadmin-onboarding.md#guided-application-setup)
prepares an initial endpoint, workspace features and administrator access. It
does not certify the deployment automatically. An organization can offer
Manager, Portal, Browser or a combination of these experiences. Test both
allowed and denied operations with actual pilot profiles and confirm isolation
between teams or clients.
Do not use the number of enabled features as a completion criterion.

The automated production-hardening report is available to superadministrators
at **Admin > Settings > Production readiness**. It evaluates the production
security policy even when the current runtime still uses `APP_ENV=development`
or `test`, then applies the deployment-profile checks for the backend instance
serving that page. This makes it useful before the final production switch.

The report mirrors the runtime production checks for trusted origins and
WebAuthn RP ID, secure host-only authentication cookies, registered S3 login
endpoints, CORS/allowed-host/trusted-proxy boundaries, secret key rings,
configured seed secrets, and environment-defined OIDC/LDAP providers. It also
checks database suitability, scheduled-job ownership and token strength,
runtime surfaces, split-origin coverage, and Ceph Admin high-security mode when
the selected profile requires them.

These checks are deliberately instance-local. A successful report does **not**
prove that two split instances use the same PostgreSQL database or compatible
key rings, that only one deployment actually runs the schedulers, or that the
ingress, backups, external identity provider, storage endpoint, observability,
audit retention, and support process work end to end. Keep those as manual
publish gates below.

## Publish gates

Do not publish the URL broadly until these gates are explicit:

| Gate | Minimum answer |
|---|---|
| Runtime | Which image tag, database, secret store, ingress/TLS, and trusted UI origin are used? |
| Data safety | Which database backup and credential encryption key restore path has been tested? |
| Jobs | Which healthcheck, billing, quota-monitor, and usage-history jobs are enabled or intentionally disabled? |
| Access | Which roles, UI groups, account links, and workspaces are allowed for the first users? |
| Storage backend | Which endpoint is the first supported backend and which capabilities are expected? |
| Support | Where should users report workspace, permission, upload/download, billing, or quota problems? |

## Automated report interpretation

- `Fail` means at least one required production or profile invariant is not
  satisfied. The CLI exits non-zero.
- `Warning` is currently used only where the topology can still be valid but
  deserves operator review, such as SQLite on a single-instance `full` profile
  or disabled scheduled jobs on that profile. Warnings do not make the CLI
  exit non-zero.
- `Pass` applies only to the current backend instance. In a split deployment,
  run the CLI in every backend runtime and compare the shared database, key
  rings, origins, and job ownership explicitly.
- In `development` or `test`, the `APP_ENV` finding remains `Fail` by design.
  Use the other findings as a preflight, switch to `APP_ENV=production`, then
  rerun the checker before publishing the deployment.
- The OIDC/LDAP runtime checks cover environment-defined providers. UI-managed
  provider configuration is validated when it is saved, but a real login flow
  remains part of the manual acceptance test.

## Readiness checklist

| Area | Required decision | Evidence to keep |
|---|---|---|
| Version | Use a pinned stable image tag for production-like deployments. | Image tag, image digest, Git tag, release notes. |
| Secrets | UI/API JWT and credential-encryption rings are strong and mutually distinct; scheduler, SMTP, LDAP/OIDC, and storage credentials are non-default. | Secret manager paths and rotation owner. |
| Authentication | Admin WebAuthn, recovery storage, session limits, scoped API tokens, and external-identity approvals are operational. | Enrollment and revocation evidence without credential values. |
| Network | TLS is enforced; origin, CORS, Host, cookie, WebAuthn, CSP, and trusted-proxy settings are exact. | Ingress/reverse-proxy config and negative startup tests. |
| Database | Persistent database storage, backup schedule, restore test, and migration procedure are documented. | Latest backup and restore-test result. |
| Scheduler | Healthcheck, billing, quota-monitor, and usage-history jobs are enabled or intentionally disabled. | Cron schedules, latest successful run, token source. |
| Endpoint | First storage endpoint has healthcheck evidence and known capability flags. | Endpoint status screenshot or log. |
| Access | Admin, Manager, Portal, Browser, Ceph Admin, and Storage Ops are enabled only for intended users. | Role/group mapping and feature flags. |
| Audit | Application control-plane audit, backend logs, and provider S3 access logs are retained centrally. | Separate destinations, activation evidence, identity attribution, and retention policies. |
| Support | User troubleshooting and admin runbook are linked from internal support docs. | Support handover note. |

## First rollout sequence

1. Deploy with Docker Compose or Helm using pinned images.
2. Set `APP_ENV=production` and configure distinct secrets, exact origin/hosts, secure cookies, WebAuthn, trusted proxies, ingress/TLS, and database persistence.
3. Review **Admin > Settings > Production readiness** where available, then run `python -m app.scripts.check_production_hardening` inside every backend runtime (including user-only or Ceph Admin high-security instances). Compare the shared database/key-ring/origin contract between split instances and keep the successful output with the deployment evidence.
4. Configure the first endpoint and run healthchecks.
5. Create or import the first account/context.
6. Enable only the intended workspaces and feature flags.
7. Run the [Storage Admin Runbook](../user/admin-runbook-storage-admin.md).
8. Verify scheduled jobs and observability pages. In split mode, only the admin instance owns jobs.
9. Communicate the user start page and support-report format.
10. Confirm that browser storage contains no token and that session/API-token revocation is immediate.

## Evidence folder

Keep these notes near the deployment runbook or ticket:

- image tag and deployment values
- secret manager paths and rotation owner
- database backup schedule and latest restore-test result
- enabled workspaces, feature flags, and initial role mapping
- scheduler/CronJob schedules and latest successful run
- first endpoint healthcheck evidence and known capability limitations
- support links: [Sysadmin onboarding](sysadmin-onboarding.md), [Storage Admin Runbook](../user/admin-runbook-storage-admin.md), and [User troubleshooting](../user/troubleshooting.md)

## Before every upgrade

- Read [Operations: upgrade and compatibility](operations-upgrade-compatibility.md).
- For migrations `0107`–`0110`, follow the mandatory [authentication cutover](authentication-hardening.md) and plan forced reauthentication/API-token recreation.
- Back up the database and confirm the backup is restorable.
- Record current feature flags and scheduler settings.
- Validate the new image in a lab or staging environment.

## Related pages

- [Deploy with Docker Compose](deploy-docker-compose.md)
- [Deploy with Helm](deploy-helm.md)
- [Configuration](configuration.md)
- [Backup and restore](backup-restore.md)
- [Operations: security](operations-security.md)
- [Operations: observability](operations-observability.md)
