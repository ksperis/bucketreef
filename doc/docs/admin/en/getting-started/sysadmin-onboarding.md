# Sysadmin Onboarding

Use this page when you install, take over, or troubleshoot a BucketReef
deployment. It is a routing page: keep it open while you jump to the detailed
runbooks.

## First 30 minutes

1. **Identify the deployment target and image tag policy.**
   Start with [Docker Compose](../install/docker-compose.md) for a local or
   single-host stack, or [Helm](../install/helm.md) for Kubernetes.
   Keep the image tag, chart values, Compose `.env`, and release notes.
   QuickStart and Helm install pinned releases. Use the root source-build
   Compose, or paired backend/frontend chart image overrides, to validate
   unpublished code.

2. **Confirm the runtime contract.**
   Use [Configuration](../configuration/index.md) to locate the database, secrets, CORS,
   TLS, and scheduler token settings. Keep secret locations, `DATABASE_URL`,
   trusted UI origin, and `INTERNAL_CRON_TOKEN`.

3. **Create and secure the first administrator.**
   Issue a temporary web URL with
   `python -m app.scripts.issue_first_admin_bootstrap`, or use
   `create_first_admin` as a direct CLI fallback. A fresh installation allows
   the first Admin session without a passkey so onboarding can continue. Before
   production, open **Profile > Security**, enroll a passkey, then enable
   **Require passkeys for administrators** in Authentication settings. Keep no
   bootstrap URL in tickets, logs, shell history exports, or shared notes.

4. **Use the optional guided setup.**
   Open **Admin → Getting started** (`/admin/onboarding`), also available from
   the dashboard. Connect an existing endpoint or add a Ceph RGW endpoint,
   then choose the first workspaces and access paths BucketReef should prepare.
   Check the [Backends matrix](../storage/backends/compatibility.md) and
   [Ceph RGW](../storage/backends/ceph-rgw.md) notes before promising a feature. Keep the
   endpoint URL, provider type, feature flags, and healthcheck mode.

5. **Verify health, scheduler, and day-2 jobs.**
   Use [Healthchecks](../operations/healthchecks.md) and
   [Observability](../operations/observability.md) before inviting users. Keep the
   latest healthcheck, CronJob or scheduler status, and backend log location.

6. **Decide which product surfaces are enabled.**
   Use [Configuration](../configuration/index.md) and
   [Production readiness](../operations/production-readiness.md) to record feature flags,
   role/group mapping, and account links for the first rollout.

7. **Protect the database, credential key, and deployment values.**
   Use [Backup and restore](../operations/backup-restore.md) and
   [Security](../security/index.md). Keep the backup schedule, restore-test
   result, and credential-key owner.

8. **Run a storage handover with the intended admin profile when storage is in scope.**
   Follow the [Storage admin runbook](storage-admin-runbook.md)
   and keep the first endpoint, account/context, bucket/object validation, and
   audit evidence.

## Guided application setup

The guide has four stages and does not change the first-administrator or
passkey policy. Secure the Admin identity separately before production:

1. **Connect storage.** Reuse an existing endpoint or add a Ceph RGW endpoint.
   This step only identifies the endpoint; it does not request privileged
   credentials. Region and addressing style remain under advanced options. A
   live HTTP check must confirm that the endpoint responds before continuing.
   An HTTP `403` is valid for this connectivity check because it proves that
   RGW answered before any storage credentials are applied.
2. **Prepare BucketReef.** Select only the access paths needed for the first
   use: Manager with a sample RGW Account, Portal with the same sample account,
   a private S3 connection for Browser + Manager, monitoring/metrics, and/or
   Ceph Admin. Ceph-specific choices remain available for a Ceph RGW endpoint
   even when its management credentials have not been configured yet.
3. **Provide credentials.** Use the recommended Admin Ops command with
   `users=read,write;accounts=read,write` for provisioning, account/user quotas and
   managed service identities. Individual bucket quota changes additionally require
   `buckets=write` and stay unavailable unless that optional capability is granted.
   Managed mode creates Runtime and Supervision for every Ceph endpoint. Advanced
   hardening can restrict Admin Ops permissions and provide both Runtime and
   Supervision externally. The private S3 connection keeps its own identity.
   Feature choices control which workflows run.
4. **Review and apply.** Inspect the exact feature activations, resource
   creations and access assignments, then explicitly apply the reviewed
   configuration. **Apply configuration** is available only in this final step.

The second step adapts to the endpoint provider: generic S3 endpoints can use a
private Browser/Manager connection, while Ceph-specific setup requires Ceph
RGW. Manager and Portal share one sample RGW Account when both are selected,
while their membership roles remain independent. Provisioning the sample account
and its root identity requires both `accounts=write` and `users=write`. Endpoint
registration through the API also accepts read-only Admin Ops and external Runtime,
so operators can provision accounts/users outside BucketReef.

Initial checks use Admin Ops without creating resources. Applying creates managed
identities and validates Runtime reads without keys and Supervision collection.
No Runtime or monitoring read falls back to Admin Ops. Usage is checked only with
Supervision, after provisioning in managed mode, and does not require Admin Ops
`usage=read`. Empty usage data does not prevent metrics or service identity setup. Ceph Admin
requires `users=write` and creates a dedicated managed admin identity for the selected
endpoint. The private S3 connection is validated independently. ENV locks still apply.

Only a platform superadministrator can apply configuration changes, and apply
uses the normal Admin sensitive-action guard. Recent WebAuthn is required when
the Admin passkey policy is enabled. Submitted keys are never stored in
onboarding progress. Partial provisioning checkpoints resource IDs so the same
operation can be retried without deliberately creating duplicates.

After a successful apply, **Getting started** disappears from the dashboard and
left navigation. It also disappears when the administrator chooses **Hide
setup**. The assistant can always be opened again from **Admin → General
settings → Setup assistant**. Each administrator has an independent dismissal
preference and onboarding progress.

The guide prepares an initial usable configuration; it does not certify a
deployment for production. Run the intended operations with real pilot profiles
and follow [Production readiness](../operations/production-readiness.md) before opening the
service to users.

### Interrupted configuration

Progress records contain the selected options and resource identifiers, not
submitted keys. Keys are retained only in the existing credential stores;
re-enter unsubmitted keys after leaving the guide. Local connection/endpoint
creation and their checkpoint commit together. Account provisioning records a
durable RGW account identifier before the remote call and reuses it on retry.

An unresolved remote failure requires reconciliation through the standard
administration tools. A pending account resumes with the same durable RGW
identifier. Enabled features and created resources are not silently rolled back
or removed after an error.

## Find the right page fast

| I need to... | Start here | Then check |
|---|---|---|
| Evaluate locally from nothing | [Local quickstart](../install/quickstart.md) | [Authentication security](../security/authentication.md), [Configuration](../configuration/index.md) |
| Deploy a manual lab or single-host environment | [Deploy with Docker Compose](../install/docker-compose.md) | [Configuration](../configuration/index.md), [Production readiness](../operations/production-readiness.md) |
| Deploy on Kubernetes | [Deploy with Helm](../install/helm.md) | [Backup and restore](../operations/backup-restore.md), [Security](../security/index.md) |
| Make the deployment safe for real users | [Production readiness](../operations/production-readiness.md) | [Security](../security/index.md), [Observability](../operations/observability.md) |
| Know which environment variable or setting controls a behavior | [Configuration](../configuration/index.md) | [Feature availability](../help/feature-availability.md) |
| Debug missing menus, stale metrics, or failed jobs | [Observability](../operations/observability.md) | [Healthchecks](../operations/healthchecks.md), [Quota monitoring](../operations/quota-monitoring.md), [Billing](../operations/billing.md) |
| Restore after a host, pod, or database issue | [Backup and restore](../operations/backup-restore.md) | [Production readiness](../operations/production-readiness.md) |
| Prepare an upgrade | [Upgrade and compatibility](../operations/upgrade-compatibility.md) | [Backup and restore](../operations/backup-restore.md), [Production readiness](../operations/production-readiness.md) |
| Check whether a backend supports a feature | [Backends compatibility matrix](../storage/backends/compatibility.md) | [Ceph RGW](../storage/backends/ceph-rgw.md), [Other S3 implementations](../storage/backends/other-s3.md) |

## Triage from a user report

| User report | Check first | Useful evidence |
|---|---|---|
| A workspace, menu, or action is missing | Feature flag, role, account link, Manager tool access, endpoint capability. | User email, workspace, intended account/context, screenshot. |
| `AccessDenied` appears during an S3 action | Storage-side IAM/S3 policy and selected execution identity. | Bucket/key, context selector, route, upstream error id if present. |
| Health, quota, billing, or usage data is stale | Scheduler/CronJob status, `INTERNAL_CRON_TOKEN`, latest collection logs. | Job schedule, last successful run, backend log excerpt. |
| Portal or Browser cannot open files | Browser sub-flags, Portal account link, Storage Space grants, endpoint capability. | Workspace, Storage Space or bucket, role/grant, exact action. |
| An object or bulk data operation failed | Provider S3 access logs, backend route logs, upstream S3/RGW response. | Personal executor identity, bucket/key, operation id, target prefix. |
| A purge, migration, global restore, or history cleanup failed | Application audit and backend route logs. | Actor, account/context, workflow id, target scope. |

## What an operator should keep in hand

- Deployment method, image tags, chart values or Compose `.env` ownership.
- Database location, backup schedule, and last restore-test result.
- Credential encryption key owner and recovery location.
- Secret manager paths for JWT, refresh, scheduler, SMTP, LDAP/OIDC, and storage credentials.
- Feature-flag decisions for Admin, Manager, Portal, Browser, Ceph Admin, Storage Ops, billing, endpoint status, quota, and usage history.
- First storage endpoint capability notes and healthcheck mode.
- Support handover links: [Storage admin runbook](storage-admin-runbook.md), [User troubleshooting](../help/troubleshooting.md), and [Observability](../operations/observability.md).

## Boundaries to remember

- **Admin** governs users, endpoints, settings, audit, and platform state. It
  does not grant storage permission by itself.
- **Manager** and **Browser** execute native S3/IAM actions with the selected
  account, connection, S3 user, or Ceph Admin context.
- **Portal** uses database Storage Space metadata and grants, then projects
  storage-side policies where external access keys need enforcement.
- **Ceph Admin** is cluster-level RGW administration and should stay separate
  from tenant-scoped Manager workflows.
