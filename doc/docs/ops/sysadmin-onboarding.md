# Sysadmin Onboarding

Use this page when you install, take over, or troubleshoot a BucketReef
deployment. It is a routing page: keep it open while you jump to the detailed
runbooks.

## First 30 minutes

1. **Identify the deployment target and image tag policy.**
   Start with [Docker Compose](deploy-docker-compose.md) for a local or
   single-host stack, or [Helm](deploy-helm.md) for Kubernetes.
   Keep the image tag, chart values, Compose `.env`, and release notes.
   QuickStart and Helm install pinned releases. Use the root source-build
   Compose, or paired backend/frontend chart image overrides, to validate
   unpublished code.

2. **Confirm the runtime contract.**
   Use [Configuration](configuration.md) to locate the database, secrets, CORS,
   TLS, and scheduler token settings. Keep secret locations, `DATABASE_URL`,
   trusted UI origin, and `INTERNAL_CRON_TOKEN`.

3. **Create and secure the first administrator.**
   Issue a temporary web URL with
   `python -m app.scripts.issue_first_admin_bootstrap`, or use
   `create_first_admin` as a direct CLI fallback. Complete passkey enrollment
   before treating the installation as ready. Keep no bootstrap URL in tickets,
   logs, shell history exports, or shared notes.

4. **Choose an optional guided setup goal.**
   Open **Admin → Getting started** (`/admin/onboarding`), also available from
   the dashboard. Choose evaluation, personal use, or a service for an
   organization, internal teams, or external clients. Select Browser, Manager,
   Portal, or Ceph Admin according to the first useful operation.
   Check the [Backends matrix](backends-compatibility.md) and
   [Ceph RGW](backends-ceph-rgw.md) notes before promising a feature. Keep the
   endpoint URL, provider type, feature flags, and healthcheck mode.

5. **Verify health, scheduler, and day-2 jobs.**
   Use [Healthchecks](operations-healthchecks.md) and
   [Observability](operations-observability.md) before inviting users. Keep the
   latest healthcheck, CronJob or scheduler status, and backend log location.

6. **Decide which product surfaces are enabled.**
   Use [Configuration](configuration.md) and
   [Production readiness](production-readiness.md) to record feature flags,
   role/group mapping, and account links for the first rollout.

7. **Protect the database, credential key, and deployment values.**
   Use [Backup and restore](backup-restore.md) and
   [Security](operations-security.md). Keep the backup schedule, restore-test
   result, and credential-key owner.

8. **Run a storage handover with the intended admin profile when storage is in scope.**
   Follow the [Storage admin runbook](../user/admin-runbook-storage-admin.md)
   and keep the first endpoint, account/context, bucket/object validation, and
   audit evidence.

## Guided application setup

The guide has three stages: **your goal → configuration → check and open**.
It leaves first-administrator creation and passkey enrollment unchanged.
Each administrator has independent saved goals and dismissal preferences.
**Save and leave** retains the draft; **Add another goal** preserves existing
resources. The permanent navigation entry remains available after dismissal.
Only a platform superadministrator can apply configuration changes.

The saved/unsaved indicator distinguishes retained progress from the live
configuration preview. Leaving with unsaved configuration opens a confirmation;
a failed save keeps the current edits available for retry. Entered keys are
never included in the draft and must be entered again after resuming. Selecting
a different resource or beneficiary clears the entered keys and access consent.

| First useful goal | Minimal configuration |
|---|---|
| Browser | Reuse your private S3 connection or enter an endpoint and credentials. Optionally specify an authorized bucket and exact folder prefix, including its final `/`. |
| Manager | Reuse a permitted connection or choose/create an RGW account and explicitly assign its beneficiary. Manager is a technical S3/IAM self-service console for teams and clients as well as personal use. |
| Portal | Choose/create a Ceph RGW project, prepare its explicit membership and personal IAM identity, and choose/create a file space. Portal is the simpler file and collaboration self-service experience. |
| Ceph Admin | Select/configure a Ceph endpoint and its dedicated admin/system execution identity; assign an existing administrator explicitly when needed. |

The configuration summary lists feature activations, creations and access
assignments before **Configure and continue**. Changing a goal alone does not
enable features or grant permissions. Required features are enabled on confirmed
configuration unless forced off by ENV. Manager does not require Browser;
Portal enables its embedded file Browser dependency; the standalone Browser
flag remains unchanged. Ceph Admin does not change its optional privileged
Browser flag. Existing features are never
disabled when a goal changes.

The guide reuses registered endpoints, accounts, private connections and
authorized Portal spaces. New S3 connections remain private. Manager/Portal
account-role axes remain independent. A Manager beneficiary does not become a
platform administrator. Enabling Ceph Admin access is a separate, explicit
administrator capability applying across configured Ceph endpoints.
Advanced policies, quotas, identity providers and group assignments remain in
the standard interface; neither a disabled endpoint capability nor a storage
denial is treated as permission to widen access.

### Validation and retained evidence

**Configured** means the prerequisites are present. **Usage validated** requires
an explicit successful read request, or a clearly identified administrator
declaration describing a real operation with the intended profile. Merely opening
a page or finding an existing resource is not proof. Restricted Browser keys can
test one bucket/prefix without listing every bucket or uploading an object.
Portal checks use the member's personal IAM keys, never the account root as a
fallback. A different beneficiary must sign in and perform its own pilot check;
the guide does not impersonate that user to certify access.

During evaluation, manual declarations are available under **Record a result
checked outside this guide**. A Portal project without a selected space offers
**Choose a space to check** before attempting a file-access check. Organizational
readiness has a separate pilot-results field beside the allowed-operation,
denial and isolation confirmations; record the tested profiles and results there.

Local revocation, expiry, endpoint changes and Portal space archival invalidate
the displayed evidence. Storage-side permissions may change independently: the
timestamped last check is historical evidence, not continuous monitoring.
Rechecking after a denial clears the previous success. Individual readiness
confirmations become stale when their scope changes.

Personal use adds backup, restoration and upgrade confirmations. Organizational
use additionally records identity boundaries, operational ownership, successful
authorized pilot operations, expected denials and isolation between teams or
clients. These are operator attestations, not automatic production certification.
See [Production readiness](production-readiness.md) before opening the service.

### Interrupted configuration

Progress records contain identifiers, scope and evidence, not submitted keys.
Keys are retained only in the existing credential stores; re-enter unsubmitted
keys after leaving the guide. Local connection/endpoint creation and their
checkpoint commit together. Account provisioning records a durable RGW account
identifier before the remote call and reuses it on retry.

If space creation is interrupted, the guide pauses rather than creating another
space blindly. Refresh and select the existing authorized space when it exists;
an unresolved remote failure requires reconciliation through the standard Portal
and storage administration tools. A pending account must be resumed under its
saved scope before changing it. Enabled features and created resources are not
silently rolled back or removed after an error.

## Find the right page fast

| I need to... | Start here | Then check |
|---|---|---|
| Evaluate locally from nothing | [Local quickstart](quickstart.md) | [Authentication security](authentication-hardening.md), [Configuration](configuration.md) |
| Deploy a manual lab or single-host environment | [Deploy with Docker Compose](deploy-docker-compose.md) | [Configuration](configuration.md), [Production readiness](production-readiness.md) |
| Deploy on Kubernetes | [Deploy with Helm](deploy-helm.md) | [Backup and restore](backup-restore.md), [Security](operations-security.md) |
| Make the deployment safe for real users | [Production readiness](production-readiness.md) | [Security](operations-security.md), [Observability](operations-observability.md) |
| Know which environment variable or setting controls a behavior | [Configuration](configuration.md) | [Feature availability](../user/feature-availability.md) |
| Debug missing menus, stale metrics, or failed jobs | [Observability](operations-observability.md) | [Healthchecks](operations-healthchecks.md), [Quota monitoring](operations-quota-monitoring.md), [Billing](operations-billing.md) |
| Restore after a host, pod, or database issue | [Backup and restore](backup-restore.md) | [Production readiness](production-readiness.md) |
| Prepare an upgrade | [Upgrade and compatibility](operations-upgrade-compatibility.md) | [Backup and restore](backup-restore.md), [Production readiness](production-readiness.md) |
| Check whether a backend supports a feature | [Backends compatibility matrix](backends-compatibility.md) | [Ceph RGW](backends-ceph-rgw.md), [Other S3 implementations](backends-others.md) |

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
- Support handover links: [Storage admin runbook](../user/admin-runbook-storage-admin.md), [User troubleshooting](../user/troubleshooting.md), and [Observability](operations-observability.md).

## Boundaries to remember

- **Admin** governs users, endpoints, settings, audit, and platform state. It
  does not grant storage permission by itself.
- **Manager** and **Browser** execute native S3/IAM actions with the selected
  account, connection, S3 user, or Ceph Admin context.
- **Portal** uses database Storage Space metadata and grants, then projects
  storage-side policies where external access keys need enforcement.
- **Ceph Admin** is cluster-level RGW administration and should stay separate
  from tenant-scoped Manager workflows.
