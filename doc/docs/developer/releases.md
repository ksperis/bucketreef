# Release distribution

GitLab CI builds and validates the application once, then promotes those exact
images. Stable `vX.Y.Z` tags publish all three images to GHCR, the Helm chart
to `oci://ghcr.io/ksperis/charts/bucketreef`, and two GitHub Release bundles.
GitHub Actions validates public PRs without secrets. See [CI/CD](ci-cd.md) for
selection, tool locks and required external settings.

## Prerequisites

- Protected GitLab variables `GHCR_USERNAME` and `GHCR_TOKEN` with package
  publication rights. Use masked/hidden values and password-stdin login.
- A separate protected, masked/hidden `GITHUB_RELEASE_TOKEN`, restricted to
  `ksperis/bucketreef` with repository Contents write permission. Its job creates
  drafts, uploads assets and publishes releases; it does not push source branches.
- One protected, masked/hidden Project Access Token in `GITLAB_CI_READ_API_TOKEN`,
  with Reporter role and `read_api`, scoped commonly (`*`) so protected CI
  orchestration, preflight and release evidence jobs reuse the same credential.
- The exact source commit and `vX.Y.Z` tag must already exist on the public
  GitHub mirror. A missing tag or a different resolved SHA stops publication.
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
2. Integrate and synchronize the release source on main in GitLab and GitHub.
   A version metadata change selects complete qualification automatically. For
   any other main SHA, launch a web pipeline with `CI_MODE=qualify`. Wait for
   the successful parent and child: all autonomous tests, mandatory Ceph, three
   AMD64/ARM64 images, runtime checks, six scans and Kind. `qualification.json`
   binds their exact job IDs, digests and scan receipts to that SHA. The same
   child must have a green `release-preflight`, proving that release credentials,
   both `main` refs, public GHCR packages and prepared metadata are ready.
3. From that synchronized `main`, run
   `backend/.venv/bin/python ops/release/tag.py X.Y.Z`. It verifies HEAD against
   GitHub and GitLab, refuses conflicting tags, creates the immutable tag when
   absent, pushes GitHub first and then GitLab, and safely resumes a partial run.
4. Wait for all release jobs, including both architecture smoke tests, Helm
   anonymous pull and both GitHub and GitLab Release publication.

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
cannot be overwritten with different content. Main tests and tag metadata checks
reject a required snapshot that is missing or differs from the current schema.
Patch releases do not regenerate previous snapshots. `0.2.5` creates none, and
`0.2.1` is not backfilled. Fresh patch installations still create their current
target schema directly without replaying an earlier snapshot.

Use `backend/.venv/bin/python ops/release/schema_baseline.py X.Y.Z --check` to
verify a required snapshot. Keep schema-parity and upgrade tests for SQLite and
PostgreSQL; data transformations for existing installations remain in Alembic.

## Release notes and platform metadata

The tag job extracts the exact changelog section and appends a comparison link
against the highest lower stable tag reachable from the release commit. Full Git
history is required. Missing, empty or duplicate sections fail before promotion.
The GitHub and GitLab notes share that section and use platform-specific compare
URLs. Published notes and asset contents are immutable on retry.

GitLab publishes its release only after GitHub has published the verified draft.
It uses the built-in `CI_JOB_TOKEN` and links to the same four public GitHub assets;
there is no second bundle upload or stored GitLab personal token. If GitLab fails
after GitHub succeeds, retry that job: an identical existing release is accepted.
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

A tag pipeline resolves the existing qualification for its exact SHA. It checks
both remote tags, inclusion on main, successful parent/child pipelines and the
real job results through the project read API. Missing, canceled, skipped or
allowed-to-fail jobs, absent Ceph, incomplete architecture matrices, another SHA,
a missing report, or changed index/platform digests stop the release. No mutable
tag or reconstruction fallback is permitted.

Distribution proceeds in this order:

1. Fetch qualified images by digest and rescan both architectures without rebuild.
2. Prepare deterministic bundles, chart and changelog notes once as durable
   artifacts. Later jobs reuse those bytes and fingerprints.
3. Copy only immutable `X.Y.Z` images with all manifests, preserved index digests
   and attestations. Publish the versioned chart and OCI bundle artifact, and
   upload matching assets to a GitHub draft. Different existing content fails;
   identical partial publication resumes without replacement.
4. Check anonymous GHCR pulls, exact index/platform digests, chart bytes and Kind
   onboarding. Download bundles anonymously from `ghcr.io/ksperis/bucketreef-bundles`
   and run both QuickStart and Compose/scheduler smoke tests on AMD64 and ARM64.
5. `release-ready` verifies every real distribution job and records the complete
   `distribution-ready.json`, including asset fingerprints. No alias moves here.
6. `finalize-release` takes the shared `public-release` lock, rechecks jobs,
   qualification and files, publishes GitHub, verifies its public downloads,
   publishes GitLab metadata, then moves eligible minor/latest image aliases.
   The anonymous GitHub asset check allows a short bounded propagation window
   after publication, while content mismatches still fail immediately.

GitHub draft assets are not anonymously downloadable. The OCI candidate supplies
an anonymous distribution surface before finalization, and its checksummed bytes
must equal the GitHub assets. Application images, the chart package and
`bucketreef-bundles` must remain public. ORAS is pinned in the tool lock and
stores bundles in the existing GHCR registry.

Registry bootstrap is an exceptional recovery path; see
[Recovery / exceptional cases](#recovery-exceptional-cases) below.

Alias decisions compare numeric versions under the publication lock, using
stable releases that are actually published on both platforms. Merely creating a
higher Git tag does not advance an alias. A replay of an older pipeline cannot
regress minor/latest. A failure before the global gate leaves aliases unchanged
and a newly prepared GitHub draft unpublished.

Evidence artifacts, scan reports and qualified image digests must survive registry
and artifact cleanup. Revalidating an existing SHA reuses and tests the immutable
images; it never silently rebuilds a missing release source during distribution.
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
The global distribution gate precedes publication of the GitHub draft. Existing identical assets
are reused; conflicting or unverifiable assets stop publication. Published
releases are never repaired by silently replacing assets.

## Verify and recover

Verify the chart can be pulled without credentials, all three image indexes
contain both platforms, and the published archives match their checksums.
Exercise the installer on a fresh home directory, then rerun it and confirm
the installed version and secrets are unchanged. Record native and emulated
architecture evidence separately.

If a job fails, correct the cause and retry the same pipeline. A partial GitHub
upload remains a draft. A failed chart visibility check can be retried after
making the package public. Content conflicts require investigation and a new
release rather than overwriting an immutable version. An application rollback
may require restoring a verified database backup with its matching encryption keys.


There is no cross-service atomic transaction. After global validation, interruption
can leave GitHub published while GitLab metadata or some aliases remain pending.
Retry `finalize-release` from the same pipeline: it revalidates evidence, accepts
identical existing content and recomputes aliases under the lock. Do not delete or
move immutable versions to repair a failure. Public GitHub download checks occur
again after the draft is exposed; an outage there leaves aliases unchanged.
Metadata-only recovery cannot finish aliases or substitute for qualification.

### Recovery / exceptional cases

`bootstrap-release-bundles` is retained only for registry recovery and is not a
normal release step. If the OCI bundle package is ever missing and a stable tag
already exists, keep that tag unchanged. From protected `main`, run a web pipeline
with `CI_MODE=bootstrap-release-bundles` and `BUNDLE_BOOTSTRAP_VERSION=X.Y.Z`.
The bootstrap verifies matching GitHub/GitLab tag SHAs, reconstructs the four
deterministic bundle files from the immutable tag and publishes only that OCI
artifact. If this is a genuinely new package, make it public once, then retry the
original tag pipeline so normal release validation resumes.

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
