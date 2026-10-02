# Application error pages

`ErrorState` is the shared page-level error view. It uses the application theme,
shared buttons and disclosure, and three transparent octopus illustrations.
The copy catalog currently supplies English and French, with English fallback
for other interface languages. Do not insert raw exception text into its title
or description.

## Placement

| Situation | Presentation |
|---|---|
| Public unknown route, expired session, OIDC failure, invalid initial setup link | Full page with brand header |
| Session bootstrap failure or denial of an entire workspace | Full page; do not mount unauthorized navigation |
| Unknown route or rendering exception within an authorized workspace | Keep its sidebar, top bar and current URL |
| Missing resource or initial load failure that prevents opening a detail/editor page | Replace the content inside the workspace |
| Validation, failed save, individual transfer or table refresh | Keep the existing inline feedback and draft/rows |

`Layout` provides `WorkspaceErrorContext`. Every mounted workspace has a child
route boundary and wildcard beneath its layout. The root boundary also handles
layout failures. Runtime surface gates and backend permissions remain authoritative.

## Error families

`classifyApplicationError` maps structured HTTP/transport metadata to the
`errorCopy` catalog; it does not infer maintenance or link expiry from arbitrary
server prose. Pass explicit `kind` only when the caller knows that state.

| Family | Cases | Accent / illustration |
|---|---|---|
| Navigation | 404, 410, invalid or expired link | Muted / lost |
| Authentication | 401, ended session, failed sign-in | Blue / access |
| Access | 403, recent passkey verification, disabled or unsupported feature | Amber or muted / access |
| Availability | Unexpected exception/500, 502/503, 408/504, offline, maintenance | Rose, amber or muted / connection |
| Request constraints | 400/422, 409/412, 413, 429, 507 | Amber / lost or connection |

Use theme tokens for surfaces, text, borders and buttons. Keep orange reserved
for the brand. Color never replaces the written status. Images are decorative;
the title receives focus, controls remain keyboard accessible, and mobile places
the explanation and recovery action before the illustration.

## Recovery and diagnostics

- `onRetry` reloads read-only data. Without it the retry button reloads the page.
  Never wire it to a mutation: after a timeout, check the operation's state first.
- For 429 and 503, honor a valid `Retry-After` up to 24 hours. No automatic retry
  is scheduled. Return/navigation remains available during the countdown.
- Failed cookie refresh/bootstrap due to network or 5xx retains session state.
  Explicit 401/403/419 rejection clears it. Expired authenticated sessions reach
  `/session-expired`; a rejected retried request cannot retain a stale session.
- Keep the first-admin one-time token in memory when retrying its availability
  check; reloading would discard the already-cleared URL fragment.
- Technical details start collapsed. They contain only category, HTTP status,
  observation time and a constrained request reference. The copy button copies
  that same whitelist; no stack, request URL, response body or secret is included.

## Validation

From `frontend/`, run `npm run test:errors` for fixture-backed browser coverage
of both themes, full-page and six workspace 404s, mobile layout, diagnostics,
and session bootstrap recovery. Screenshots are saved in `test-results/`.
These fixtures verify frontend behavior, not live Ceph/S3 authorization.

Unit tests cover classification, safe diagnostics, accessibility, throttling,
session retention/rejection and route boundaries. Run the usual frontend checks
after changing this shared contract.
