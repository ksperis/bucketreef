# Settings UI generalization

Status: **implemented for the seven agreed pages**. The compact profile and
shared selection controls were delivered first; the settings migration is a
separate local commit. See the [product contract](product-design-guidelines.md#compact-settings-with-section-titles-at-the-side)
and [theme tokens](ui-theme-guidelines.md#compact-settings-tokens).

## Delivered scope

| Page | Content / detail entry points |
| --- | --- |
| Admin General | Workspaces, services, quota alerts, branding; SMTP draft dialog and explicit test. |
| Admin Browser | Workspace availability, direct transfers, server relay, ZIP thresholds. |
| Admin Manager | Measurements, administrative access, bucket tools; migration limits dialog. |
| Admin Portal | Access and creation, personal keys, logging/history, new-space defaults; CORS dialog. |
| Admin Authentication | Access-key login, security policy, compact provider lists; dedicated OIDC/LDAP pages. |
| Admin Key Rotation | Endpoint and key-category selections, previous-key handling, confirmation and real results. |
| User Portal Settings | Project/access summary, capabilities, new-space defaults; effective origin and draft inheritance. |

- [x] Explicit compact layout, themed switches and 4px shared badges.
- [x] Shared controls, dialogs, dirty actions and close/navigation guards.
- [x] Page-owned configuration scopes, fresh-read merge and conflict detection.
- [x] Draft-only defaults and inheritance reset, numeric validation and failure retention.
- [x] Deferred Portal project selection and stale-response protection.
- [x] Retained API, secret, WebAuthn and authorization contracts.
- [x] Removed PortalSettingsLayout aliases and obsolete settings card helpers.
- [x] English-only Admin; FR/EN/DE user Portal and existing shared profile.

Targeted unit tests cover persistence, conflicts, dialogs, project switching,
provider secrets and rotation confirmation. Authenticated Admin/Browser smoke
checks live in `e2e/agent-ui`; `settingsVisualQa.spec.ts` exercises the Portal
settings in three languages, both themes and desktop/mobile using API fixtures.
Fixtures prove rendering and UI contracts, not successful Ceph operations.
Temporary captures, auth state and reports are excluded from commits.

## Portal settings coherence

- [x] Storage Space settings: Identity, File history, External tools and Space management.
- [x] Shared project override editor for Portal and the Admin RGW account Portal tab.
- [x] Independent identity/icon saves, guarded dialog drafts, current values for read-only users.
- [x] Draft-only inheritance reset preserving delegation, explicit field conflict reporting and fresh-read merges.
- [x] Scoped responses and history drafts retained during identity/icon refreshes.
- [x] English-only Admin and FR/EN/DE Portal; shared dimensions and themed controls.

The client cannot make the existing APIs atomic. Storage history retains the
server's existing preservation of foreign lifecycle rules and compensation on
partial S3 failure. It never retries an ambiguous update automatically.
The Admin API interprets delegation-only requests as preserving the current
override; an explicit empty reset together with delegation uses
`bucket_defaults: null`.

The fixture scenarios exercise both editors and their dialog/viewport behavior.
They do not constitute a successful real-Ceph validation. Temporary screenshots
and authentication state remain excluded from commits.

## Deferred scope

Other account tabs, bucket and workspace forms keep their existing default
presentation. Audit them separately before adoption; reuse the canonical
settings components without expanding permissions or changing storage
semantics. Converting the rest of the application's boolean controls and global
translation are separate decisions. Private S3 connection inventories retain
their existing table/editor behavior and translation scope.

The current full-configuration API has no atomic concurrency lock. The client
refuses conflicts present at its pre-save read; eliminating the residual race
would require a separate server concurrency contract.
