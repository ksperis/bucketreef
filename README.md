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

## QuickStart

Install a small release bundle and start the published GHCR images:

```sh
curl -fsSL https://bucketreef.ksperis.com/quickstart.sh | sh
```

Requirements: Docker Compose v2, Bash, OpenSSL, curl and tar on Linux or macOS
(AMD64 or ARM64). No clone or source build is needed. QuickStart generates
strong secrets, starts backend/frontend on loopback with SQLite, then prints a
15-minute URL to create the first administrator and enroll a passkey.

The bundle lives in `~/.local/share/bucketreef-quickstart`; the command is in
`~/.local/bin`. Re-running it preserves the installed version, data and keys.

```sh
bucketreef-quickstart status
bucketreef-quickstart stop
bucketreef-quickstart start
bucketreef-quickstart version
```

See the [QuickStart guide](https://docs.bucketreef.ksperis.com/ops/quickstart/)
for explicit versions, script inspection, custom ports, reset backups and
migration from the previous source-checkout QuickStart. This evaluation setup
does not configure storage or enable the scheduler.

## Deploy a release

- **Docker Compose:** download and verify the Compose bundle from
  [GitHub Releases](https://github.com/ksperis/bucketreef/releases), configure
  `.env` and follow the [deployment guide](https://docs.bucketreef.ksperis.com/ops/deploy-docker-compose/).
- **Kubernetes:** install `oci://ghcr.io/ksperis/charts/bucketreef` with an explicit
  `--version X.Y.Z` and the required security values and existing Secret from
  the [Helm guide](https://docs.bucketreef.ksperis.com/ops/deploy-helm/).

The chart and bundles follow application releases. Each release pins the
backend, frontend and scheduler images to the same version.

## Build from source

Clone this repository for development, configure your root `.env`, then run
`docker compose build` and `docker compose up --build`. The root Compose builds
from the working tree; release deployment files live under `deploy/`.
See [Local development](https://docs.bucketreef.ksperis.com/developer/local-development/).

## Full Documentation

Explore the [official website](https://bucketreef.ksperis.com) and the published documentation:

- https://docs.bucketreef.ksperis.com/

## License

Apache-2.0 — see `LICENSE`.
