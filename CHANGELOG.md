# Changelog

## 0.2.7 - 2026-09-23

### Added

- Added split Admin and user deployment profiles for Compose and Helm, plus a Ceph Admin high-security profile with a deliberately reduced runtime surface.
- Added Admin Production Readiness diagnostics, a reusable hardening checker, and operator documentation for security and deployment checks.
- Added shared multi-origin authentication support for split deployments, including OIDC login-state binding to the selected public redirect origin.

### Changed

- Refactored Manager bucket configuration features into dedicated views while preserving the existing S3 and IAM behavior.
- Hardened release qualification so prepared version metadata triggers a complete qualification and `release-preflight` verifies release credentials, synchronized GitHub/GitLab `main` refs, changelog/schema metadata, and public distribution prerequisites before tagging.
- Added an idempotent release-tag workflow that verifies the qualified `main` SHA and publishes the immutable tag to GitHub first and GitLab second.

### Fixed/Security

- Strengthened Admin privilege-boundary checks, production security evaluation, and validation of Portal IAM policy documents and storage-endpoint configuration.
- Deferred mandatory administrator passkey enforcement until production readiness while retaining explicit readiness diagnostics for deployments that require the stronger policy.
- Centralized deployment checks so startup-blocking failures and operator-visible readiness findings use the same evaluated security contracts.

### Upgrade notes

- Apply the normal Alembic upgrade path; migration `0129_oidc_login_state_redirect_uri` adds the public redirect URI to OIDC login state for multi-origin deployments.
- This patch release does not create a new schema baseline. Existing single-instance deployments may keep their current surface profile; the split and Ceph Admin high-security profiles are opt-in deployment choices.

### Tests

- Expanded runtime-surface, production-readiness, authentication, deployment-profile, Manager bucket feature, release-preflight, tagging, distribution, Compose, Helm, and documentation coverage.
- Release qualification validates the exact prepared SHA across the full autonomous suite, mandatory Ceph checks, multi-architecture images and scans, runtime/Kind checks, and public release prerequisites before publication.

## 0.2.6 - 2026-09-22

### Added

- Added a guided, resumable administrator onboarding flow with live endpoint capability and credential validation, explicit workspace access choices, and a review step before applying storage configuration.
- Added Portal project-setting change requests so delegated managers can request administrator-owned configuration changes without widening their platform permissions.
- Added explicit project controls for Portal-user external sharing and published the confirmed historical release index and release notes.

### Changed

- Simplified Portal navigation, storage-health summaries, Manager bucket feature workflows, profile connection tables, and shared top-bar controls.
- Canonicalized backend S3 account, user, endpoint, IAM, quota, billing, monitoring, topic, and onboarding identity resolution to remove redundant compatibility paths.
- Strengthened release qualification so final distribution reuses the exact tested multi-architecture images, scan receipts, chart, bundles, and public release artifacts for the qualified commit.

### Fixed/Security

- Preserved literal S3 object keys, prefixes, folder segments, version identities, and tag pairs across Browser, Portal, Manager, copy, multipart, deleted-object, and bucket-configuration workflows.
- Made SQLite schema upgrades safe with foreign-key enforcement, including recovery from interrupted Alembic batch-table rebuilds.
- Hardened RGW account-name validation, endpoint credential feedback, onboarding audit transitions, private-connection and association-role validation, and protection of unsaved configuration drafts.
- Started scheduled operational jobs in QuickStart by default and fixed multi-architecture CI digest handling plus narrowly reviewed historical secret-scan fixtures.

### Breaking changes

- The Admin onboarding draft/apply API now uses the version-2 contract; the former onboarding verify/attest endpoints were removed.
- The root `/profile` frontend alias was removed. Use the workspace-specific `/<workspace>/profile` route.

### Upgrade notes

- Apply the normal Alembic upgrade path; this release includes the Portal setting-change request migration and does not create a new schema baseline because `0.2.6` is a patch release.
- Clients or automation using the Admin onboarding API must migrate to the version-2 draft/apply contract before upgrading.
- Update bookmarks or integrations that still use `/profile` to the workspace-scoped profile route.

### Tests

- Expanded onboarding, Portal authorization/settings, endpoint, migration, literal-S3-identity, Browser/Manager configuration, QuickStart, CI, release-distribution, and documentation coverage.
- CI qualification validates AMD64 and ARM64 images, runtime checks, vulnerability scans, immutable digests, Ceph integration, Kind, release bundles, and Helm distribution before publication.

## 0.2.5 - 2026-09-20

### Added

- Added standalone QuickStart and Compose release bundles with SHA-256 checksums, version-pinned GHCR images, and an installer available at `https://bucketreef.ksperis.com/quickstart.sh`.
- Added AMD64 and ARM64 image builds, architecture-specific runtime checks, vulnerability reports and SBOMs, plus a public OCI Helm chart at `oci://ghcr.io/ksperis/charts/bucketreef`.
- Added automatic GitHub and GitLab releases sourced from this changelog, previous-version comparison links, and reproducible schema-reference snapshots for future `0.X.1` versions. This patch creates no schema baseline.
- Added Simplified Chinese translations for Portal and profile workflows.

### Changed

- Moved release deployments into `deploy/`; the root Compose now builds from source. The standalone QuickStart preserves its installed version, secrets and SQLite data across restarts.
- Unified Browser and Manager operation dialogs, bucket creation, rule inspection, IAM and SNS forms, and Portal history, invitation and external-tool workflows.
- Aligned Manager and Portal dashboard card heights and simplified the documentation theme. Documentation is now published through Cloudflare Pages.

### Fixed/Security

- Preserved literal object keys, version identifiers and tag values throughout bucket migrations and comparisons.
- Refused QuickStart key generation when an existing volume lacks its matching environment, retained verified backups before reset, and protected installed keys and ports from unrelated shell variables.
- Diagnosed read-only SQLite startup failures without incorrectly reporting database corruption.
- Kept Ceph functional-test WebAuthn sessions recent and restored full Git history for strict documentation builds.

### Upgrade notes

- The root `quickstart` and `docker-compose.build.yml` files have been removed. Developers use `docker compose build` and `docker compose up --build`; release users use QuickStart, the Compose bundle or the versioned OCI chart.
- Before migrating a source-checkout QuickStart, stop and back up its database and matching environment. Install with `--version 0.2.5 --no-start`, copy `.env.quickstart` with mode `0600`, and retain the existing `bucketreef-quickstart` project and volume. Follow the [migration guide](https://docs.bucketreef.ksperis.com/ops/quickstart/#migrate-a-source-checkout-quickstart); do not run reset during migration.
- Helm chart versions now follow the application version and images default to `appVersion`. This is the first OCI/bundle release; historical `0.2.4` artifacts are unchanged.
- No new database migration or baseline is introduced. Empty databases still use the current schema followed by `alembic stamp head`; existing databases retain their normal Alembic upgrade path.

### Tests

- Expanded installer, deployment, immutable-publication, changelog, schema-baseline and release-preparation coverage, including interrupted downloads/uploads and version-preserving retries.
- Added release gates for both image architectures, standalone bundle startup, Helm installation and upgrade, and anonymous chart download.

## 0.2.4 - 2026-09-11

### Added

- Added protected profile and settings drafts, recovery-code handoff outside the authenticated shell, and shared avatar, language, and notification editing for personal and Admin workflows.
- Added compact shared controls for settings, identity, S3 connection, RGW, IAM, bucket comparison, maintenance, inventory, and one-time-secret workflows.

### Changed

- Standardized compact dashboards, tables, filters, action menus, forms, dialogs, and responsive layouts across Admin, Manager, Ceph Admin, Portal, Browser, and Storage Ops.
- Routed long-running Manager bucket operations through resolved execution contexts and added migration `0124_canonical_manager_usage_scopes` to canonicalize persisted usage-snapshot scopes.
- Separated Ceph Admin bucket snapshots from response paging and consolidated cache, credential, tool-grant, and execution-context resolution contracts.

### Fixed/Security

- Preserved exact S3 object keys and literal prefixes across Browser reads, navigation, version listings, comparisons, and remediation without trimming valid whitespace or empty slash segments.
- Made cache invalidation race-safe, rejected incomplete endpoint and STS credentials, bounded credential caches and eager reads, and closed download bodies and long-running S3 clients on every exit.
- Preserved partial deletion outcomes, unsaved frontend edits, exact quota limits, narrow-list actions, profile navigation, and responsive dialog access.

### Breaking changes

- Object-column requests now require nonempty keys and columns, and exact version listings reject an empty key with HTTP 422. Omit the key to list by prefix; whitespace-only object keys remain valid.
- The frontend `/admin/accounts` alias has been removed. Update bookmarks to `/admin/s3-accounts`; backend endpoints under `/api/admin/accounts` are unchanged.
- Former `/portal/storage-spaces/:spaceId/objects/*` frontend URLs are no longer translated. Use `/portal/storage-spaces/:spaceId` with the `object` and `object_view` query parameters; backend object APIs are unchanged.

### Tests

- Expanded backend coverage for exact-key handling, execution-context attribution, migrations, deletion results, resource cleanup, cache concurrency, STS credentials, and Ceph Admin listings.
- Expanded frontend, browser, accessibility, documentation-screenshot, responsive-layout, protected-draft, settings, navigation, and shared-component validation.

## 0.2.3 - 2026-09-04

### Added

- Added authorized Admin navigation badges for pending identity and Portal access requests.
- Added scoped notifications for identity requests, endpoint health transitions, and quota alerts, with user deletion controls and daily 90-day retention scheduling.
- Added shared responsive detail drawers for Browser and Portal objects, paths, and bucket settings while preserving URL-backed Portal views.

### Changed

- Split RGW, authentication, Ceph Admin, Manager, Portal, Browser, bucket configuration, migration, and persisted-key rotation internals into narrower service and transport contracts.
- Refined Browser row density, content-type badges, selection, navigation, overflow actions, and contextual details across desktop and mobile layouts.
- Prioritized quota status on the Manager dashboard and made individual bucket quota controls depend on the Ceph Admin Ops `buckets=write` capability.

### Fixed/Security

- Kept direct signed transfers available when Portal identities cannot inspect bucket CORS, excluded `Content-Type` from presigned upload signatures, and required exposed `ETag` headers for multipart uploads.
- Preserved S3 provider error details for multipart failures and verified Browser uploads against Ceph RGW.
- Limited recent WebAuthn step-up prompts to sensitive Admin mutations while retaining session checks, retry protection, and defensive factor revocation.

### Breaking changes

- Removed the retired `POST /api/admin/automation/apply` endpoint and its generic Admin Automation request and response contracts.
- Removed redundant mutation endpoints for Admin registration, account unlinking, and standalone private-connection credential rotation; use the documented bootstrap and canonical update/delete workflows instead.
- Removed unused multipart-part listing, non-paginated Portal access-log, Portal request-detail, and Ceph endpoint-info read routes; clients must use the canonical paginated or provider-specific alternatives.

### Tests

- Expanded backend, frontend, deployment, notification, CORS, multipart, authorization, responsive drawer, API-removal, and documentation contract coverage.
- Retained CI validation for immutable SHA images, vulnerability and secret scans, Helm/Kind smoke tests, and the advisory Ceph functional suite.

## 0.2.2 - 2026-09-02

### Added

- Added an Admin Identity Security workspace for policy management, user-factor administration, active-session visibility, and guided last-passkey recovery.
- Added a global control for managed private S3 provisioning and an authenticated Admin/Browser harness for repeatable agent UI smoke tests.
- Added canonical full-name identity listings, richer session-type summaries, and primary-action navigation from shared data-table rows.

### Changed

- Split account access into independent Manager administrator and Portal roles across direct and group associations, execution contexts, automations, and Portal IAM synchronization.
- Hardened Compose and Helm workloads with fixed non-root identities, read-only root filesystems, a dedicated scheduler image, explicit resources, and fail-closed NetworkPolicies.
- Consolidated Portal models, bucket listings and comparisons, RGW parsing, Admin associations, streaming APIs, and shared frontend state into narrower reusable contracts.

### Fixed/Security

- Required explicit trusted-proxy CIDRs in production and prevented untrusted forwarded addresses from selecting rate-limit identities.
- Restricted user-controlled S3 endpoints and migration webhooks to configured host allowlists, sanitized external error logging, and prevented API tokens from exporting temporary STS credentials.
- Made bucket UI-tag cleanup transactional, made partial SQLite role migration recoverable, and stabilized Ceph listings, Browser selection, Manager row navigation, modal sizing, and table action columns.

### Breaking changes

- Migration `0122_split_account_access_roles` replaces association `role` and root flags with `manager_role` and `portal_role`. Deploy the migration, backend, frontend, and automation clients together; legacy role fields are rejected.
- Rootless images use fixed identities, the frontend container listens on port `8080`, and existing root-owned backend volume files may require a one-time ownership migration to UID/GID `10001:10001` after backup.
- Helm's strict NetworkPolicy profile now requires ingress/DNS selectors, explicit egress rules, and `backend.trustedProxyCidrs`; production startup rejects an empty trusted-proxy boundary.
- Production user-supplied S3 endpoints and migration webhooks now fail closed unless their hosts are covered by `USER_SUPPLIED_S3_ENDPOINT_ALLOWED_HOSTS` and `BUCKET_MIGRATION_WEBHOOK_ALLOWED_HOSTS`.

### Tests

- Expanded backend, frontend, migration, deployment-security, Helm, Compose, authenticated browser, and contract coverage for the new identity and access model.
- Retained CI validation for project naming, vulnerability and secret scans, immutable SHA images, rootless runtime smoke tests, and the advisory Ceph functional suite.

## 0.2.1 - 2026-08-28

### Added

- Added a secure first-administrator bootstrap flow with a short-lived setup URL, passkey enrollment, and a console-only fallback.
- Added persistent, scalable bucket UI tags with shared settings, accessible colors, visibility controls, bulk workflows, and listing integration across Ceph Admin and Storage Ops.
- Added in-session WebAuthn step-up and a Portal external-links tab for Storage Spaces.

### Changed

- Unified BucketReef branding, responsive density, bucket workbench filters, bulk actions, selection, navigation, and configuration workflows across the frontend.
- Canonicalized Storage Endpoint features, providers, URLs, and admin overrides through migrations `0115` to `0118`.
- Made Admin S3 connection credentials, user links, and remediation updates atomic through the canonical update contract.
- Consolidated backend routers, services, execution contexts, listings, Portal orchestration, migrations, and audit boundaries to remove duplicated runtime paths.

### Fixed/Security

- Ensured object previews always open, public links include their domain, and WebAuthn profile challenges are classified consistently.
- Improved fresh-database bootstrap and bucket UI tag performance while preserving scoped cleanup and assignment isolation.
- Hardened first-admin creation, private connection deletion, IAM removals, bucket configuration removal, and destructive migration confirmations.

### Breaking changes

- Removed automatic `SEED_SUPER_ADMIN_*` startup seeding. New deployments must issue a one-time bootstrap URL or use the first-admin CLI.
- Storage Endpoint inputs must use canonical `features` and `healthcheck_url` fields; `admin_endpoint` is removed, and migration `0118` rejects empty or canonically colliding URLs.
- Removed dedicated Admin S3 connection credentials, user-link, and remediation routes. Clients must send `credentials`, `user_ids`, and `remediation_action` through the canonical update endpoint.
- Bucket UI tag definition names are globally unique case-insensitively; catalogue responses no longer embed assignments, and orphan-inventory routes are removed.
- Execution-context catalogues no longer expose the unused quota and entity-limit fields.

### Tests

- Expanded backend, frontend, migration, OpenAPI, audit, accessibility, browser E2E, quickstart, Helm, Kind, Compose, and strict documentation validation.
- Stabilized asynchronous frontend actions and CI startup for PostgreSQL, Ceph, and Docker-in-Docker Kind validation.

## 0.2.0 - 2026-08-19

### Added

- Added a dedicated BucketReef upgrade runbook covering backups, key preservation, storage identities, Portal logs, Compose data, and Helm releases.
- Added CI naming enforcement for tracked paths and contents, with documented exemptions for the upgrade mapping and historical audit evidence.
- Added Helm lint and template validation to the CI test stage.

### Changed

- Adopted `BucketReef - S3-compatible object storage management` across the UI, API metadata, documentation, packages, repositories, images, Compose, and Helm contracts.
- Replaced the withdrawn pre-release branding and artifacts before republishing `v0.2.0`.
- Renamed JWT, browser coordination, scheduler, temporary-file, policy SID, Ceph, IAM, and S3 identifiers to the BucketReef namespaces.
- Regenerated the 72 active documentation captures and moved the public documentation links to the BucketReef GitHub Pages path.

### Breaking changes

- Existing UI sessions and API tokens are invalid because the JWT issuer and audiences changed; users must sign in again and API tokens must be reissued.
- Deployments must migrate to `BUCKETREEF_*` variables, BucketReef image and chart names, and `bkr-*` managed storage identities without runtime compatibility aliases.
- Compose deployments must migrate persisted data into the explicit `bucketreef` project, while Helm deployments require a new `bucketreef` release with restored or reattached data and secrets.

### Tests

- Passed the complete backend and frontend suites, production build, package budgets, Compose rendering, naming audit, screenshot generation, visual workspace checks, and strict documentation build.

## 0.1.11 - 2026-07-26

### Added

- Added anonymous LDAP directory searches with optional bind credentials and compatibility support for legacy TLS servers.
- Added unified Admin workflows for associating users, accounts, connections, and S3 identities.
- Added a consolidated Portal history experience combining activity and transfer records.

### Changed

- Standardized page layouts, breadcrumbs, tabs, list actions, and identity editing workflows across Admin, Portal, and Browser workspaces.
- Refined Portal Storage Space indicators, traffic labels, and navigation while keeping technical identifiers available where useful.
- Protected environment-managed storage endpoint credentials from database-only key rotation.

### Fixed/Security

- Filtered workspaces using effective access so inherited authorization is honored without exposing unauthorized workspaces.
- Propagated path-style endpoint configuration to Cyberduck bookmarks and improved compatibility with legacy LDAP TLS servers.
- Preserved initial bucket pagination and stabilized asynchronous identity listings, endpoint summaries, and related frontend interactions.

### Tests

- Expanded frontend coverage for S3 identity workflows, effective workspace access, bucket pagination, and asynchronous Admin listings.
- Stabilized CI-facing frontend validation for delayed API responses and persisted pagination state.

## 0.1.10 - 2026-07-22

### Added

- Added Portal collaboration workflows for reviewed access requests, external IAM credentials, public links, server access logging, history cleanup, and permanent Storage Space deletion.
- Added Ceph Admin operations with unified long-running bucket actions, richer endpoint health information, and routed bucket detail navigation.
- Added multi-backend coordination, identity avatars, quota notifications, and more explicit storage health signals.

### Changed

- Made Portal Storage Space metadata and grants authoritative, with private ownership, Viewer/Editor team grants, and consistent project-manager access.
- Standardized frontend tables, forms, filters, feedback, profile settings, navigation, and responsive behavior across the application workspaces.
- Hardened storage endpoint handling and long-running operation behavior while simplifying backend compatibility paths and shared service boundaries.

### Fixed/Security

- Restricted Portal access history to managers and refined external access, member request, and public-link cleanup behavior.
- Restored Manager bucket metrics access and improved resilience when storage endpoints or asynchronous UI data are temporarily unavailable.
- Kept Ceph functional test failures visible but advisory so intermittent lab failures no longer block immutable image builds.

### Breaking changes

- Migration `0066_portal_storage_space_access_model` removes legacy Portal Storage Space database and IAM state. Existing spaces must be recreated or re-imported after upgrading.

### Tests

- Expanded backend, frontend, migration, multi-backend, Portal, Storage Ops, and Ceph Admin coverage, including functional Ceph lifecycle scenarios.
- Stabilized asynchronous frontend and Ceph-dependent validation while retaining JUnit reports and CI artifacts for advisory Ceph failures.

## 0.1.9 - 2026-06-26

### Added

- Added UI group editing on storage targets and surfaced UI group access in storage listings.
- Added bucket purge workflows for Manager, Storage Ops, and Ceph Admin with streamed progress and audit-aware backend services.
- Added Browser workspace sidebar, folder navigation helpers, route/access matrices, and profile/runtime diagnostics coverage.

### Changed

- Refactored Browser, Portal, bucket migration, router dependencies, and shared frontend primitives into smaller service and UI modules.
- Refined Portal and Manager workspace UX, dashboards, KPI wrapping, breadcrumb behavior, and localized Portal copy.
- Updated user and operations documentation, screenshot assets, feature availability pages, and safe destructive operation guidance.

### Fixed/Security

- Restored core workspace kill switches after the settings refactor and hardened sensitive runtime error redaction.
- Improved Manager bucket deletion and purge-delete labeling while keeping empty-bucket deletion on the standard confirmation path.
- Softened Browser listing access errors and kept folder tools available behind the intended advanced-mode gates.

### Tests

- Added backend and frontend coverage for purge routes/services, dependency facades, Portal mappers, workspace routing, shared UI controls, and CI stability.
- Stabilized Ceph Admin quota persistence, frontend interaction tests, and login page theme-provider coverage.

## 0.1.8 - 2026-06-16

### Added

- Added Portal user access key management, storage-space browser access by default, dashboard usage signals, manager-aligned KPIs, and a complete usage analytics page.
- Added privileged target grants for Ceph actions, including admin configuration support and restored Storage Ops privileged bucket quota management.
- Added Manager feature-rule inventory, bucket-tag inventory, listing summaries, audit detail filters, and head-only bucket integrity checks.
- Added bucket usage analytics and deterministic bucket comparison output.

### Changed

- Organized usage metrics pages into tabs and shared more frontend table sorting, UI access modal, theme, and browser operations layout behavior.
- Refined Portal and Manager dashboard visuals, bucket quick filters, advanced-filter panels, and UI group association summaries.
- Kept Manager bucket quota mutation out of the Manager surface while preserving privileged quota workflows through Storage Ops.

### Fixed/Security

- Hardened backend token verification, redacted feature-inventory failures, and purged dependent operational data when deleting resources.
- Fixed Portal dark theme text colors, Portal top storage-space limits, browser queued-work panel state, browser operations action labels, and bucket column reset behavior.
- Fixed Manager dashboard data type chart color alignment, activity and incident card layout, and quiet handling of data type failures.
- Allowed UI admins to configure target grants and removed the inactive global search button.

### Performance

- Reduced duplicate Ceph Admin bucket-listing RGW calls with shared in-flight/cache reuse.

### Docs/Tests

- Documented Browser disablement options and updated release Helm examples for `0.1.8`.
- Stabilized local test suites, added Portal storage-space naming-mode coverage, prepared Ceph logging target policy setup, and aligned Ceph usage stats functional route coverage.

## 0.1.7 - 2026-05-13

> Historical notes reconstructed from Git history; potentially incomplete.
> Date source: commit date.

### Changes

- Added managed S3 user contexts in Storage Ops and AWS endpoint presets with regional defaults.
- Added bucket integrity checks, comparison result downloads and key-copy actions, and listing-cache refresh controls.
- Refined endpoint forms, bucket configuration and replication capability checks, and expanded Ceph replication tests.

## 0.1.6 - 2026-04-27

> Historical notes reconstructed from Git history; potentially incomplete.
> Date source: commit date.

### Changes

- Hardened SQLite handling and bucket migration, and added cross-context Browser clipboard transfers.
- Added browser end-to-end tests and expanded Ceph functional coverage.
- Introduced resizable navigation panels, configurable object columns and unified object details.
- Improved quota filters, partial quota updates, RGW usage accounting and special-character object-key handling; hardened user-supplied S3 endpoints.

## 0.1.5 - 2026-04-05

> Historical notes reconstructed from Git history; potentially incomplete.
> Date source: commit date.

### Changes

- Moved validated image publication to GitLab CI and added vulnerability scans and blocking backend tests.
- Published JUnit reports, corrected frontend quality checks and improved deployment documentation.
- Fixed Admin account listings when no default endpoint is available.

## 0.1.4 - 2026-03-29

> Historical notes reconstructed from Git history; potentially incomplete.
> Date source: tag date.

### Changes

- Added billing, endpoint health checks, API tokens, Ceph Admin and Storage Ops workflows.
- Expanded bucket filtering, comparison, migration, quota monitoring and usage history; improved object search, multipart uploads and browser navigation.
- Introduced shared resource tags and refined connection, IAM and workspace controls.
- Reworked documentation and automated screenshots. Portal functionality was temporarily removed during this development period.

## 0.1.3 - 2026-02-02

> Historical notes reconstructed from Git history; potentially incomplete.
> Date source: commit date.

### Changes

- Introduced S3 Connections and a shared execution context for Manager and Browser.
- Expanded Portal management and object operations, including streaming ZIP downloads and SNS topics.
- Added onboarding and documentation, refresh-token cookies with rotation, and separate encryption-key handling with key-rotation work.

## 0.1.2 - 2026-01-09

> Historical notes reconstructed from Git history; potentially incomplete.
> Date source: commit date.

### Changes

- Reworked endpoint configuration, account and S3 user management, and user quota handling.
- Added S3 user metrics and Admin dashboard statistics; refined Browser actions and Portal refresh behavior.
- Adjusted Alembic initialization, application settings persistence and Docker image version configuration.

## 0.1.1 - 2026-01-06

> Historical notes reconstructed from Git history; potentially incomplete.
> Date source: commit date.

### Changes

- Corrected the GitHub Actions workflow used by the initial release.

## 0.1.0 - 2026-01-06

> Historical notes reconstructed from Git history; potentially incomplete.
> Date source: commit date.

### Changes

- Initial tagged version, before the BucketReef rename.
- Added Docker Compose deployment, a Helm chart and GHCR image publication.
