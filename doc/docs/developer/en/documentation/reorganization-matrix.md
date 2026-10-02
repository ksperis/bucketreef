# Documentation Reorganization Migration Matrix

This page is the source of truth for the documentation reorganization. It
records the original page inventory, the canonical guide destinations, and the
migration action applied to each page.

The target structure is guide- and language-scoped:

```text
doc/docs/
├── admin/en/
├── developer/en/
├── manager/en/
├── portal/en/
└── browser/en/
```

`index.md` and the generated `releases.md` remain global pages. They do not
form a sixth guide and must not be included in a guide-scoped search index.

No compatibility redirects are kept for the former `user/`, `ops/`, or
unscoped `developer/` public URLs. Links use the new canonical paths directly.

## Action definitions

- **Move**: the audience and substance already match the target. Adjust links,
  titles, screenshots, and terminology only as required by the new location.
- **Rewrite**: keep one target topic but substantially refocus the page for its
  new audience or guide role.
- **Split**: extract the source into two or more audience-specific pages. The
  old mixed page disappears at cutover.
- **Remove**: delete obsolete content with no successor. The audit below does
  not currently classify any page as Remove; even the pre-0.2 explicit cutover
  runbook remains useful operator history.

## Global pages

| Current page | Future source path(s) | Action | Migration intent |
|---|---|---|---|
| `index.md` | `index.md` | **Rewrite** | Replace the current mixed-audience home with the guide selector and short guide promises. |
| `releases.md` | `releases.md` | **Move** | Keep the generated project-wide release history as a global reference outside guide search indexes. |

## Current User Guide

| Current page | Future source path(s) | Action | Migration intent |
|---|---|---|---|
| `user/admin-access-audit.md` | `admin/en/platform/access-audit.md` | **Move** | Admin-only governance workflow. |
| `user/admin-audit.md` | `admin/en/platform/audit.md` | **Move** | Admin control-plane audit belongs to platform administration. |
| `user/admin-runbook-storage-admin.md` | `admin/en/getting-started/storage-admin-runbook.md` | **Rewrite** | Keep the handover workflow but remove Manager/Browser detail that belongs to their guides. |
| `user/common-tasks-storage-admin.md` | `admin/en/getting-started/common-tasks.md`<br>`manager/en/getting-started/common-tasks.md` | **Split** | Separate platform/storage administration tasks from account-level Manager tasks. |
| `user/common-tasks-storage-user.md` | `portal/en/getting-started/common-tasks.md`<br>`browser/en/getting-started/common-tasks.md`<br>`manager/en/getting-started/common-tasks.md` | **Split** | Replace workspace selection guidance with task maps inside each relevant guide. |
| `user/feature-admin-metrics.md` | `admin/en/platform/usage-metrics.md` | **Move** | Admin usage and metrics surface. |
| `user/feature-availability.md` | `admin/en/help/feature-availability.md`<br>`manager/en/help/feature-availability.md`<br>`portal/en/help/feature-availability.md`<br>`browser/en/help/feature-availability.md` | **Split** | Each guide explains only the flags, capabilities and permissions visible to its audience. |
| `user/feature-billing-admin.md` | `admin/en/platform/billing.md` | **Move** | Admin billing surface. |
| `user/feature-bucket-compare.md` | `manager/en/tools/bucket-compare.md` | **Move** | Manager account-level tool. |
| `user/feature-bucket-integrity-check.md` | `manager/en/tools/bucket-integrity.md` | **Move** | Manager account-level tool. |
| `user/feature-bucket-migration.md` | `manager/en/tools/bucket-migration.md` | **Move** | Manager account-level migration workflow. |
| `user/feature-bucket-purge.md` | `manager/en/tools/bucket-purge.md`<br>`admin/en/storage/bucket-purge.md` | **Split** | Manager purge and Ceph Admin/Storage Ops purge need context-specific prerequisites and safety guidance. |
| `user/feature-bucket-usage-stats.md` | `manager/en/buckets/usage.md`<br>`admin/en/storage/bucket-usage.md` | **Split** | Separate Manager account metrics from Ceph Admin storage-wide metrics. |
| `user/feature-buckets.md` | `manager/en/buckets/index.md` | **Rewrite** | Retain bucket workflows while making Manager the explicit audience and context. |
| `user/feature-endpoint-status-admin.md` | `admin/en/platform/endpoint-status.md` | **Move** | Admin endpoint-health surface. |
| `user/feature-iam.md` | `manager/en/iam/index.md` | **Move** | Manager S3/IAM administration. |
| `user/feature-key-rotation-admin.md` | `admin/en/platform/key-rotation.md` | **Move** | Admin-managed storage credential rotation. |
| `user/feature-manager-ceph-keys.md` | `manager/en/iam/access-keys.md` | **Move** | Manager delegated Ceph RGW S3-user keys. |
| `user/feature-object-versions-browser.md` | `browser/en/objects/versions.md`<br>`manager/en/browser/versions.md`<br>`portal/en/files/versions.md`<br>`admin/en/storage/browser-versions.md` | **Split** | Document versions in the host experience; keep Browser as the complete standalone reference. |
| `user/feature-objects-browser.md` | `browser/en/objects/operations.md`<br>`manager/en/browser/object-operations.md`<br>`portal/en/files/index.md`<br>`admin/en/storage/browser-operations.md` | **Split** | Shared Browser code appears in several workspaces, but help must follow the host workspace. |
| `user/feature-topics.md` | `manager/en/topics.md` | **Move** | Manager SNS topic administration. |
| `user/feature-usage-history-admin.md` | `admin/en/platform/usage-history.md` | **Move** | Admin usage-history surface. |
| `user/glossary.md` | `admin/en/reference/glossary.md`<br>`manager/en/reference/glossary.md`<br>`portal/en/reference/glossary.md`<br>`browser/en/reference/glossary.md` | **Split** | Use audience-specific vocabulary so search results do not introduce unrelated internal concepts. |
| `user/howto-ceph-advanced-filter.md` | `admin/en/storage/ceph-admin/advanced-filter.md` | **Move** | Ceph Admin belongs to the Administration guide. |
| `user/howto-ceph-ui-tags.md` | `admin/en/storage/ceph-admin/ui-tags.md` | **Move** | Ceph Admin belongs to the Administration guide. |
| `user/howto-manager-bucket-configuration.md` | `manager/en/buckets/configuration.md` | **Move** | Manager bucket configuration workflow. |
| `user/howto-storage-ops-ui-tags.md` | `admin/en/storage/storage-ops/ui-tags.md` | **Move** | Storage Ops belongs to the Administration guide. |
| `user/index.md` | `admin/en/index.md`<br>`manager/en/index.md`<br>`portal/en/index.md`<br>`browser/en/index.md` | **Split** | Retire the generic User Guide landing page in favor of audience-specific guide homes. |
| `user/portal-access-keys.md` | `portal/en/external-tools.md` | **Rewrite** | Keep S3 terminology only where needed to configure an external tool; remove implementation detail. |
| `user/portal-activity.md` | `portal/en/activity.md` | **Rewrite** | Keep the user-visible history and access-log workflow with end-user language. |
| `user/portal-files.md` | `portal/en/files/index.md` | **Rewrite** | Make this the primary simple file workflow without requiring Browser documentation. |
| `user/portal-requests.md` | `portal/en/help-requests.md` | **Rewrite** | Keep the request lifecycle but present it as end-user help. |
| `user/portal-settings.md` | `portal/en/settings.md` | **Rewrite** | Keep only settings the Portal user or Portal Manager can understand and act on. |
| `user/portal-sharing.md` | `portal/en/collaboration.md`<br>`admin/en/platform/portal-delegation.md` | **Split** | Portal keeps collaborator tasks; Admin receives delegation flags and approval mechanics. |
| `user/portal-storage-spaces.md` | `portal/en/spaces/index.md` | **Rewrite** | Simplify Storage Space lifecycle around user goals and roles. |
| `user/portal-usage-alerts.md` | `portal/en/storage-health.md` | **Rewrite** | Present capacity and alerts without operator collection internals. |
| `user/profile.md` | `admin/en/profile.md`<br>`manager/en/profile.md`<br>`portal/en/profile.md`<br>`browser/en/profile.md` | **Split** | Profile is rendered in the active workspace; each guide should describe relevant tabs and links in that context. |
| `user/safe-destructive-operations.md` | `admin/en/storage/safe-operations.md`<br>`manager/en/reference/safe-operations.md`<br>`portal/en/files/safe-deletion.md`<br>`browser/en/reference/safe-operations.md` | **Split** | Confirmation and recovery semantics differ between platform, Manager, Portal and standalone Browser operations. |
| `user/screenshots-gallery.md` | `developer/en/documentation/screenshots-gallery.md` | **Move** | Treat the all-workspace gallery as a documentation-maintenance reference rather than end-user navigation. |
| `user/start-here.md` | `index.md`<br>`admin/en/getting-started/index.md`<br>`manager/en/getting-started/index.md`<br>`portal/en/getting-started/index.md`<br>`browser/en/getting-started/index.md` | **Split** | The root selects a guide; each guide then owns its own first-use path. |
| `user/troubleshooting.md` | `admin/en/help/troubleshooting.md`<br>`manager/en/help/troubleshooting.md`<br>`portal/en/help/troubleshooting.md`<br>`browser/en/help/troubleshooting.md` | **Split** | Diagnostics and escalation instructions must stay inside the current audience and workspace. |
| `user/use-cases-storage-admin.md` | `admin/en/getting-started/use-cases.md`<br>`manager/en/getting-started/use-cases.md` | **Split** | Separate platform/storage-operator use cases from Manager account-administration use cases. |
| `user/use-cases-storage-user.md` | `portal/en/getting-started/use-cases.md`<br>`browser/en/getting-started/use-cases.md`<br>`manager/en/getting-started/use-cases.md` | **Split** | Replace the generic storage-user persona with workspace-specific outcomes. |
| `user/workspace-admin.md` | `admin/en/platform/index.md` | **Rewrite** | Make Admin UI one section inside the broader Administration guide. |
| `user/workspace-browser.md` | `browser/en/index.md` | **Rewrite** | Become the standalone Browser guide home. |
| `user/workspace-ceph-admin.md` | `admin/en/storage/ceph-admin/index.md` | **Rewrite** | Ceph Admin becomes an Administration storage section. |
| `user/workspace-manager.md` | `manager/en/index.md` | **Rewrite** | Become the Manager guide home and distinguish Manager from portal_manager. |
| `user/workspace-portal.md` | `portal/en/index.md` | **Rewrite** | Become the simplified Portal guide home. |
| `user/workspace-storage-ops.md` | `admin/en/storage/storage-ops/index.md` | **Rewrite** | Storage Ops becomes an Administration storage section. |

## Current Ops / Sysadmin Guide

| Current page | Future source path(s) | Action | Migration intent |
|---|---|---|---|
| `ops/authentication-hardening.md` | `admin/en/security/authentication.md` | **Move** | Deployment authentication security belongs to Administration. |
| `ops/backends-ceph-rgw.md` | `admin/en/storage/backends/ceph-rgw.md` | **Move** | Storage backend administration. |
| `ops/backends-compatibility.md` | `admin/en/storage/backends/compatibility.md` | **Move** | Backend compatibility is an administrator deployment decision. |
| `ops/backends-others.md` | `admin/en/storage/backends/other-s3.md` | **Move** | Storage backend administration. |
| `ops/backup-restore.md` | `admin/en/operations/backup-restore.md` | **Move** | Day-2 operations. |
| `ops/ceph-admin-high-security.md` | `admin/en/security/ceph-admin.md` | **Move** | Ceph Admin deployment/security belongs to Administration. |
| `ops/configuration.md` | `admin/en/configuration/index.md` | **Rewrite** | Keep operator configuration here and move end-user feature explanations into their guide-specific availability pages. |
| `ops/deploy-docker-compose.md` | `admin/en/install/docker-compose.md` | **Move** | Installation and deployment. |
| `ops/deploy-helm.md` | `admin/en/install/helm.md` | **Move** | Installation and deployment. |
| `ops/deployment-architecture.md` | `admin/en/install/production-architecture.md` | **Move** | Production deployment architecture. |
| `ops/index.md` | `admin/en/index.md` | **Rewrite** | Merge the Ops landing page with the new Administration guide home. |
| `ops/operations-api-tokens.md` | `admin/en/security/api-tokens.md` | **Move** | Administrative automation tokens and operational security. |
| `ops/operations-billing.md` | `admin/en/operations/billing.md` | **Move** | Billing operations and collection. |
| `ops/operations-healthchecks.md` | `admin/en/operations/healthchecks.md` | **Move** | Endpoint health operations. |
| `ops/operations-observability.md` | `admin/en/operations/observability.md` | **Move** | Operator troubleshooting and observability. |
| `ops/operations-quota-monitoring.md` | `admin/en/operations/quota-monitoring.md` | **Move** | Quota collection and monitoring operations. |
| `ops/operations-security.md` | `admin/en/security/index.md` | **Rewrite** | Become the Administration security overview and link to focused security topics. |
| `ops/operations-upgrade-compatibility.md` | `admin/en/operations/upgrade-compatibility.md` | **Move** | Day-2 upgrade operations. |
| `ops/operations-webhooks.md` | `admin/en/operations/webhooks.md` | **Move** | Administrative integration operations. |
| `ops/production-checks-reference.md` | `admin/en/operations/production-checks.md` | **Move** | Production readiness reference. |
| `ops/production-readiness.md` | `admin/en/operations/production-readiness.md` | **Move** | Production rollout checklist. |
| `ops/quickstart.md` | `admin/en/install/quickstart.md` | **Move** | Local installation/evaluation remains an administrator entry point. |
| `ops/sysadmin-onboarding.md` | `admin/en/getting-started/sysadmin-onboarding.md` | **Move** | Operator onboarding becomes part of Administration. |
| `ops/upgrade-to-bucketreef.md` | `admin/en/operations/upgrade-from-pre-0.2.md` | **Move** | Retain the explicit pre-0.2 rename/cutover runbook as historical operator guidance; URL compatibility is not retained. |

## Current Developer Guide

| Current page | Future source path(s) | Action | Migration intent |
|---|---|---|---|
| `developer/ai-assistant-guidelines.md` | `developer/en/contributing/ai-assistant-guidelines.md` | **Move** | Contributor guardrails. |
| `developer/api-reference.md` | `developer/en/reference/api.md` | **Move** | BucketReef API integration/reference. |
| `developer/architecture-backend.md` | `developer/en/architecture/backend.md` | **Move** | Developer architecture. |
| `developer/architecture-database.md` | `developer/en/architecture/database.md` | **Move** | Developer architecture. |
| `developer/architecture-frontend.md` | `developer/en/architecture/frontend.md` | **Move** | Developer architecture. |
| `developer/architecture-overview.md` | `developer/en/architecture/index.md` | **Move** | Developer architecture overview. |
| `developer/audit-boundary.md` | `developer/en/architecture/audit-boundary.md` | **Move** | Implementation contract for control-plane vs data-plane audit. |
| `developer/authenticated-ui-ai-agents.md` | `developer/en/testing/authenticated-ui-ai-agents.md` | **Move** | Developer/testing workflow. |
| `developer/browser-evolutions-validation.md` | `developer/en/records/browser-evolutions-validation.md` | **Move** | Implementation/validation record, not Browser end-user documentation. |
| `developer/ci-cd.md` | `developer/en/contributing/ci-cd.md` | **Move** | Contributor CI/CD workflow. |
| `developer/contributing.md` | `developer/en/contributing/index.md` | **Move** | Contributor guide. |
| `developer/docs-maintenance.md` | `developer/en/documentation/maintenance.md` | **Rewrite** | Update the maintenance contract for five builds, guide-scoped search, language paths and guide-specific screenshots. |
| `developer/error-pages.md` | `developer/en/frontend/error-pages.md` | **Move** | Frontend implementation guidance. |
| `developer/first-contribution.md` | `developer/en/contributing/first-contribution.md` | **Move** | Contributor onboarding. |
| `developer/identity-and-execution-model.md` | `developer/en/architecture/identity-and-execution.md` | **Move** | Developer architecture contract. |
| `developer/index.md` | `developer/en/index.md` | **Rewrite** | Become the Development and Contribution guide home. |
| `developer/interface-convergence.md` | `developer/en/records/interface-convergence.md` | **Move** | Implementation record. |
| `developer/listing-presentation-inventory.md` | `developer/en/records/listing-presentation-inventory.md` | **Move** | Implementation inventory. |
| `developer/listings-feature-matrix.md` | `developer/en/reference/listings-feature-matrix.md` | **Move** | Developer reference. |
| `developer/local-development.md` | `developer/en/contributing/local-development.md` | **Move** | Local contributor setup. |
| `developer/principles.md` | `developer/en/architecture/principles.md` | **Move** | Core design/architecture principles. |
| `developer/product-design-guidelines.md` | `developer/en/frontend/product-design.md` | **Move** | Frontend/product implementation guidance. |
| `developer/releases.md` | `developer/en/contributing/releases.md` | **Move** | Release engineering process, distinct from the global generated release history. |
| `developer/repo-layout.md` | `developer/en/reference/repository-layout.md` | **Move** | Developer reference. |
| `developer/settings-ui-follow-up.md` | `developer/en/records/settings-ui-follow-up.md` | **Move** | Implementation record. |
| `developer/static-demo.md` | `developer/en/testing/static-demo.md` | **Move** | Developer/test/demo workflow. |
| `developer/ui-theme-guidelines.md` | `developer/en/frontend/ui-theme.md` | **Move** | Frontend implementation guidance. |
| `developer/workspace-surface-separation.md` | `developer/en/architecture/workspace-surfaces.md` | **Move** | Developer surface contract. |
| `developer/documentation-reorganization-matrix.md` | `developer/en/documentation/reorganization-matrix.md` | **Move** | Move this migration source of truth with the Developer documentation during the cutover. |

## Cutover invariants

- `Admin`, `Ceph Admin`, `Storage Ops`, deployment, security, and day-2
  operations converge in **Administration**.
- **Manager** documents account-scoped S3 and IAM administration. A
  `portal_manager` remains a Portal role and is never documented as Manager
  workspace access.
- **Portal** remains task-oriented and end-user focused. Implementation details,
  feature-flag diagnosis, and operator configuration move to Administration.
- **Browser** is the complete standalone object-operation reference. When the
  Browser renderer is embedded in Portal, Manager, or Ceph Admin, help content
  is rewritten for that host guide instead of sending users to an unrelated
  search context.
- Cross-guide source reuse may be implemented later with snippets or shared
  assets, but each rendered page must read naturally inside its own guide.
- English is the first migrated language. Stable relative page identities must
  allow a later `portal/fr/` tree without restructuring the English guide.

## Step 1 status

Step 1 is complete: every Markdown page that existed when the inventory was
created is classified exactly once and every `Split` row names all intended
guide destinations.

## Step 2 status

Step 2 is complete: the documentation build provides a shared MkDocs base, one
global selector without search, independent guide/language configurations with
separate navigation and search indexes, and one assembled `doc/site/` artifact.
`doc/build_docs.py` also verifies each English guide's indexed page set against
this matrix.

## Step 3 status

Step 3 is complete: the former `user/`, `ops/`, and unscoped `developer/`
source trees have been migrated into the five guide/language trees. `Move`
pages use their canonical destinations, while `Rewrite` and `Split` pages have
been refocused for their audience so Portal, Manager, Browser, and
Administration searches no longer depend on a mixed User Guide.

Auxiliary editable D2 sources were migrated with their owning guide: database
schema sources are under `developer/en/architecture/` and deployment-diagram
sources are under `admin/en/install/diagrams/`.

Shared documentation assets remain under `doc/docs/assets/` and guide pages use
canonical `/assets/...` references. Screenshot validation scans every published
guide/language source tree and validates the references that are actually
rendered. The migration does not keep compatibility redirects for the retired
public URLs.

## Step 4 status

Step 4 is complete: the application exposes a permanent workspace documentation
action and resolves its destination centrally from the active workspace, route,
topic, and UI language. Embedded Browser help stays in its host guide: Manager
Browser resolves to Manager documentation, Portal file help stays in Portal,
Ceph Admin Browser resolves to Administration, and standalone Browser resolves
to the Browser guide.

Backend-generated production-readiness links and repository documentation links
use the new canonical guide URLs; no compatibility routes are required for the
retired `user/`, `ops/`, or unscoped Developer URLs.

## Step 5 status

Step 5 is complete for the first end-user translation: Portal has a full French
tree under `portal/fr/` with the same page identities as `portal/en/`, a French
MkDocs navigation and search index, and English/French alternate links. The
application opens French Portal help when the UI language is French while other
guides fall back to English until a matching translation exists.

`doc/build_docs.py` enforces English/French Portal page parity, and screenshot
validation covers both Portal languages.
