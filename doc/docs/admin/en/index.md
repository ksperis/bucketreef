# Administration Guide

Use this guide to deploy, configure, secure, monitor, and operate BucketReef.
It also covers the administrative workspaces **Admin**, **Ceph Admin**, and
**Storage Ops**.

## Start here

| Goal | Read next |
|---|---|
| Install or take over BucketReef | [Sysadmin onboarding](getting-started/sysadmin-onboarding.md) |
| Prepare a storage service for users | [Storage admin runbook](getting-started/storage-admin-runbook.md) |
| Configure platform users, endpoints, settings, audit, or billing | [Admin workspace](platform/index.md) |
| Operate Ceph RGW resources | [Ceph Admin](storage/ceph-admin/index.md) |
| Run cross-context storage operations | [Storage Ops](storage/storage-ops/index.md) |
| Diagnose a production issue | [Observability](operations/observability.md) and [troubleshooting](help/troubleshooting.md) |

## Administration boundaries

- **Admin** governs the BucketReef platform: UI users, endpoints, S3 accounts,
  shared connections, settings, audit, billing, and platform-wide features.
- **Ceph Admin** provides Ceph RGW cluster-level workflows to authorized
  administrators.
- **Storage Ops** provides operational workflows across authorized storage
  contexts.
- Account-scoped bucket and IAM administration belongs to the separate
  [Manager guide](/manager/en/).
- End-user Storage Space workflows belong to the [Portal guide](/portal/en/).

## Production workflow

1. Choose a deployment model and configure persistent services and secrets.
2. Configure storage endpoints and verify health.
3. Configure the required workspaces and access bindings.
4. Validate scheduler jobs, observability, backup, and recovery.
5. Run the storage-admin handover path before opening the service to users.
