# Local QuickStart

QuickStart automates the same versioned Docker Compose deployment bundle that is
published for manual installation. It requires no Git checkout or source build.
Use it for local evaluation; use the [Compose](docker-compose.md) or
[Helm](helm.md) guide for a complete deployment.

## Install

Requirements: Linux or macOS, Bash, Docker Compose v2, OpenSSL, curl, tar, and
`sha256sum` or `shasum`. Docker must run Linux containers. Published bundles
support AMD64 and ARM64, including Apple Silicon with Docker Desktop.

```sh
curl -fsSL https://bucketreef.ksperis.com/quickstart.sh | sh
```

The installer resolves the latest stable GitHub Release once, downloads that
version's `bucketreef-deploy.tar.gz` and SHA-256 checksum, validates them, and
installs into `~/.local/share/bucketreef`. The management command is
`~/.local/bin/bucketreef-quickstart`. Use the full path if that directory is not
on PATH; no shell startup file is modified.

To inspect the bootstrap before execution:

```sh
curl -fsSL https://bucketreef.ksperis.com/quickstart.sh -o quickstart.sh
less quickstart.sh
sh quickstart.sh
```

To select a published release, replace `X.Y.Z` below:

```sh
curl -fsSL https://bucketreef.ksperis.com/quickstart.sh | sh -s -- --version X.Y.Z
```

Add `--no-start` to install without generating secrets or starting containers.
You can also download the bundle from
[GitHub Releases](https://github.com/ksperis/bucketreef/releases).

## What it starts

The normal Compose project `bucketreef` runs:

- the backend with SQLite in its persistent `backend-data` volume;
- the frontend at `http://localhost:8080`;
- the operations scheduler, including endpoint healthchecks every five minutes.

Backend and frontend bind to `127.0.0.1` (backend port 8000) by default. The
scheduler exposes no host port. QuickStart does not start a storage simulator or
configure an S3/Ceph endpoint. Images use the bundle's `VERSION`, never `latest`.
For builds of your working tree, see [Local development](/developer/en/contributing/local-development/).

The scheduler also runs billing collection, quota monitoring, usage history and
notification retention with the [standard schedules](docker-compose.md#scheduler-service).
It reuses the generated `INTERNAL_CRON_TOKEN`; no host crontab is needed.
Feature-dependent jobs skip their work when the corresponding feature is disabled.
Enabling **Endpoint Status** in Admin settings or creating an endpoint in Admin
also requests an initial check after the response, before the next scheduled run.
See [Endpoint healthchecks](../operations/healthchecks.md) for concurrency and failure behavior.

First start generates four distinct high-entropy secrets in `.env`,
mode `0600`. Existing environments are preserved. Startup refuses to generate
replacement keys when a volume already exists without its environment.

## Create the first administrator

After backend health and the frontend setup route are ready and the scheduler is
running, the command prints an expiring, one-time URL:

```text
http://localhost:8080/setup/first-admin#token=...
```

Open it within 15 minutes and create the first super-administrator. Passkey
enrollment is optional during this onboarding flow; enroll one from
**Profile > Security** and enable **Require passkeys for administrators** before
production. The page removes the fragment and keeps the token only in memory.
If the link expires, run `bucketreef-quickstart start` again. Before initialization
this replaces the previous token; after users exist it prints the login URL.
Connecting storage is optional after setup.

Open **Admin → Getting started** to choose an evaluation, personal-use or
organizational-service goal. QuickStart highlights evaluation through the
informational `ONBOARDING_SOURCE=quickstart` setting; it does not force that
choice or alter security. The [guided setup](../getting-started/sysadmin-onboarding.md#guided-application-setup)
reuses existing resources and enables only the selected path's required
features after confirmation, while respecting deployment ENV locks.

## Manage the installation

```sh
bucketreef-quickstart status
bucketreef-quickstart logs
bucketreef-quickstart stop
bucketreef-quickstart start
bucketreef-quickstart version
```

Commands work from any directory. Stop, restart and re-running the installer
preserve the installed version, database and keys. Requesting a different
version is rejected with instructions for a manual upgrade.

`status` reports backend/frontend health and scheduler process state separately.
`logs` shows the last 80 log lines from each of the three services. A running
scheduler does not by itself prove that each job succeeded; inspect its logs if
endpoint statuses stop updating. Startup fails if any required service stops.

## Custom ports

Set values on the **shell executing the installer**, not on curl:

```sh
curl -fsSL https://bucketreef.ksperis.com/quickstart.sh |
  BUCKETREEF_FRONTEND_PORT=9080 BUCKETREEF_BACKEND_PORT=9000 sh
```

These values are persisted on first start. For an existing installation, stop
it and edit `.env`, keeping ports, `PUBLIC_ORIGIN`, `WEBAUTHN_ORIGIN`,
`WEBAUTHN_RP_ID`, CORS and allowed hosts coherent. Changing
`BUCKETREEF_BIND_ADDRESS` is an explicit operator decision. Follow the full
deployment guide for TLS before exposing the development profile.

## Reset with a verified backup

```sh
bucketreef-quickstart reset
```

Enter exactly `RESET BUCKETREEF`. The command stops the project,
saves the environment and complete SQLite volume, verifies the non-empty
archive and writes its manifest, then removes only the identified backend
volume. It preserves network/origin settings, creates fresh secrets and
restarts the same release. Other Compose projects are unaffected.

Backups are stored under `.bucketreef-backups/<UTC timestamp>/` in the
installation directory, including `app.db` and any WAL/SHM files. Preserve
keys together with their data. See [Backup and restore](../operations/backup-restore.md).
Never restore a database with unrelated keys.

## Manual upgrade

1. Stop QuickStart. Back up and verify the complete database volume and matching
   environment. Read the target release's migration notes.
2. Move the installation directory to a sibling backup directory, retaining its
   old `VERSION`, Compose, environment and backups. Keep the existing volume.
3. Install the target version with `--version X.Y.Z --no-start`.
4. Copy the previous `.env` into the new installation with mode `0600`,
   then start and verify health and login.

The bundle supplies the image version; editing an old `BUCKETREEF_TAG` value
in the environment does not upgrade it. There is no automatic database
rollback. If a migration changes the schema, restore the verified database
backup and matching keys before resuming the previous release.

## From evaluation to a complete deployment

Follow [Compose deployment](docker-compose.md),
[Configuration](../configuration/index.md), [Authentication security](../security/authentication.md)
and [Production readiness](../operations/production-readiness.md) for externally managed
secrets, TLS, a suitable database and production scheduler configuration. Do not reuse
evaluation secrets in production.
