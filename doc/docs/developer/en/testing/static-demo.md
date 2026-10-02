# Static interactive demo

The public demo at <https://demo.bucketreef.ksperis.com> uses the product frontend
with a local HTTP adapter. It has no server, authentication, live S3 credentials,
Ceph connection or external delivery. The default workspace is Manager, in English.
The persistent profile bar switches between Platform admin, Account manager,
End user (member or project manager), and Ceph admin. End users can open Portal
and Browser. The displayed revision identifies the deployed source commit.

## Running and validating

From `frontend/`, with the repository's Node version and `npm ci`:

```sh
npm run dev:demo
npm run build:demo
npm run preview:demo
npx playwright install chromium firefox webkit
npm run test:demo
npm run check:ci
npm run demo:isolation
```

`dist-demo/` is the complete deployment artifact. The preview serves those files
with their Cloudflare response headers and SPA fallback; it has no API handler.
Browser tests use the built application directly, without Playwright request
mocks. Chromium, Firefox and WebKit run the same scenarios. Business requests
must remain inside the adapter; the workspace tests reject real outgoing API
requests. The route inventory also checks local response statuses and JavaScript
errors. A final Safari check is performed against the published HTTPS site.

The normal build is `dist/`. Its entry does not load the demo runtime, data or
CSS. Demo restrictions use compile-time mode checks, and the isolation check
scans the normal output for demo implementation markers. A query parameter
cannot turn a production build into a demo.

## Scenario and persistence

The seed contains two Ceph endpoints, five accounts, 60 application users,
30 buckets, 12 Storage Spaces and 3,600 current object entries, plus previous
README versions. Each bucket has a distinct object count (21–353), with different
workloads across accounts. Admin, Manager, Portal, Browser and Ceph use the same
resource collections. Inventory totals and quotas follow changes; 90 days of historical
snapshots remain fixed until reset. Storage trends share a deterministic scenario
with quiet days, batch imports and occasional decreases; their final point matches
the initial inventory. Dataset sizes represent a production
inventory; their downloads contain small sample payloads. Uploaded files retain
their actual bytes. The coverage dialog makes this distinction explicit.

Dashboard mini-charts receive the same historical samples through the local
adapter's `demo_storage_points` metadata on the storage baseline. This extension
and its reader are excluded from the normal build; no backend API changes.

IndexedDB stores one typed state envelope, including binary file contents.
Files are encoded as ArrayBuffers at the persistence boundary and reconstructed
as Blobs at runtime, including in WebKit's isolated browser contexts. Successful
mutations are serialized and saved before their response resolves. Failed
mutations roll back their changes. Upload limits are 20 MiB per file and 100 MiB
in total, including retained uploaded versions. Deleting a versioned object
creates a delete marker and does not free retained upload storage.

`frontend/demo-data-version.json` owns the data format version independently of
the product version. Compatible releases preserve local edits. Increment it when
the state format becomes incompatible: users see a reset explanation and must
explicitly confirm before their saved state is replaced. There are no data
migrations, cross-tab live synchronization, schedulers or background workers.
A reload reads the last committed state from another tab.
Seed-only changes preserve that state too: use **Reset demo** to load the revised
initial inventory in a browser that already has saved demo data.

## Coverage contract

`frontend/src/demo/registry.ts` is the canonical coverage and limitations list,
also rendered in the demo toolbar. Each extension needs an explicit API handler
and a scenario in `frontend/e2e/demo/`. Unknown contracts return an error; there
is no generic successful fallback. Existing frontend API types are reused for
resources and responses.

| Area | Interactive coverage | Boundaries |
|---|---|---|
| Admin | Users, groups, direct/group account associations, accounts, endpoints, manual connection declarations, quotas, Portal request approvals | Connection credentials are discarded; validation reports that no endpoint was contacted. Declarations do not introduce an additional storage scenario. Global settings, authentication, integrations and API tokens are read-only. |
| Manager | Bucket creation/deletion, configuration documents, versioning, lifecycle, CORS, policies, quotas, IAM entities, group membership, policy attachments, inline policies and fictitious keys | Nonempty buckets cannot be removed. Lifecycle, IAM evaluation, replication and encryption do not execute. Compare returns a predefined example with no remediation. |
| Portal | Private/team spaces, project collaborators, internal shares, Viewer/Editor access, requests, files and individual version restoration | Project settings stay locked. Archives and Viewer grants prevent writes. Public links are examples only. Removing nonempty spaces is rejected. |
| Browser | Bucket/folder navigation, search, upload, preview, download, deletion, metadata and tags | Technical settings and version history are read-only. Imported data remains local. Seeded datasets download sample payloads. |
| Ceph admin | Common bucket/account/RGW-user inventory, account and user quotas, current bucket configuration and fictitious keys | Health, traffic, billing, audit and operational history are snapshots. No Ceph operation is executed. |

Migrations, purge, integrity/index operations, managed private provisioning,
multipart/resumable/cross-context transfers, bulk and point-in-time restoration,
history cleanup, MFA/SSO/LDAP enrollment, recovery, global key rotation, SNS,
webhook sends and usable public sharing are disabled. Migration deep links are
blocked before application startup; product feature guards also block in-app
navigation. Settings responses keep the four excluded product feature flags
false, and writes cannot enable them.

The test scenarios cover `governance`, `iam`, `cross-workspace`,
`portal-approval`, `portal`, `files`, `persistence`, `restrictions`, and
`workspaces`. They include actual bucket/request/file forms, the full
Portal → Admin → Portal approval loop, cross-workspace state visibility,
Viewer denial, upload boundaries, reset, deep links, profile switching,
keyboard controls, mobile layouts and light/dark themes.

## Publication

The Cloudflare Pages project is `bucketreef-demo`, with production branch `main`.
Only static assets are uploaded. Pages' SPA fallback handles deep-link reloads;
do not add a top-level `404.html`. Generated `_headers` forbid indexing,
external business connections, forms leaving the page, plugins and embedding.
No Cloudflare Worker or Pages Function is deployed.

GitLab uses protected, masked/hidden `CLOUDFLARE_API_TOKEN` and protected
`CLOUDFLARE_ACCOUNT_ID` variables scoped to `demo-production`. Grant the token
Cloudflare Pages Edit on the intended account, without unrelated zone, DNS,
Workers, identity or billing permissions. Cloudflare's Pages API permission is
account-scoped; the deployment script fixes the destination project name.

1. Configure the protected `demo-production` variables above.
2. For the first publication only, run a protected **web** pipeline on `main`
   with `CI_MODE=bootstrap-demo`. It builds and tests the static artifact, then
   runs `demo-bootstrap`, creating the Pages project if it does not exist.
   A retry of the same revision is allowed; a new
   bootstrap revision cannot overwrite an existing deployment.
3. Associate `demo.bucketreef.ksperis.com` as a custom domain in Cloudflare,
   then add `demo.bucketreef CNAME bucketreef-demo.pages.dev.` in Gandi with
   TTL 300.
4. Automatic version-change releases and explicit `prepare-release` runs execute
   `frontend-demo` on the application revision. Publication checks the final
   `publication.json` and every retained demo file hash. `resume-release` reuses
   those same tested files, with separate application and orchestration SHAs.
   `release-ready` requires that result. `demo-deploy` consumes that same
   artifact only after `finalize-release` succeeds. Stable tag pipelines keep
   their verification-only role.
5. After public HTTPS, deep links and Safari have been validated, expose the
   Demo link before Docs in the independent marketing site's navigation and
   publish it using that site's CI.

`cloudflare-demo-production` serializes deployments. `deploy-demo.mjs` checks
the artifact commit against the CI plan, requires protected `main`, verifies the
previous production manifest through its immutable Pages deployment URL, and
rejects older versions/pipelines and different revisions of an already deployed
version. API/read failures fail closed. The published commit is checked again
after Wrangler returns.

Both the tested `dist-demo/` artifact and `demo-deployment.json` are retained
indefinitely. The latter records the new and previous Pages deployment IDs.
For rollback, use Cloudflare Pages' production rollback to that previous ID,
then recheck `/demo-release.json`, deep links and HTTPS. If that deployment is
no longer retained by Cloudflare, recover its exact archived static artifact;
do not rebuild an old revision and label it as the tested artifact. A failed
demo publication does not undo an already finalized product release: retry the
same deployment job and artifact after fixing the infrastructure issue.
