<a href="https://bucketreef.ksperis.com">
  <img src="doc/docs/assets/brand/bucketreef-mark-256.png" alt="BucketReef logo" width="128">
</a>

# BucketReef - S3-compatible object storage management

[![Website](https://img.shields.io/badge/website-BucketReef-0A66C2)](https://bucketreef.ksperis.com)
[![Docs](https://img.shields.io/badge/docs-online-0A66C2)](https://docs.bucketreef.ksperis.com/)
[![Tag](https://img.shields.io/github/v/tag/ksperis/bucketreef?sort=semver)](https://github.com/ksperis/bucketreef/tags)
[![License](https://img.shields.io/github/license/ksperis/bucketreef)](./LICENSE)
![Status](https://img.shields.io/badge/status-beta-F28C28)

**BucketReef** is an open-source web application to manage S3-compatible object storage primarily focused on **Ceph RGW**.

> Project status: **Beta**. Suitable for evaluation and controlled deployments.

It gives storage administrators and delegated team managers a single interface to manage their storage environments.
It can also be used solely through the integrated S3 browser for direct object access.


## Workspaces summary

- **Admin**: platform governance, endpoints, users, and settings.
- **Manager**: bucket and IAM administration in account context.
- **Browser**: direct object operations.
- **Portal**: explicit self-service workspace backed by RGW IAM.
- **Ceph-admin**: Ceph RGW cluster-wide administration.

## Workspace features

### Admin

- Manage UI users, roles, and workspace entitlements.
- Administer RGW accounts, S3 users, and S3 connections.
- Register storage endpoints and review endpoint status.
- Access audit trails and platform-wide settings.

### Manager

- Create and configure buckets with versioning, lifecycle, quotas, CORS, and access controls.
- Manage IAM users, groups, roles, policies, and access keys.
- Operate SNS topics when the selected endpoint supports notifications.
- Use migration and comparison tools for bucket alignment and controlled transfers.

### Browser

- Browse buckets, prefixes, and objects from the selected context.
- Upload, download, preview, delete, and restore objects and versions.
- Run bulk operations on large object selections.
- Inspect and update object metadata and tags directly from the UI.

### Ceph-admin

- Manage Ceph RGW accounts and users at cluster scope.
- Inspect bucket inventory and apply bucket-level configuration centrally.
- Monitor endpoint metrics for operational visibility.
- Run long-running bulk actions with explicit progress and failure counters.

### Portal

- Self-service dashboard for eligible Ceph RGW accounts with IAM enabled.
- Access is explicit per account with `portal_user` or `portal_manager`.
- `/manager` access remains separate and still requires account admin/root links.

## Quick Start (Docker Compose)

For a local evaluation from a clean machine:

```bash
git clone https://github.com/ksperis/bucketreef.git
cd bucketreef
./quickstart
```

The script generates strong local secrets in `.env.quickstart`, builds the
backend and frontend from the current checkout, waits for both services, then
prints a 15-minute one-time URL. The first build can take several minutes.
Open the URL to create the first administrator and enroll a passkey. Re-running
the script is safe and prints either a fresh setup URL or the sign-in URL.

This quickstart is intentionally limited to loopback, SQLite and local
evaluation. It includes no MinIO, no simulated or preconfigured storage, and no
scheduler. Connect an existing S3-compatible or Ceph RGW endpoint later from
Admin if you want to exercise storage workflows. A complete deployment enables
the `operations` Compose profile and uses a reverse proxy with TLS.

Useful commands:

```bash
./quickstart status
./quickstart stop
./quickstart reset
```

See the [Quickstart guide](https://docs.bucketreef.ksperis.com/ops/quickstart/)
for reset backups, restore steps, expired links and deployment boundaries.

## Full Documentation

Explore the [official website](https://bucketreef.ksperis.com) and the published documentation:

- https://docs.bucketreef.ksperis.com/

## License

Apache-2.0 — see `LICENSE`.
