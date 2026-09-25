# API Reference

FastAPI exposes OpenAPI automatically.

Typical local endpoints:

- Swagger UI: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

Use route-level schemas and examples in code as the canonical API contract.

## Main route groups

| Prefix | Audience | Notes |
|---|---|---|
| `/api/auth` | login/session | Local, OIDC, LDAP, cookie refresh, `/session`, session revocation, WebAuthn, recovery codes, external-identity approval, plus Admin-runtime-only scoped API-token management. |
| `/api/admin` | platform admins | Users, groups, endpoints, app settings, billing, audit, metrics, and key rotation. |
| `/api/manager` | account/context admins | Buckets, IAM, topics, usage stats, migrations, and Manager tools. |
| `/api/portal` | Portal users/managers | Storage Spaces, files, shares, access keys, usage, governance activity, provider access logs, and settings. |
| `/api/browser` | object operators | Bucket/object browsing for the selected execution context. |
| `/api/ceph-admin` | Ceph admins | Endpoint-scoped RGW Admin Ops workflows. |
| `/api/storage-ops` | storage operators | Cross-context operational bucket views and actions. |
| `/api/internal` | schedulers/automation | Cron-only endpoints protected by `INTERNAL_CRON_TOKEN`. |

## First-administrator bootstrap

These routes are mounted only on an Admin runtime or on the dedicated
`ceph-admin-high-security` runtime. They are absent from the `user` runtime.

- `GET /api/auth/bootstrap/first-admin/status` returns only whether an issued,
  unexpired token can currently be consumed.
- `POST /api/auth/bootstrap/first-admin` requires the exact trusted `Origin`
  and `X-BucketReef-Bootstrap-Token`. Its strict body contains `email`, optional
  `full_name`, `password`, and `password_confirmation`.
- Success returns the existing `AuthenticationResponse` with
  `mfa_enrollment_required` and a five-minute pre-authentication cookie.
- Missing, expired, invalid and consumed tokens share the same unavailable
  response. The token must never appear in a query string, request/audit log,
  response body or browser storage.

## Guided administrator onboarding

`/api/admin/onboarding` follows the existing authenticated Admin boundary.
Progress and dismissal belong to the current administrator; another
administrator's journey identifier returns `404`. Configuration writes require
a platform superadministrator, and apply additionally uses the existing recent
WebAuthn sensitive-action guard. Apply requires an interactive UI session: an
`admin:write` API token cannot execute this guided storage configuration. The UI
reuses the shared passkey step-up dialog.

| Method and suffix | Behavior |
|---|---|
| `GET /api/admin/onboarding` | Local status and resumable version-2 journeys. It performs no remote storage check. |
| `POST /dismiss`, `POST /resume` | Hide or restore only this administrator's onboarding entry. General settings remains the explicit way to reopen it. |
| `POST /preview` | Strict, secret-free `OnboardingDraft`; returns feature changes, assignments, blockers and a deterministic `review_token`. No provisioning occurs. |
| `PUT /journeys/{uuid}` | Save `{draft, revision}`; omit revision on first creation. Unknown revisions and conflicting edits are rejected. |
| `POST /journeys/{uuid}/apply` | Requires `revision`, `confirmed: true`, the displayed `review_token` and write-only credentials required by the selected setup options. Revalidates endpoint capabilities, permissions and ENV locks, then checkpoints service operations. |

All suffixes in the table are relative to `/api/admin/onboarding` unless shown
in full. The version-2 draft contains only endpoint selection/options and the
five preparation booleans (`manager`, `portal`, `private_connection`,
`ceph_admin`, `supervision`). The strict draft stores no credential fields.
Apply accepts separate write-only `admin_access_key` / `admin_secret_key`,
Supervision Ops, Ceph Admin and private-S3 credentials. Existing complete
endpoint credentials are reused; newly submitted credentials are validated
before they enter the existing encrypted credential store. The onboarding API
no longer exposes the legacy `endpoint_access_key` / `endpoint_secret_key`
fields from the former first-step endpoint credential flow.

The onboarding and endpoint editor share
`POST /api/admin/storage-endpoints/detect-features` for live Ceph endpoint
validation. Setting `check_http: true` adds an `http_check` result
(`not_checked`, `valid` or `unavailable`) alongside the existing Admin Ops,
Account API, supervision and Ceph Admin capability/credential checks. This is a
read-only probe; it does not persist submitted credentials or feature flags.
Supervision validation requests bucket statistics with `stats=true` and a
summary-only RGW usage payload. `metrics=true` means bucket statistics are
retrievable. `usage=true` requires the usage response to contain actual values;
an empty response is treated as an unavailable usage-log capability and the UI
prompts the operator to verify `rgw_enable_usage_log` and recorded traffic.
Any HTTP response proves endpoint reachability, including an unauthenticated
`403`; only a connection/request failure is `unavailable`. A successful Admin
Ops identity lookup also returns `admin_ops_permissions`, resolved from the RGW
user caps. Guided Manager/Portal provisioning requires `users=read,write` and
`accounts=read,write`; `buckets=write` is reported separately and remains
optional for onboarding because it is needed only for delegated bucket quota
changes. Ceph Admin accepts a dedicated RGW identity with either the `admin` or
`system` flag.
Private S3 credentials use the existing Admin S3 credential-validation route
and remain independent from RGW administration identities.

An invalid request returns `422` with `detail.code = invalid_configuration`;
raw input values, including malformed credentials, are never echoed in validation
errors. `detail.code` gives sanitized errors, including
`env_locked:FEATURE_…`, `review_changed`, `stale_revision` and
`storage_access_denied`. `admin_ops_permissions_insufficient` identifies valid
Admin Ops credentials that are missing the RGW user/account caps required for
Manager/Portal provisioning. Partial setup retains checkpoints and requires a
fresh summary before changed choices can be applied.

`complete` means the newest version-2 journey is configured. If no current
journey exists, it may reflect the canonical initial-completion marker imported
by the database migration from a pre-v2 setup. Runtime code accepts only
version-2 journeys. Completed or dismissed onboarding is removed from the
normal Admin navigation; General settings remains the explicit re-entry point.

## Error contract

- `400` is returned when cookie and Bearer authentication are combined.
- `401` means the UI session or API token is missing, expired, or revoked.
- `403` means the authenticated identity lacks the route permission, CSRF/origin check, recent WebAuthn verification, or API-token scope.
- `404` may mean the resource does not exist or is intentionally hidden from the current scope.
- `409` is used for state conflicts or guarded destructive workflows.
- Storage-side denials preserve upstream semantics where possible, especially `AccessDenied`.

Do not infer storage permission from UI access. Native storage workflows still depend on the selected execution identity and S3/IAM decision.

## Authentication transport

UI authentication uses host-only cookies only. Login and refresh responses do
not contain an access token. `GET /api/auth/session` is the browser identity
contract, and mutating UI calls require both the exact configured `Origin` and
the session-bound `X-CSRF-Token`. Bearer authentication is reserved for scoped
API tokens; routes without an API-scope mapping reject it by default.

The security inventory is exposed through `/api/auth/sessions`,
`/api/auth/security/webauthn/credentials`, and
`/api/auth/security/external-identities`. Mutating personal security operations
require recent WebAuthn when a passkey is enrolled or required, and recent
primary authentication otherwise. Admins use `/api/admin/identity/sessions`
and `/api/admin/identity/link-requests` within their role hierarchy to revoke
sessions and decide manual federated-identity links. Reading these inventories,
reading user authentication details, listing API tokens, rejecting a link, and
revoking a session or token require an interactive Admin session without recent
WebAuthn. Approving a link or changing identity, authentication, credentials,
users, privileges, associations, or OIDC/LDAP providers requires recent
WebAuthn when the global Admin passkey policy is enabled. The backend compares
normalized persisted user and authentication-setting values before requiring
step-up, so unchanged payloads and full-name-only user updates remain free of
the prompt.

Direct identity routes reject Bearer tokens even when the Admin passkey policy
is disabled. No non-interactive identity-mutation exception is exposed.

`GET /api/admin/navigation/pending-requests` provides the lightweight Admin
navigation counters `identity_link_requests` and `portal_requests`. Identity
counts include only non-expired pending requests visible within the actor's
role hierarchy; Portal counts include only the exact `pending` status. The
aggregate exposes no request detail and does not require recent WebAuthn.

The personal notification center uses these endpoints:

- `GET /api/users/me/notifications` lists currently visible notifications.
- `DELETE /api/users/me/notifications/{notification_id}` removes one currently
  visible notification.
- `DELETE /api/users/me/notifications?read_only=true` removes all currently
  visible read notifications.

Both deletion routes return `{ deleted_count, unread_count }`; they never
delete another user's or a currently inaccessible notification. Notification
subjects include quota alerts, Identity Security requests, and endpoint health
transitions.

An authenticated UI user can renew recent WebAuthn verification without
creating a new session through
`POST /api/auth/security/webauthn/authentication/options` followed by
`POST /api/auth/security/webauthn/authentication/verify`. Both calls require the
normal trusted-origin and session-bound CSRF checks. The challenge is bound to
the current session, and the verify response contains the updated
`mfa_verified_at` timestamp.

## Audit and Portal access-log APIs

- `/api/admin/audit/logs` keeps the existing model and pagination contract but
  contains only control-plane and security events.
- `/api/portal/access-logs/page` and `/api/portal/access-logs/raw`
  expose provider Server Access Logging to Portal Managers. The page covers all
  S3 categories; there is no `mode` parameter.
- The page can filter by action, Storage Space, path, requester identity, and
  result. The former non-paginated `/api/portal/access-logs` route was removed.
- `/api/portal/transfers` and
  `/api/portal/transfers/server-access-logs*` were removed without aliases and
  return `404`.

Object operations are never inferred from the application audit API. Provider
logs may be delayed and are complete only when delivery and retention are
configured.

## Pagination and filters

List endpoints generally expose explicit filters in query parameters and return typed response models. Use the OpenAPI schema for the exact parameter names and response shape; use the frontend API modules as integration examples when a UI route already consumes the endpoint.

## Internal endpoints

Internal scheduler endpoints are not user APIs. They require the shared internal token and should stay behind trusted network controls.

`POST /api/internal/notifications/purge` deletes read and unread user
notifications older than `USER_NOTIFICATIONS_RETENTION_DAYS`, reports the
deleted row count, and is protected against concurrent runs by a database
operation lease. A retention value of `0` disables the purge.
