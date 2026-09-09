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

## Deferred scope

Other account, bucket and workspace forms keep their existing default
presentation. Audit them separately before adoption; reuse the canonical
settings components without expanding permissions or changing storage
semantics. Converting the rest of the application's boolean controls and global
translation are separate decisions. Private S3 connection inventories retain
their existing table/editor behavior and translation scope.

The current full-configuration API has no atomic concurrency lock. The client
refuses conflicts present at its pre-save read; eliminating the residual race
would require a separate server concurrency contract.
