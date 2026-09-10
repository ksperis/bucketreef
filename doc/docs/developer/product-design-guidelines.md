# Product Design Guidelines

## Purpose

This document captures the product design contract for future interface work in
BucketReef.

Use it to decide:

- which workspace should own a feature;
- how dense or technical the screen should be;
- which shared UI patterns should be reused;
- which vocabulary belongs to each user surface;
- what to validate before shipping visible UI changes.

It complements, but does not replace:

- [Workspace surface separation](workspace-surface-separation.md), which defines
  routing, execution identity, and cross-surface contracts;
- [UI theme guidelines](ui-theme-guidelines.md), which defines tokens and
  primitive class usage;
- [AI assistant guidelines](ai-assistant-guidelines.md), which defines security,
  architecture, validation, and commit expectations.

## Product Direction

BucketReef is a work console for S3-compatible storage. It should feel calm,
dense, predictable, and operational. The UI should help users understand what
identity they are using, what storage scope they are acting on, and whether an
operation is native S3/IAM, platform governance, or end-user self-service.

Avoid marketing-style pages, decorative layouts, fake production data, and
workspace-specific visual themes when a shared product pattern fits.

## Design Principles

1. Start from the workspace contract.
   Place a feature in the narrowest workspace that matches the user's job and
   the required execution identity.

2. Keep S3 and IAM faithful.
   Manager and Browser features should expose native storage concepts clearly
   instead of simplifying them into a parallel permission model.

3. Protect Portal from operator complexity.
   Portal is for end users. It should use user-facing labels, avoid advanced
   S3/IAM vocabulary, and hide diagnostics that belong in Manager, Browser, or
   Admin.

4. Reuse shared primitives before styling locally.
   Start from `PageHeader`, `PageTabs`, `ListToolbar`, `InlineSummary`,
   `ActiveFiltersBar`, `DataTableShell`, `WorkflowPage`, `Modal`, `UiButton`, and
   the shared `ui-*` classes before adding page-specific class chains.

5. Prefer progressive disclosure over busy first screens.
   Keep dashboards and list pages scannable. Move advanced filters, raw JSON,
   destructive actions, and technical detail into tabs, drawers, modals, or
   secondary sections when the workflow allows it.

6. Make unavailable states honest.
   If a backend capability, feature flag, account context, or storage permission
   is missing, show an empty or unavailable state. Do not invent realistic
   production data outside tests, docs screenshots, or isolated demos.

7. Validate real routes when runtime behavior matters.
   Unit tests and type checks are not enough for visible route behavior. Use a
   browser smoke or the docs visual QA scenarios for meaningful UI changes.

## Workspace Design Contracts

| Workspace | User job | Design posture | Preferred patterns | Avoid |
| --- | --- | --- | --- | --- |
| `/portal` | End-user storage workspace for files, shares, governance activity, usage, and personal settings. | Approachable, compact, user-facing, and bounded to visible Storage Spaces. | `PageHeader`, `WorkspaceDashboardKit`, `PageTabs variant="line"`, `SettingsLayout`, locked `BrowserEmbed` with the `portal-basic` profile. | IAM jargon, ARNs, principals, policy JSON, bucket diagnostics, lifecycle, replication, versioning, `/portal/browser`, fake production data. |
| `/browser` | Advanced object explorer and object-operation workspace. | Task-first, technical, and explicit about selected execution context. | `BrowserPage`, `BrowserEmbed`, compact embedded profiles, advanced root profile only when access allows it. | Duplicate browser implementations, hidden context switching, advanced chrome for simple embedded surfaces. |
| `/manager` | S3 and IAM configuration console for accounts, connections, users, groups, roles, policies, buckets, and bucket features. | Dense, accurate, and native to S3/IAM semantics. | `PageHeader`, `PageTabs`, `DataTableShell`, `ListToolbar`, `BucketFeatureCard`, shared metrics and dashboard components. | Hiding native S3/IAM meaning, Portal wording, platform-governance settings that belong in Admin. |
| `/admin` | Platform governance for UI users, endpoints, accounts, feature flags, audit, billing, health, and global settings. | Administrative, auditable, and oriented around platform state. | `PageHeader`, settings panels, `WorkflowTabs`, shared association summaries, shared metrics cards. | Generic S3 object workflows, tenant operations without explicit governance context, local-only visual patterns. |
| `/ceph-admin` | Ceph RGW cluster administration for authorized operators. | High-signal, risk-aware, and explicit about endpoint-wide impact. | Ceph Admin shell, compact operational tables, risk acknowledgement for endpoint-wide Browser use. | Regular tenant file work, hiding owner/executor ambiguity, Portal or Manager shortcuts. |
| `/storage-ops` | Operational bucket tooling and cross-account maintenance. | Deterministic, compact, and action-oriented. | Shared bucket workbench, advanced filter drawer, selection action bar, progress cards. | Decorative cards, hidden filters that change backend semantics, UI-only filters without backend support. |

## Pattern Matrix

| Need | Default pattern | Notes |
| --- | --- | --- |
| Page title, description, breadcrumbs, and primary actions | `PageHeader` | Keep primary actions top-level only when they start the main workflow for the page. |
| Sibling page modes or metric sections | `PageTabs variant="line"` | Use the shared line baseline for top-level page navigation. Keep `bar` for compact embedded controls and `card` when the tab content is a contained tool. |
| Lists and inventory pages | `DataTableShell`, `ui-data-table`, `uiTableContainerClass` | Keep tables compact. Use explicit empty and unavailable states. |
| Search, filters, and column controls | `ListToolbar`, `ActiveFiltersBar`, shared compact toolbar classes | Advanced filters should not introduce frontend-only behavior unless the backend data is already present and bounded. |
| Useful operational summaries | `InlineSummary` | Keep label/value pairs compact, attach totals to their scope, and avoid repeating controls or result counts. |
| Cards, panels, and page sections | `uiCardClass`, `uiPanelClass`, `uiCardMutedClass`, `uiPanelMutedClass` | Standard cards use 8px radius and soft/no shadows. Avoid decorative nesting. |
| Forms and settings | `ui-control`, `uiLabelClass`, `SettingsSwitch`, `UiCheckboxField`, `UiDetails`, settings panels | Switches for on/off settings; checkboxes for multiple selections and acknowledgements. Compute dirty state from saveable fields only. |
| Long operations and large forms | `WorkflowPage`, `WorkflowTabs`, `WorkflowSection`, `WorkflowActions`, `workflowPageHostClass` | Replace the current list content with a focused in-page workflow. Keep the page header full-width so its actions stay aligned with listing pages; apply `width` only to the left-aligned content wrapper and never center the form body. |
| Dialogs, drawers, and overlays | `Modal`, shared menu classes, `AnchoredPortalMenu`, `useUnsavedChangesGuard` | Reserve overlays for short, contextual tasks. Editable overlays must protect unapplied changes on every close path. |
| Inline status, warnings, and capability gaps | `UiBadge`, `UiInlineMessage`, `PageBanner`, `PageEmptyState`, `MetricsUnavailableCard` | Distinguish missing data, disabled features, denied permissions, and unsupported backend capability. |
| Destructive or high-risk operations | Explicit confirmation plus backend safeguards and audit logs | Never rely on color or UI gating alone for safety. |
| Dashboards and metrics | Shared KPI, usage, traffic, and workspace dashboard components | Reuse chart language across Admin, Manager, Portal, and Ceph Admin while keeping labels surface-appropriate. |
| Browser inside another workspace | `BrowserEmbed` with a locked or compact profile | Embedded Browser should reduce chrome and preserve the parent workspace's job. |

For the standalone Browser, keep functional access separate from presentation:
**Technical S3 tools** controls the Advanced action set, while density and the
optional Folders panel remains a user display preference. The
default is Compact with Folders hidden. Compact uses one path-and-icon-action
row when width permits; Comfortable uses labeled actions on that row at wide
viewports and moves them below the path before the toolbar becomes cramped.
Selection actions replace controls inside the existing context bar rather than
inserting a new row. Object, Advanced path, and bucket details use the shared
contextual drawer, which overlays the list on desktop and becomes a modal
full-screen surface below 1024px. Keep the header limited to the resource name,
path, actions, tabs, and actual warnings/status; do not repeat object metadata
under the tabs.

## Compact configuration inventories

For configuration inventories such as Admin S3 endpoints, keep the compact
shared table and its existing detail page. Summarize identity, connection
configuration and enabled services; leave technical addresses and credentials
in the editor. An enabled service is configuration, not proof of live health.
Keep at most two tags and three service badges before a remainder count.
When row actions stay visible, order them **Set as default**, **Edit/View**,
**Delete** and retain the shared default-row action behavior. Row geometry and
28px normal-weight actions use the common listing presentation; touch targets
remain at least 44px. The information limits above apply only to this endpoint
inventory, not to other tables.

## Common table and listing presentation

Use `DataTableShell` or the `ui-data-table` foundation for every table, including
secondary tables in dialogs. Keep the content and specialized engines in their
feature components. Use `ListActionButton`, `ListActionLink`, `ListActions` and
`ListBadge`; listing headers opt in with `actionPresentation="listing"`.
Page context inputs reuse `ui-list-control`.

- Headers: normal case, 12px/18px, weight 600. Cells: 12px/18px, weight 400;
  principal identities use weight 500.
- Cells: 12px horizontal and 4px vertical padding; simple rows start at 36px
  and expand with content. Do not hide content or add truncation for density.
- Actions, search, filters and pagination: 28px minimum, 12px normal text,
  8px horizontal padding and 6px corners. Icon actions use 28px squares.
- Badges and tags: 4px corners, 12px medium text. Preserve status meaning,
  custom tag colors, interactive behavior and accessible descriptions.
- Keep each desktop action group on one line when the table has room. Reserve
  action-column width and let genuinely wide tables scroll internally. On mobile,
  allow action groups and labels to wrap; touch targets are at least 44px.

Browser retains Compact/Comfortable row geometry, and enriched endpoint rows
remain extensible. Mobile table cards must use automatic height. Defaults of
`UiButton`, settings and other form controls are independent of this contract.
See the [component inventory and validation map](listing-presentation-inventory.md)
for every table, secondary surface and documented geometry exception.

## Consultation headers and summaries

Keep the page title, description and primary actions in `PageHeader`. Put list
search and filters in `ListPageSection` / `ListToolbar`. Do not repeat selected
filters, endpoint metadata or result counts in cards above the list.
Choose an explicit `variant="page"` when the page or selected tab already names
the list: its title is an accessible region name, without a visible heading.
Use `variant="section"` for distinct blocks sharing a page. Its heading is above
the controls, with section creation/execution actions in `headingActions`.
There is no separate mobile-layout option.

Both variants use the same row: **search → filters → table tools → count**.
The count is aligned right. Put columns in `columns` and refresh/export in
`actions`; main creation actions stay in `PageHeader`. A search has an icon and
a visually hidden accessible label. Use `ToolbarSearchInput` or a labeled
`UiInput` in the search slot. Advanced multiline/exact-match searches keep their
behavior in the same slot. Filters use `UiSelect` / `UiInput` with visible,
normal-case labels beside the value (for example, `Provider: All`). Do not add
local grid wrappers or field widths to recreate toolbar layout.

Operational inventories use `ColumnVisibilityMenu` for optional columns. It owns
the trigger, anchored portal, viewport scrolling, keyboard dismissal and shared
picker presentation. Pass the existing column definitions and callbacks; feature
loading and persistence stay with the inventory. Keep one neutral Reset action
inside the picker, disabled when the defaults are already selected. Do not add
local popover state, palettes or a second reset button in the toolbar.

`listPresentation.css` owns widths, gaps and alignment. Search grows up to
18rem and gives space back to other controls. Fields retain shared 28px targets
(44px on mobile or coarse pointers). Below 768px search fills a row; filters,
tools and the final count wrap in the same reading order. On intermediate
widths controls wrap within their groups when necessary. Meaningful guidance
and advanced summaries belong in `secondaryContent`, not in a redundant title.
Purely informational tables keep their enclosing section without invented
search or result-count controls. Browser and its embedded components are
excluded; shared profile presentation opts in only outside Browser.

Controls that affect multiple sections remain at page level: Billing month and
endpoint affect monthly totals and subjects; Endpoint Status filters latency,
timelines and incidents together. Billing's subject type only filters the table.
Admin metrics keeps its Ceph endpoint selector beside the page heading.

Use `InlineSummary` for useful operational values (collection freshness, maximum
quota usage, billing totals and coverage), without individual cards. Keep a
single result count in the list toolbar, or in the tabs when they already count
requests and sessions. Portal activity does not need a second overview.

Sort through the table headers on desktop. `TableSortControls` adapts existing
column sort transitions; `MobileTableSort` supports independent server sort
parameters. Both retain sorting
below 768px, where responsive cards hide those headers. Audit action and status
filters apply only to loaded entries; label that boundary explicitly and retain
cursor-based loading. Do not turn an existing local filter into an implied
server-wide search.

Manual billing collection uses a closed `UiDetails` by default. Its progress,
results, partial errors and coverage warnings stay outside the disclosure so
closing it never hides operational feedback. Preserve feature-disabled, empty,
permission and unavailable states, without presenting missing data as zero.

`consultationVisualQa.spec.ts` exercises these seven routes with deterministic
fixtures, desktop and mobile viewports, both themes, and Portal translations.
Its screenshots are visual evidence with mocked APIs, not authenticated storage
or permissions validation.

## Selection indicators and binary settings

- `PageTabs variant="line"` uses a 3px primary-color underline, accented text,
  a transparent selected background and a shared thin baseline. `PortalPageTabs`
  and `WorkflowTabs` inherit this pattern. Keep `bar` and `card` for their
  existing embedded/contained uses.
- Tabs remain at least 32px high on desktop (1024px and above) and 44px below
  that breakpoint. Allow labels and tabs to wrap, with visible keyboard focus;
  preserve arrow, Home and End navigation and disabled-tab behavior.
- The sidebar uses the same primary color for its vertical selection marker.
  Profile reuses the navigation links' active and inactive styling, including
  the marker in expanded/mobile navigation and the icon state when collapsed.
- Use `SettingsSwitch` for on/off settings, including profile tag visibility
  and quota notifications. Its 36 x 20px track sits inside a 36 x 32px desktop
  target or a minimum 44 x 44px target below 1024px. Use theme primary for on,
  neutral for off, a visible focus outline and a disabled state. Expose a named
  switch with its checked state and native Space-key operation.
- A switch changes the current form draft; it does not imply immediate saving.
  Preserve the owning form's Save/Cancel, error and permission behavior.
  Keep `UiCheckboxField` for list selections and acknowledgements. Migrate other
  checkbox-based settings during the [separate follow-up](settings-ui-follow-up.md).

## Compact badges and tags

- Use `UiBadge` for statuses and `UiTagBadge` for user-defined tags. Both use
  `uiBadgeShapeClass`: 4px corners and a thin 1px border, with a pale fill,
  medium-weight text and no elevation. `PropertySummaryChip` reuses `UiBadge`.
  Avoid pill shapes and page-specific radius overrides for these labels.
- Keep existing heights, padding and truncation in dense lists. Browser's
  small content badges retain their 10px `ui-badge` typography.
- Keep semantic status colors and user-selected tag colors in light/dark
  mode. Use theme primary for contextual markers such as the current session.
- Interactive tags keep their edit/remove actions, visible keyboard focus,
  private/shared border styles and selected/available indicators. Selection
  may use an outline or ring, without adding a drop shadow.

## Compact settings with section titles at the side

The personal profile and the seven migrated settings pages use the opt-in `SettingsSection presentation="compact"`
and `SettingsItem compact` presentation from `components/settings/SettingsLayout`.
The default rendering remains unchanged for existing settings consumers.

- Keep the content left-aligned, at most 1120px wide. At desktop widths of
  1024px and above, reserve 190px for the section title and a short description,
  with a 16px gutter. Below 1024px, place the title above the settings.
- Use flat rows separated by soft token borders: 40px minimum, 6px vertical
  padding, and about 48–52px for a short label and description. Sections have
  12px top/bottom padding. Section titles use 14px/20px semibold; setting labels
  use 13px/18px medium; descriptions use 12px/16px normal. Allow rows to grow
  for translated text; never truncate instructions to force height.
- Use 28px minimum controls on desktop. Setting buttons use 12px/16px normal
  text and 8px horizontal padding; inputs and selects use 13px/18px text.
  Keep 44px touch targets below 1024px and whenever a coarse pointer is present,
  including hybrid laptops. Switch tracks remain 36 × 20px.
  An icon, a real status and an action are optional. Avoid nested cards and
  repeated section titles. Both themes use the existing `ui-*` tokens.
- Show identity information as text. Short name/avatar/password edits belong
  in a `Modal`; detailed passkey/account lists and session diagnostics open on
  demand. Keep technical addresses and authentication identifiers in details.
- Group related preferences under a single dirty-only Save/Cancel area. Commit
  server preferences before applying local theme, language and navigation
  choices. Retain drafts on failure and protect dialog closure, tab changes,
  route navigation and browser history with the shared confirmation pattern.
- Translate the profile header, two personal tabs, dialogs, errors and
  accessible controls using `useI18n` in English, French and German. Preserve
  automatic language selection. Use `Intl` for local dates, numbers and plurals.
  Classify security errors before translating their display text.
- Explain actual revocation effects, including the current session and personal
  API tokens. Never invent recovery-code counts or a saved status. New recovery
  codes are delivered by an in-memory boundary above authenticated routes;
  authentication is cleared normally and protected routes stay inaccessible.
  A concurrent 401 only defers the hard login redirect while delivery is active.
  On acknowledgement/page exit, forget codes; never persist or log them.

Examples: identity with a read-only email and an Edit action; theme with an
inline select; a session with browser/system, recent activity, Details and
Sign out. Use tables for connection inventories: the private S3 tab shares the
flat outer framing while retaining its existing dense table and editing flow.
Its table/editor translation is outside this profile delivery.

Validate a 1440 × 900 viewport with two open sessions: all three security sections
must fit without opening details. Check German wrapping, keyboard focus, mobile
touch targets, both themes and actual authenticated routes.

### Settings composition and persistence

Use `SettingsButton`, `SettingsDialog`, `SettingsConfirmation`, `SettingsField`
and `SettingsActions` from `components/settings/SettingsControls`. Profile
wrappers only inject translated labels. `useSettingsDraft` holds the baseline
and editable values; page adapters own conversions, validation and persistence.

Use the shared settings typography classes instead of arbitrary `text-[13px]`
utilities, which are normalized elsewhere. `SettingsField` accepts a translated
`unit` string alongside the input; its accessible description includes the unit
and any field help or error. Short units such as days should not add a separate
line. Explanations and validation stay below the input.

Settings dialogs use 16px horizontal and 12px vertical padding, with 12px gaps
between fields. The dirty-only action bar uses 8px vertical padding. These
changes are opt-in: global buttons, nonmigrated forms, tables and other dialogs
retain their existing geometry. There is no density selector.
This is not a schema-driven form engine. `SettingsNavigationGuard` protects
router navigation and browser unload, while `useSettingsCloseGuard` protects
explicit cancellation. Register one route guard for the whole page, including
any dialog subdraft, so a navigation asks only once.

Storage Space settings use independent save boundaries: identity and icon dialogs
save their own API operation, while file-history controls share a page draft.
Their buttons say **Save**, not **Apply**. Closing a modified dialog requires
confirmation. A successful identity/icon save must not reset the history draft.
Use **Apply** only when a dialog contributes to another form, such as project
CORS origins. Avoid a global save spanning unrelated storage operations.

The Admin RGW account Portal tab reuses the project settings editor, with an
additional delegation section and English labels. Account and Portal saves are
independent; only the relevant action bar appears. Retain both drafts across
account tabs and aggregate them under one navigation/close protection.
Resetting inheritance affects only the Portal draft and preserves delegation.

The dirty-only Save/Cancel area stays sticky at the bottom of its content
container and reserves its own space in the normal flow. Dialog **Apply** only
copies the dialog's draft into the page. Defaults and Portal inheritance resets
also modify drafts only, after confirmation. Keep temporarily empty numeric
inputs; validate ranges and dependencies on Apply/Save and focus the first
invalid field. Retain values after failures.

Admin pages enumerate the leaf paths they own. `useAppSettingsDraft` reads the
latest full configuration before saving, merges only changed owned values and
refuses conflicting edits to the same field. It preserves unrelated changes,
including in the same section. This client check does not provide an atomic
server lock: a write after the last read remains a concurrency limitation of
the existing API. Cancel after a conflict loads the reviewed server snapshot.
Branding is previewed inside a scoped demonstration; global theme and workspace
availability update only after a successful server response.

Portal keeps tri-state booleans (**Platform value / Enabled / Disabled**).
Numbers and lists use **Customize** switches. Show currently applied values
and their origin beside the draft controls. The project API does not return
platform values hidden by a current override: do not invent a future inherited
value. Resolve it on Save. Read-only views show effective text and the delegation
or role restriction. Project switching updates context and persisted selection
only after the URL navigation is accepted; remount the form by project ID and
ignore late responses from previous instances.

Use short dialogs for SMTP, migration limits and CORS origins. OIDC and LDAP
providers have independent dedicated create/edit/view pages under Authentication;
the global security policy saves separately. Keep write-only secrets empty on
edit, retain environment locks and the existing WebAuthn verification contract.
Key rotation is an explicit operation with a scope/effect confirmation and real
partial results; never simulate progress or automatically retry an ambiguous
failure.

### Translation boundary

The shared profile retains English, French and German in all six mounts. This
pass adds those languages only to the user Portal project settings and its
dialogs. All six Admin settings pages and provider editors stay English,
including Admin Browser and Admin Portal settings. Shared controls accept
explicit labels and default to English; never make a shared component translate
unrelated consumers implicitly. Remaining global translation is out of scope.

Further adoption is tracked separately in [Settings UI follow-up](settings-ui-follow-up.md).

## Page or modal decision

Use a focused page when the task has any of these characteristics:

- it runs long enough that progress, cancellation, retry, or a completion
  summary must remain visible;
- it contains multiple sections, tabs, validation groups, or enough fields to
  require scrolling;
- it is a bulk, destructive, import, purge, compare, integrity, or endpoint
  configuration workflow;
- the user benefits from a stable URL-sized surface, readable breadcrumbs, and
  room for supporting context.

Use a modal when the task is short and preserving the current page context is
more valuable than extra space. This includes confirmations, one-time secret
handoffs, compact create forms, small metadata edits, and Browser actions tied
to the current bucket, prefix, or object selection.

Use `ModalActions` for a short dialog's final actions, keeping it inside the
owning form. It shares a soft separator, right alignment, wrapping and compact
28px buttons (44px below 1024px or on coarse-pointer devices). Use `UiButton`
or `SettingsButton` and retain the explicit button type, busy/disabled behavior
and existing draft guard. Place Cancel before the committing action; preserve
specialized multi-action flows such as SSE-C. Pass translated dialog labels
explicitly from Portal; shared components default to English. Page workflows
continue to use `WorkflowActions`, and draft-only settings use `SettingsActions`.

Do not keep a generic compatibility component that switches a workflow between
modal and page presentations. When the same form legitimately needs both,
factor the fields and business hook, then compose explicit `Modal` and
`WorkflowPage` wrappers at their call sites. Do not infer the presentation from
viewport size. When a workflow page is rendered inside an inventory component,
apply `workflowPageHostClass` to the host so the inventory is visually replaced
while confirmation modals can still appear above it.

## Vocabulary Rules

| Concept | Portal language | Manager or Browser language | Admin language |
| --- | --- | --- | --- |
| Bucket-like end-user area | Storage Space | Bucket | Account or storage resource, depending on governance context |
| Access level | Viewer, Editor, Owner, Manager | IAM policy, group, role, access key, bucket policy | UI user, UI group, feature access, account binding |
| File operations | Files, folders, uploads, downloads, shares | Objects, prefixes, metadata, versions, storage class | Usually out of scope unless auditing or governance requires it |
| Usage | Storage health, storage, transfers, billing source | Traffic, usage history, bucket usage, metrics | Usage history, billing, quota monitoring, platform health |
| Advanced configuration | Hidden from Portal | Lifecycle, replication, CORS, website, notification, policy, encryption | Feature flags, endpoint settings, governance and audit |

When in doubt, keep Portal copy user-facing and keep Manager/Browser copy
faithful to S3/IAM.

## Visual Tone

- Use the shared `shell-*` tokens for app chrome and `ui-*` tokens for workspace
  content.
- Standard workspace screens should be restrained, dense, and scannable.
- Keep page sections unframed unless a component is a repeated card, modal, or
  genuinely framed tool.
- Avoid gradients, large shadows, translucent effects, oversized rounded
  corners, and decorative illustration on operational screens.
- Do not introduce a new color language for one workspace unless the shared
  token model cannot represent the state.
- Maintain both light and dark mode behavior for visible shared components.

## New UI Checklist

Before implementing a new page or materially changing an existing page:

1. Identify the owning workspace and execution identity.
2. Confirm the feature is not crossing into another workspace's job.
3. Pick the existing page pattern closest to the workflow.
4. List the shared components and `ui-*` classes to reuse.
5. Define loading, empty, unavailable, denied, and error states.
6. Confirm labels match the surface vocabulary.
7. Preserve IAM/S3 semantics and backend permission checks.
8. Add targeted tests for behavior and regression risk.
9. Run type checks or focused frontend tests when code changes.
10. Use browser-level smoke or docs visual QA for meaningful route changes.

## Product Design Workflow

For broad redesign, new workspace concepts, or visual exploration:

1. Start with the current workspace contract and this guide.
2. Gather the visual source: existing route, screenshot, mockup, Figma frame, or
   generated concept.
3. Explore visual options before implementation when the target is not already
   clear.
4. Build against existing primitives instead of starting a parallel component
   system.
5. Validate the rendered result in desktop, mobile, light, and dark modes when
   the change affects a real workspace route.

Product Design references that are useful for future work include committed
screenshots under `doc/docs/assets/screenshots/`, the docs screenshot Playwright
scenarios, and the shared component files under `frontend/src/components/`.
