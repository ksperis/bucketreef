# Browser simplification: implementation and validation

Implementation record for 28 September 2026. The managed worktree starts from
`main` at `75f29467` on `codex/browser-simplification`. Earlier Browser behavior at
`6f37a18c` is a reference, not a sequence of blind reverts. The original checkout
is preserved; delivery consists of local commits only.
See the [user guide](../user/feature-objects-browser.md) for behavior and limits.

## Retained behavior and shared contracts

- Mixed file/folder ZIP selections retain recursive enumeration, deduplication,
  path and collision protection, streaming, bounded Blob fallback, cancellation
  and immediate operation results. Empty archives and streaming writer closure
  retain the fixes made after the original implementation.
- Personal path favorites retain the standalone **Buckets / Favorites** sidebar,
  bucket/path/context subtitles, create/rename/delete and account synchronization.
  Embedded Browser surfaces expose favorites through **More**. Inaccessible
  contexts never silently switch execution identity.
- Current-object previews retain CSV tables, collapsible JSON, raw-text fallback,
  text search, loaded-file navigation and unsaved-change protection. Limits remain
  50 MiB per object and 64 KiB of text; previews execute no active markup.
- The original toolbar, framed object icons, display controls, transfer indicators,
  search-options menu and simple selection count are restored. Selection covers
  loaded items only. Search retains its original query, scope, recursion, exact
  match, case, item-type and storage-class contracts and bounded pagination.
- Uploads and Copy/Cut/Paste use the original S3 overwrite/versioning behavior.
  The original multipart transfer, progress, cancellation and in-session results
  remain. Manager workspace headers and source/destination Portal access checks
  remain authoritative, including folder-marker creation during clipboard copy.
- Version listing, downloading and restoration retain exact version identifiers.
  Historical preview and comparison are removed. Deep links, exact S3 keys,
  independent navigation fixes and SDK compatibility are preserved.

Conflict preflight and destination workflows, rich listing filters, selection
volume calculation, saved views, targeted failure replay, persistent transfer
history, upload recovery, fingerprints, workers and cross-tab locks are removed.
Their unused components, API contracts, routes, translations and demo consumers
are removed as well. Ordinary display preferences remain independent of favorites.

## Persistence transition

Migration `0137_browser_path_favorites` follows
`0136_merge_browser_migration_heads`. It creates `browser_favorites` with only
`id`, `user_id`, `name`, `surface`, `workspace`, `context`, `bucket`, `prefix`,
`revision`, `created_at` and `updated_at`; dates use `UTCDateTime`.

Only path favorites are copied from `browser_presets`. Their IDs, owners,
revisions, dates and exact paths are preserved. Saved views are discarded and the
old table and JSON payload column are dropped. A downgrade reconstructs the old
format for surviving favorites; it cannot reconstruct discarded views. Historical
migrations are unchanged. No production database was migrated during validation.

The only CRUD route is `/users/me/browser-favorites`, with strict dedicated
payloads, personal ownership, surface separation, the existing 500-item limit and
optimistic revisions. The former presets route has no alias. The demo uses the
same path-only model and an incremented data version.

Session responses no longer contain recovery identifiers. A non-blocking,
idempotent `deleteDatabase` request retires `bucketreef-browser-transfers-v1`;
it never opens that database or sends an S3 abort. Authorized users can still
inspect and abort remote multipart uploads through the existing tools.

## Validation evidence

The authenticated harness uses a fresh application database and Moto S3; it does
not connect to production storage. Commands run from `frontend/` or `backend/`.

| Area | Evidence |
| --- | --- |
| Frontend | Full Vitest suite: 507 files and 3,089 tests passed. Subsequent targeted tests passed for the final clipboard workspace header, demo favorites and transfer-error cleanup. |
| Backend | 356 tests passed across Browser, Portal exact-object/read access, auth-session flow and session models; two additional API/schema removal-contract tests and seven Manager Browser access tests passed. |
| Migration | Seven favorites tests include populated multi-user migration, exact fields/paths/dates/revisions, removal of saved views, downgrade/re-upgrade and a complete empty-database Alembic upgrade to head. |
| Authenticated Browser | Six combined Chromium journeys passed, plus seven existing navigation, upload, download and version-list regressions. |
| Static demo | All 17 Chromium journeys passed; three additional path-favorite unit tests cover isolation, strict payloads and optimistic updates. |
| Frontend tooling | Typecheck, lint, listing presentation, production/demo builds, chunk-cycle and bundle-budget checks passed. Normal-build demo isolation passed. |
| Documentation | Strict MkDocs build passed. |
| Retired functionality | OpenAPI and model tests assert the removed routes, filters, session fields and generic preset columns are absent; source inspection finds no recovery worker, lock or database-open path. |

The combined Browser journeys cover favorites shared between two browser contexts,
rename/delete, original search options, normal overwrite, mixed ZIP bytes, CSV/JSON
search and navigation, 1440-pixel desktop and 390-pixel mobile in both themes,
a 26 MiB direct multipart upload, a proxy upload and original Copy/Cut/Paste.
The layout journey records screenshots and asserts no uncaught browser errors.

The ZIP browser journey uses the bounded Blob path because headless tests cannot
operate an OS save dialog. Focused tests exercise streaming completion, cancellation,
path collisions, overlapping selections, empty archives and memory limits. Preview
tests cover malformed/truncated content and pending-edit guards. Listing and access
tests cover pagination, sorting, exact keys and Portal identity boundaries.

For an already-running harness (example ports):

```sh
E2E_FRONTEND_BASE_URL=http://localhost:14289 E2E_BACKEND_PORT=18189 E2E_S3_ENDPOINT=http://127.0.0.1:15189 npx playwright test -c playwright.e2e.config.ts --project=chromium --no-deps e2e/browser/browser-evolutions.spec.ts
```

Use the [authenticated harness guide](authenticated-ui-ai-agents.md) to prepare
fixture identities. If the saved session expires, sign in again as the fixture
user and refresh the private storage-state file; do not repeat first-admin
bootstrap. An expired fixture session and one outdated test label were corrected
before recording the passing journeys above.

## Existing checks and qualification boundaries

`deadcode:check` reports no Browser issue. It still reports two existing unused
exports outside this scope: `localizedNativeValidationMessage` in
`components/ui/nativeValidation.ts` and `PortalRoleChangeRequestCreate` in
`api/portalRequests.ts`. Lint has one existing `validationNonce` dependency warning
in `OnboardingPage.tsx`. Neither check is weakened or given new exclusions.

No Ceph/RGW test endpoint or credentials were configured. Moto, component tests and
the static demo are not live Ceph qualification. The authenticated real-backend
journeys cover standalone Browser; embedded Manager, Ceph Admin and Portal rely
on their shared components, API/access tests and demo journeys. Native save dialogs
and physical browser termination remain manual environment checks. No background
transfer, resumable ZIP or upload recovery after closure is claimed.
