# BucketReef deployment bundle

This archive is the single Docker Compose deployment artifact published with
each BucketReef release. It supports two user flows without a Git checkout or
source build:

- **QuickStart** automates a local evaluation with `bucketreef-quickstart`.
- **Docker Compose** uses the same files directly for a controlled mono-host
  deployment.

Published releases support Linux AMD64 and ARM64, including Docker Desktop on
macOS.

## Verify the bundle

Before extraction, verify `bucketreef-deploy.tar.gz.sha256` with
`sha256sum -c` or `shasum -a 256 -c` on macOS.

## QuickStart

The supported installer downloads this archive, verifies it, installs it under
`~/.local/share/bucketreef`, creates `~/.local/bin/bucketreef-quickstart`, and
starts backend, frontend and scheduler:

```sh
curl -fsSL https://bucketreef.ksperis.com/quickstart.sh | sh
```

The management command supports `start`, `status`, `logs`, `stop`, `reset` and
`version`. On first start it generates four distinct secrets in `.env` with mode
`0600`. QuickStart uses the normal `bucketreef` Compose project and
`bucketreef_backend-data` volume; it is an installation mode of this bundle,
not a separate distribution.

## Docker Compose

For manual deployment:

1. Copy `.env.example` to `.env` and `chmod 600 .env`.
2. Replace the four secret placeholders with different values generated with
   `openssl rand -hex 48`.
3. Keep the release's exact `BUCKETREEF_TAG`.
4. Run `docker compose up -d --wait`.
5. Run `docker compose exec backend python -m app.scripts.issue_first_admin_bootstrap`
   and follow the one-time URL.

The standard deployment runs backend, frontend and scheduler. Services bind to
loopback by default and SQLite lives in the `backend-data` volume. Stopping the
project preserves data and secrets; keep encryption keys with their database.

For split deployments, combine `compose.yaml` with `compose.admin.yaml` or
`compose.user.yaml`, use distinct project names, and point both stacks at the
same PostgreSQL database. Start the scheduler only with the admin stack. The
`compose.ceph-admin-high-security.yaml` and
`compose.admin-no-ceph-admin.yaml` overrides keep the dedicated Ceph Admin
deployment isolated.

See the deployment documentation for TLS, origins, trusted proxies, backups,
split deployments and hardening. No S3 service or endpoint is created
automatically.
