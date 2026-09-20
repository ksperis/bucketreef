# Public validation and private CI/CD

GitHub Actions runs autonomous validation on pull requests (including forks) and
merge queues. GitLab revalidates integrated revisions, runs Ceph, builds official
images and distributes releases. There is no bridge, label-based private approval,
external-PR checkout in a privileged job, or new mirror service.

## Selection and required checks

`ops/ci/plan.py` owns event policy, path classification and dependencies.
`events.py` resolves the event revision and emits schema-1 `ci-plan.json` with the
compared base, contribution head, tested SHA, expected jobs and selection reasons.
GitHub tests the PR merge commit (or merge-group commit), with full Git history.
Local `git diff --no-renames -z` includes removed paths and both sides of renames;
it has no PR-files API pagination limit. Unknown paths, missing history, a first
integration and changes to CI select all relevant checks conservatively.

| Event | Profile and work |
|---|---|
| GitHub PR into main/dev or merge queue | Impact-selected autonomous checks, hosted ephemeral runners, read-only token |
| Protected GitLab main/dev push | Compare to the last successful integration on that same branch, revalidate selected work |
| Effective version metadata change on main | Complete qualification, including Ceph and all official images |
| Web pipeline on main, `CI_MODE=qualify` | Complete qualification of the pipeline's exact main SHA, including docs-only revisions |
| Protected stable `vX.Y.Z` push | Check qualification, rescan and distribute existing artifacts; no image rebuild |
| Schedule on main, `CI_MODE=regression` | All autonomous checks and Ceph, without producing official images |
| Schedule on main, `CI_MODE=security` | Dependency/secret checks and both architectures of the latest qualified public images |
| Schedule on main, `CI_MODE=secrets-history` | Full-history secret scan only |
| Web pipeline on main, `CI_MODE=docs` | Strict docs build, screenshot inventory and Cloudflare deployment only |
| Web pipeline on main, `CI_MODE=recover-release` | Recover GitLab metadata for an existing public release only |

Version detection compares version fields, rather than treating every lockfile
edit as a new release. Cancellation or failure does not advance the integration
baseline: the next integration compares against the previous completed successful
parent and child pipeline with verifiable `integration.json`. A docs deployment,
maintenance run or release tag cannot become that baseline. The read API failing
is an error; an available API with no previous evidence triggers a full selection.

Backend changes select pytest, PostgreSQL/migrations and Vulture; runtime changes
also select browser checks, Ceph and image tests. Frontend selects the existing
quality suite, Vitest and browser tests. Dependency changes add the corresponding
Trivy scans; `npm audit --omit=dev --audit-level=high` remains in frontend quality.
Release scripts select Python tests and Helm/Compose contracts. Deploy changes
also select image onboarding checks. Cron/scheduler selects Python/ops contracts,
a public native scheduler smoke and the private scheduler build/scan. Backend and
frontend images are built together when Kind needs the pair at the exact SHA;
no old component is relabeled as a new commit. Documentation and capture scripts
select strict MkDocs, screenshot inventory and associated script tests.

The workflow has no global path filter. Require the stable **`CI / required`**
check in GitHub. Its `always()` gate requires a successful selector and success
for every expected fixed job. Missing, failed, canceled or incorrectly skipped
jobs fail the gate. Unselected jobs may be skipped. Logs, JUnit, Playwright HTML
and failure traces are available in the public Actions run. Fork approval uses
GitHub's native workflow approval, never a private execution label.

GitLab generates one bounded child pipeline from `ops/ci/gitlab/jobs.yml`.
Every selected dependency is mandatory, with no `optional` or `allow_failure`
escape. The parent uses `strategy: depend` for GitLab CE 18.1 compatibility.
`integration-ready` and `release-ready` also inspect real API job results,
including both named members of scan/smoke matrices and each job's commit SHA.

## Trust and credentials

Root and child workflows reject unprotected references and unsupported pipeline
sources, including external pull requests and merge requests. Only integrated,
reviewed commits on protected main/dev and protected stable tags reach private
runners. GitHub uses no infrastructure secrets, privileged self-hosted runner or
`pull_request_target`. A fresh commit requires fresh validation of that SHA.

Configure protected, masked/hidden variables with these environment scopes:

| Environment | Credentials and purpose |
|---|---|
| `ci-ceph` | Dedicated Ceph lab credentials used only by `ceph-functional-tests` |
| `ci-orchestration` | Project `GITLAB_CI_READ_API_TOKEN` with `read_api`, for selection and evidence; no production credentials |
| `release-public` | GHCR package token, GitHub release Contents-write token; read_api token for the final evidence recheck |
| `docs-production` | Cloudflare Pages token limited to the documentation project and account |

Use two environment-scoped entries for the read token if needed. GitLab 18.1's
`CI_JOB_TOKEN` cannot perform the general pipeline/job reads used for evidence.
Keep it for Git transport, built-in registry operations and supported Release API
operations. Do not store a personal administrator token. Pipeline variables are
not forwarded wholesale to children; the validated recovery version is the only
user value explicitly transferred beyond the selected plan.

Ceph is mandatory whenever selected. Missing lab configuration fails the job.
The central `test_account_bucket_object_flow` must exist and pass; a skipped core
is a failure. Optional-capability skips remain governed by the documented Ceph
suite and appear in JUnit and the skip summary. Its lab is serialized to avoid
competing tests. See the suite's README for the current capability exclusions.

## Tools, caches and maintenance

`ops/ci/tools.json` locks image indexes and CLI versions. GitHub actions are pinned
to commit SHAs. Node 24.21.0 is shared by the workflow, frontend image and
`frontend/.node-version`. The Playwright image and npm package both use 1.58.2;
its job replaces the image's embedded Node with the checksummed Node 24 binary
and verifies the installed package/version before running. Upgrade these together.
The dependency lockfile remains authoritative for the browser payload.

Only npm/pip downloads are cached, keyed by dependencies and tool versions. Public
GitHub caches and protected GitLab caches are separate; do not share runner caches
across trust boundaries. BuildKit cache writes are restricted to protected builds
and component/branch namespaces. Builds still run tests and scans when reusing an
existing SHA image. Global retries cover infrastructure errors only; test failures
are not retried as entire jobs. Playwright retains its explicit single retry and
failure diagnostics.

One Trivy JSON scan produces table and CycloneDX output, preserving HIGH/CRITICAL,
ignore-unfixed and reviewed `.trivyignore` exceptions. Qualification records six
architecture-specific scan receipts with job IDs, exact image inputs, report
hashes, tool versions and timestamps. Release pipelines rescan the same digests.
Secret detection requires a successful analyzer report and zero unresolved findings.
Public PostgreSQL CI URLs and synthetic AWS identifiers used in redaction tests
and screenshots are exempt only when the detector rule, file and complete
extracted value match `ops/ci/secret_report.py`. This includes the former root
GitLab template and the exception definition itself. Removed localhost database
examples additionally require their original commit and exact extract fingerprint;
reintroducing one in a new commit still fails. Changed hosts, passwords, identifiers
or paths remain blocking. The job reports the number of exempt fixture findings.
Only redacted file/line/type diagnostics are uploaded; raw analyzer output is discarded.
Normal scans use the explicit Git range, while historical maintenance scans all
history. The scheduled image scan refuses old releases without qualification;
qualify and publish a new version before enabling that schedule after migration.

## External setup and rollout

The repository cannot enforce these administrator settings by itself. This change
does not apply them remotely:

1. On GitHub main/dev, require `CI / required` from GitHub Actions, reviews and
   current checks (or a merge queue). Disable force pushes/deletion and restrict
   bypass. Enable code-owner review for `.github`, `.gitlab-ci.yml`, `ops/ci`,
   `ops/release`, dependency locks and deployment manifests. Protect release tags.
   Do not require the individual conditional jobs: skipped unrelated checks are
   expected. Retain native fork-workflow approval and read-only token defaults.
2. On GitLab, protect main/dev and `v*`, restrict merges/tag creation and CI config
   changes to maintainers, and restrict pipeline-variable overrides. Disable any
   integration that imports public PR code as privileged pipelines. Preserve the
   protected cache separation setting.
3. Register dedicated ephemeral runners tagged `bucketreef-protected`, marked
   protected and locked to this project. Permit DinD/binfmt only in that trusted
   pool; do not expose the host Docker socket or production network credentials.
   Exclude this project from any broad shared runner with weaker restrictions.
4. Configure the environment-scoped secrets above, token expiration/rotation,
   Ceph lab isolation and Cloudflare permissions. The first new pipeline fails
   closed until the read token and required lab configuration are present.
5. Keep explicit, fast-forward synchronization of main/dev and matching tags
   between GitHub and GitLab. Preserve commit SHAs; never recreate commits or move
   published tags. Tag GitHub first, then GitLab, after main qualification succeeds.
6. Keep qualification and distribution manifests, reports, bundles and referenced
   image digests indefinitely (`expire_in: never` on evidence jobs). Exclude their
   registry tags/manifests from cleanup. Back up GitLab artifacts and registry;
   a missing proof or source digest blocks publication rather than triggering a
   rebuild. Set storage quotas/retention for routine one-week reports separately.
7. Make the GHCR application images, `charts/bucketreef` and `bucketreef-bundles`
   packages public. Configure the three explicit schedule profiles on main with
   a trusted owner. Avoid duplicate schedules; start security maintenance only
   after the first qualified release is available.

No branch or tag is pushed as part of local implementation. After settings and
synchronization, exercise one fork PR, one merge-group run if enabled, main/dev
integration, a deliberate canceled integration, a full qualification, and a new
release. The release run must prove Ceph, registry copy/visibility and DinD/Kind
on the actual runners; local fixtures and graph checks cannot prove these.

## Local validation

Install Python CI dependencies and the pinned tools, then run:

```sh
python3 -m pip install -r ops/ci/requirements.txt
python3 -m pytest ops/ci/tests -q
sh ops/ci/tasks/lint.sh
# With application dependencies installed:
sh ops/ci/tasks/run.sh backend-tests
sh ops/ci/tasks/run.sh frontend-quality
sh ops/ci/tasks/run.sh frontend-tests
sh ops/ci/tasks/run.sh docs-build
```

Tests cover event/path selection, rename/delete and incomplete-history fallback,
failed selectors, canceled/missing jobs and matrices, trust rejection, successful
baseline provenance, qualification tampering, immutable conflicts and interrupted
publication. Graph checks use the assembled configuration with locked images.

References: [GitLab child strategy](https://docs.gitlab.com/ci/yaml/#triggerstrategy),
[GitLab job-token permissions](https://docs.gitlab.com/ci/jobs/ci_job_token/),
[GitHub required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
