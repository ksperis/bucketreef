# Browser evolutions: implementation and validation

Implementation record for 28 September 2026, based on commit
`6f37a18ccbaf9f1c189e62ec95b9d5d4bac3880d`. Work is isolated on
`codex/browser-evolutions`; publication and production qualification are separate.
See the [user guide](../user/feature-objects-browser.md) for behavior and limits.

## Shared contracts

- The shared Browser drives standalone Browser, Manager, Ceph Admin and Portal.
  Existing workspace headers, context checks and Portal grants remain authoritative.
  Source and destination are checked separately.
- Listing filters and folder-marker enumeration are additive and participate in
  listing/cache signatures. Normal listings still hide empty-folder markers as files.
- Destination observations are checked again at write time. AWS conditional writes
  require the pinned boto3 1.43.103; other endpoints report non-atomic preflight.
  Conditions are never retried as unconditional replacement or deletion.
- Copy manifests deduplicate selections and include empty folders. Cross-context
  reads bind to the version/ETag; move retries preserve completed copy receipts.
- Migration `0135_browser_presets` stores only personal favorites/views, isolated by
  user and workspace with optimistic revisions. There is no upload tracking table.
- Multipart receipts and bounded batch history live in IndexedDB, without file
  content, credentials, presigned URLs or SSE-C keys. S3 sessions receive a
  domain-separated HMAC recovery reference; it grants no authority. Their empty
  API selector means the authenticated session, never an invented account.
- Demo mutations stay in its local store and preserve shared bucket/object state.

## Approved UX

Standalone Browser uses sidebar **Buckets / Favorites** tabs, grouped locations
and saved views, and a bucket/path/context subtitle. Embedded views keep a compact
favorites entry point. Scope and file filters are edited together inside advanced
search; its badge summarizes active options. The path bar is lighter, file/folder
icons have no decorative tile, display options are nested in **More > Display**,
and **Help and shortcuts** sits at the bottom of that menu.

Keyboard checks cover sidebar tabs, search focus return and opening/closing the
display submenu. Search remains accessible in the mobile list. Existing theme,
density, action primitives and administrative identity warnings are retained.

## Automated evidence

The authenticated harness uses an isolated backend, fresh application database and
Moto S3. It does not connect to production storage. Commands run from the appropriate
`frontend/` or `backend/` directory, with dependencies from this branch.

| Area | Evidence |
| --- | --- |
| Frontend contracts | 3,079 passing tests in the full Vitest suite, including recursive manifests, conflicts, conditional copy/move, filters, ZIP safety/memory limits, presets, previews, version comparison, multipart recovery and S3 session uploads. |
| Backend Browser/auth | 324 passing tests across `test_browser*.py`, `test_auth_session_flow.py` and `test_session_models.py`. |
| Portal/Manager identity | 41 passing tests across `test_portal_exact_object_identity.py`, `test_manager_browser_data_access.py` and `test_browser_recovery_identity.py` (overlaps the preceding group). |
| Migration | Fresh SQLite upgrade to head, downgrade to `0134_portal_collaborator_delegation`, then re-upgrade succeeded; existing tests cover user isolation and concurrent revision rejection. |
| Combined authenticated journeys | Six Chromium scenarios in `e2e/browser/browser-evolutions.spec.ts`. |
| Static demo | 17 Chromium scenarios across all retained workspaces; demo build and normal-build isolation check pass. |
| Frontend tooling | Typecheck, lint (one existing warning), shared listing checks, production build, chunk-cycle and bundle-budget checks. |
| Documentation | Strict MkDocs build passed; the Git-date plugin used the current timestamp for this new, not-yet-committed page. |

The combined journeys cover account-synchronized favorites in a second browser
context, a saved filtered view, filters without text, keyboard menus, both themes,
390-pixel mobile layout, explicit conflict resolution, Unicode rename, mixed ZIP
bytes, exact historical JSON preview/comparison and an unchanged current version.

Multipart scenarios use real workers, IndexedDB, Web Locks and Moto parts. A
26 MiB upload is paused after its first 8 MiB part and reloaded. Only parts 2–4
are sent on resume; the completed object's bytes are checked. The direct scenario
drives the transport module; the proxy scenario reselects a wrong then correct
file through the recovery dialog. A second tab cannot acquire the same upload
lock. History retention excludes expired batches and keeps 20 completed batches.

The ZIP scenario exercises the bounded Blob fallback because headless automation
cannot operate the operating system's save dialog. Streaming and cancellation
contracts are covered by focused tests.

To reproduce the new combined suite against an already-running authenticated
harness (ports are examples):

```sh
E2E_FRONTEND_BASE_URL=http://localhost:14173 E2E_BACKEND_PORT=18081 E2E_S3_ENDPOINT=http://127.0.0.1:15001 npx playwright test -c playwright.e2e.config.ts --project=chromium --no-deps e2e/browser/browser-evolutions.spec.ts
```

Use the [authenticated harness guide](authenticated-ui-ai-agents.md) to prepare
the runtime and fixture identities. Do not run first-admin bootstrap twice.

## Build size and pre-existing checks

With identical installed frontend dependencies, a separate build of the starting
HEAD contains 4,020,617 bytes of manifest-listed JavaScript; the implementation is
about 4,108,100 bytes, an increase of approximately 2.18%. The old 3,900 KiB total
budget already failed on that starting HEAD. The revised 4,050 KiB budget leaves
less than 1% margin over the measured implementation. Entry and largest-chunk limits
are unchanged. No new frontend package is added; the three Feather assets retain
their license.

`deadcode:check` still reports two existing unused exports:
`localizedNativeValidationMessage` in `components/ui/nativeValidation.ts` and
`PortalRoleChangeRequestCreate` in `api/portalRequests.ts`. Both are present at
the starting HEAD. Lint also retains the existing unnecessary `validationNonce`
dependency warning in `OnboardingPage.tsx`. These are outside the Browser changes.

## Qualification boundaries

No Ceph/RGW test endpoint or its test credentials were configured. Conditional
writes/deletes and large multipart server-side copies therefore still need
qualification against the deployed RGW version. Moto and mocked-provider tests
are not evidence of that compatibility.

The authenticated real-backend harness covers standalone Browser. Manager,
Ceph Admin and Portal use shared-component/API tests and the static demo journeys;
those do not prove a live Ceph IAM deployment. Backend access tests cover revoked
or different source/destination rights, while the local harness does not reproduce
a live permission revocation during an in-flight transfer.

Recovery is explicit and limited to multipart uploads. Web Lock support and
available local storage are required; clearing storage loses tracking. Native
save dialogs, physical browser process termination, storage eviction and a live
SSE-C provider remain manual environment checks. No claim of background transfer
after browser closure, resumable ZIP generation or resumable server-side copying
is made.
