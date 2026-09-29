# Release distribution

A version increase pushed to protected `main` automatically runs one parent/child
pipeline through qualification, candidate distribution, installation tests,
stable promotion, public verification and demo deployment. Stable registry tags,
Git tags, releases and aliases are created only after **all** installation tests
pass. Images are built once; promotion preserves their exact digests and the
exact tested archive bytes. GitHub Actions validates PRs without release secrets.
See [CI/CD](ci-cd.md) for selection, tool locks and required external settings.

## Prerequisites

- Protected GitLab variables `GHCR_USERNAME` and `GHCR_TOKEN` with package
  publication rights. Use masked/hidden values and password-stdin login.
- A separate protected, masked/hidden `GITHUB_RELEASE_TOKEN`, restricted to
  `ksperis/bucketreef` with repository Contents write permission. The finalizer
  uses it to create the GitHub tag, upload assets and publish the release; it does
  not push source branches.
- One protected, masked/hidden Project Access Token in `GITLAB_CI_READ_API_TOKEN`,
  with Reporter role and `read_api`, scoped commonly (`*`) so protected CI
  orchestration, preflight and release evidence jobs reuse the same credential.
- The exact source commit must be the current `main` SHA on GitHub and GitLab.
  A new release version must not already have a stable tag on either forge;
  preparation refuses pre-existing tags and directs recovery to the original
  finalizer instead.
- Docker-in-Docker runners support privileged binfmt registration. Builds use
  Buildx and QEMU; ARM checks on an AMD64 runner are emulated, not native proof.
- The `charts/bucketreef` and `bucketreef-bundles` GHCR packages must remain
  public. `release-preflight` checks anonymous access before a release tag exists.

## Prepare a release

1. Write one non-empty `## X.Y.Z - YYYY-MM-DD` section in `CHANGELOG.md`, then run
   `backend/.venv/bin/python ops/release/prepare.py X.Y.Z` from the repository root.
   This synchronizes the frontend package/lock, chart `version`/`appVersion`, and
   Compose example. For `0.X.1` it also generates the schema reference snapshot.
   Review and commit the complete diff. Chart image tags remain empty to inherit
   `appVersion`; the bundle packager stamps its exact version into `.env.example`.
2. Push the identical commit to GitHub **first**, then GitLab `main`. The GitLab
   push compares version fields against `CI_COMMIT_BEFORE_SHA`, checks metadata,
   changelog and numeric progression, and selects `prepare-release` automatically.
   Dependency-only changes, PRs and `dev` never publish. If the push comparison is
   unavailable, CI selects full qualification without authorizing publication.
3. Follow the parent pipeline to its terminal result. It waits for qualification,
   candidate distribution, AMD64/ARM64 QuickStart and Compose/scheduler tests,
   packaged-chart Kind installation/upgrade, stable promotion and demo deployment.
   Do not create the stable tag manually.
4. For explicit preparation after a CI fix, use a protected main web pipeline with
   `CI_MODE=prepare-release`. It runs the **same complete workflow**, reusing only
   already-built immutable images at that exact SHA. `CI_MODE=qualify` performs
   full qualification and preflight, without publishing candidates or a release.

`ops/release/tag.py` is retained only as an exceptional manual helper. Do not use
it for normal publication: a manually created stable tag is verification-only in
CI and cannot start or repair a distribution.

The initial deployment reorganization does not republish `0.2.4`. It takes
effect with the next new application version. For the first rollout, publish
the distribution changes and release artifacts before deploying the updated
user-facing documentation and website. Both deployments check that the public
bundles and checksums exist before advertising the installer. Until the first
new release is published, these deployment jobs fail without changing the live
sites; retry them after release publication.

## Database schema baselines

Fresh databases already use the installed release's SQLAlchemy metadata followed
by `alembic stamp head`. Versioned databases run `alembic upgrade head`; non-empty
unversioned databases are rejected. Keep that distinction and all historical
migrations. A baseline is a reference snapshot, not a second migration branch
or a replacement for the current models at startup.

For each new `0.X.1`, preparation writes deterministic `sqlite.sql`,
`postgresql.sql`, and `manifest.json` under `backend/schema-baselines/X.Y.Z`.
The manifest records the application version, Alembic head and file SHA-256s.
Snapshots contain DDL only, never database rows or credentials. Existing snapshots
cannot be overwritten with different content. Main tests and release metadata checks
reject a required snapshot that is missing or differs from the current schema.
Patch releases do not regenerate previous snapshots. `0.2.5` creates none, and
`0.2.1` is not backfilled. Fresh patch installations still create their current
target schema directly without replaying an earlier snapshot.

Use `backend/.venv/bin/python ops/release/schema_baseline.py X.Y.Z --check` to
verify a required snapshot. Keep schema-parity and upgrade tests for SQLite and
PostgreSQL; data transformations for existing installations remain in Alembic.

## Release notes and platform metadata

The release metadata job extracts the exact changelog section and appends a comparison link
against the highest lower stable tag reachable from the release commit. Full Git
history is required. Missing, empty or duplicate sections fail before promotion.
The GitHub and GitLab notes share that section and use platform-specific compare
URLs. Published notes and asset contents are immutable on retry.

GitLab publishes its release only after GitHub has published and verified the
release. It uses the built-in `CI_JOB_TOKEN`; when the GitLab tag is still absent,
the Release API creates it at the validated SHA from the supplied `ref`. GitLab
links to the same four public GitHub assets, so there is no second bundle upload
or stored GitLab personal token. If GitLab fails after GitHub succeeds, retry the
same `finalize-release`: identical tags, assets and metadata are accepted.
Manage and renew the dedicated GitHub token before its configured expiration.

Tag verification uses Git transport because older GitLab versions, including
18.1, do not grant job tokens access to the Tags API. If publication code itself
needs a fix after the public tag exists, commit the fix on the protected default
branch and launch a web pipeline with `CI_MODE=recover-release`. It defaults to the current
application version; set `GITLAB_RELEASE_RECOVERY_VERSION` to recover an older
version. The job reads the changelog and previous tag from the released commit,
checks matching remote tags, public GitHub notes and all four asset digests and
checksums, then publishes only GitLab metadata with `CI_JOB_TOKEN`. It does not
move tags, build artifacts, change aliases or create retroactive qualification.
Retrying identical metadata is read-only.

## Qualification and distribution gates

Qualification verifies successful real job IDs through the read API, exact source
SHA, Ceph, all architecture matrices, reports and index/platform digests. Missing,
failed, canceled, skipped or allowed-to-fail gates stop the release. Evidence
validation reads completed jobs while its own parent is still running; waiting
for that parent to finish would create a circular dependency.

Distribution proceeds in this order:

1. Complete application, security, Ceph and Kubernetes qualification. Build the
   three multiarchitecture images once and rescan their exact digests for release.
2. Prepare deterministic Compose/QuickStart archives, chart and notes once.
3. Publish images as `candidate-<full-source-SHA>-<child-pipeline-id>` in the existing
   public GHCR image repositories. A candidate OCI envelope in
   `ghcr.io/ksperis/bucketreef-bundles` stores the four assets, chart and both notes.
   Neither stable `X.Y.Z` tags nor aliases exist at this point.
4. Download the candidate envelope anonymously and run installation tests. Each
   isolated DinD daemon pulls images by platform digest, then assigns their
   expected `X.Y.Z` names **locally**, without pushing those names to a registry.
   QuickStart first start/restart and fresh Compose verify the running image IDs
   and architectures; Kind uses the unchanged packaged chart and digest-bound
   images for installation, onboarding and upgrade.
5. `release-ready` checks all actual jobs and installation receipts. It records
   schema-2 `distribution-ready.json`, binding the candidate inventory, source SHA,
   pipelines/jobs, image digests, archive hashes and tested demo files.
6. One `finalize-release` job holds `public-release` through all stable mutations.
   It rechecks proofs and both current main refs, anonymously fetches the same
   candidate bytes, promotes images/bundles/chart, verifies public registry access,
   creates and verifies GitHub, then creates GitLab. Minor/latest aliases (and
   GitHub latest) move last, only when numeric ordering permits. Demo deployment
   consumes the final `publication.json` and the fingerprinted demo artifact.

`qualification.json` (schema 1), `candidate-inventory.json` (schema 2),
`installation-receipts/*.json` (schema 1), `distribution-ready.json` (schema 2) and
`publication.json` (schema 2) are durable contracts. Evidence, reports and prepared
files use `expire_in: never`; preserve their registry digests during cleanup and
back up GitLab artifacts. A missing proof never authorizes a rebuild or a bypass.

On the current AMD64 runner ARM64 is emulated through QEMU. Public Compose keeps
24 health attempts by default; CI explicitly sets `BUCKETREEF_HEALTHCHECK_RETRIES`
to 60 for QEMU, with readiness budgets of 600 seconds. The bundle test has a global
40-minute ceiling inside a 45-minute job. Its helper has no shorter lifetime.
Before cleanup, retain only allowlisted container states, health exit codes,
architectures, image identities, phase timings and installation checkpoints.
Raw application logs, generated environments and bootstrap URLs stay ephemeral
inside DinD and are never uploaded as artifacts.

The chart retains the existing Secret, proxy and NetworkPolicy contracts.

The standard-library packager emits deterministic archives containing only
Compose, `.env.example`, `README.md`, `LICENSE`, `VERSION`, and (for QuickStart)
the lifecycle command:

```sh
python3 ops/release/package_bundles.py --version X.Y.Z --output dist/release
```

The four GitHub assets have stable names within each release:

- `bucketreef-compose.tar.gz` and `bucketreef-compose.tar.gz.sha256`;
- `bucketreef-quickstart.tar.gz` and `bucketreef-quickstart.tar.gz.sha256`.

Release smoke tests run anonymously downloaded QuickStart and Compose bundles
from isolated Docker-in-Docker daemons using public GHCR images, without a source
checkout.
They check readiness, bootstrap URL issuance, stop/restart and secret persistence.
The global distribution gate precedes stable-tag creation and GitHub asset upload.
Existing identical assets are reused; conflicting or unverifiable assets stop publication. Published
releases are never repaired by silently replacing assets.

## Verify and recover

Verify the chart can be pulled without credentials, all three image indexes
contain both platforms, and the published archives match their checksums.
Exercise the installer on a fresh home directory, then rerun it and confirm
the installed version and secrets are unchanged. Record native and emulated
architecture evidence separately.

Before stable promotion, fix a failed check and retry its dependent jobs, or
prepare a newly qualified candidate for the same still-unused version. No stable
registry reference, Git tag, release or alias has been created by candidate tests.

After promotion starts, there is no transaction spanning registries and forges.
Retry the original finalizer after a network interruption: identical existing
content is accepted and different content is refused. Never delete, overwrite or
move an immutable version. A public GitHub outage stops GitLab publication and
alias updates. An application rollback may require restoring a verified database
backup with matching encryption keys.

### Recovery / exceptional cases

If the finalizer code needs a fix, use protected main web mode `resume-release`
with `RELEASE_RECOVERY_VERSION=X.Y.Z` and
`RELEASE_RECOVERY_PIPELINE_ID=<original child pipeline>`. Recovery requires a
successful `release-ready` job with schema-2 evidence and rechecks every original
qualification and installation job, including both architectures. It is not
specialized to one failing job or one version. A candidate with failed installation
checks cannot be promoted through recovery; repair and qualify it first.

The orchestration commit must descend from the original source commit. Recovery
restores only retained proofs, the exact candidate OCI bytes and fingerprinted
demo files. It never packages the current product checkout. The publication proof
separately records the application SHA and orchestration SHA; forge tags refer to
the former. Both current main refs must match the latter. Missing retained files,
changed hashes or conflicting stable content stop recovery. The same finalizer
and publication lock handle registry, forge and alias retries; demo follows its
successful final publication proof. Legacy schema-1 distribution evidence does
not qualify for this new generic recovery path.

`bootstrap-release-bundles` is retained only for registry recovery and is not a
normal release step. If the OCI bundle package is ever missing and a stable tag
already exists, keep that tag unchanged. From protected `main`, run a web pipeline
with `CI_MODE=bootstrap-release-bundles` and `BUNDLE_BOOTSTRAP_VERSION=X.Y.Z`.
The bootstrap verifies matching GitHub/GitLab tag SHAs, reconstructs the four
deterministic bundle files from the immutable tag and publishes only that OCI
artifact. If this is a genuinely new package, make it public once, then rerun the
relevant public verification. Stable tag pipelines are verification-only and do
not restart distribution.

## Historical notes and the documentation index

Historical publication is separate from artifact distribution. On protected
`main`, start a web pipeline with `CI_MODE=release-history`. It previews every
GitHub/GitLab release action without writes. Set `RELEASE_HISTORY_APPLY=true`
explicitly to apply the reviewed catalog. Both modes verify remote tags and
refuse conflicting descriptions before writing. Application is idempotent and
never builds images, uploads assets, creates baselines, or edits tags.

The versioned `ops/release/history.json` catalog records commit, historical date,
date provenance and whether publication on both platforms has been confirmed.
Notes are taken only from `CHANGELOG.md`; reconstructed sections are labelled.
GitHub's actual publication timestamp is not backdated. Historical GitLab
releases receive their catalog date, and neither platform's latest release moves.
The one-time v0.1.8 GitLab alignment is recorded in the catalog and rendered notes;
it does not establish the provenance of existing container images.

After publication, download `dist/release-history/confirmed.json` from the
successful job and review it against the checked-in catalog. Copy it to
`ops/release/history.json`, then run:

```sh
python3 ops/release/history.py
python3 ops/release/history.py --check
python3 -m mkdocs build -f doc/mkdocs.yml --strict
```

Commit the confirmed catalog and generated page, synchronize the commit and
publish documentation with the normal docs pipeline. For future versions,
append their changelog and catalog metadata, then confirm publication on both
platforms before setting `confirmed: true` and regenerating the page. Generation
is offline and includes only confirmed entries; the browser never queries APIs.
Do not run historical publication against future drafts or pending releases.
