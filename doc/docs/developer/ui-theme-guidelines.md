# UI Theme Guidelines

The frontend theme is anchored by the shared shell and UI tokens in
`frontend/src/index.css`, plus reusable class exports in
`frontend/src/components/ui/styles.ts`.

## Tokens

- The default brand color is Reef Blue `#0569f8`. Runtime branding derives the
  complete light and dark primary scales from the configured Admin color.
- Reef Coral `#fc572c` is a decorative brand accent reserved for
  authentication backgrounds. It is not a warning, error, or destructive
  action color; keep success, warning, and danger on their semantic tokens.
- Use primary shade `700` for foreground links and accents in light mode and
  shade `200` in dark mode. Primary buttons may use the base or strong primary
  token with white text.
- Use `shell-*` tokens only for the app shell, topbar, sidebar, and their
  controls.
- Use `ui-*` tokens for workspace content, cards, panels, forms, tables,
  dialogs, toolbars, and inline states.
- Prefer `--ui-surface`, `--ui-surface-muted`, `--ui-border`,
  `--ui-border-soft`, `--ui-text`, `--ui-text-muted`, `--ui-hover`,
  `--ui-selected-bg`, `--ui-focus-ring`, and `--ui-shadow-soft` over local
  Tailwind color chains.

## Primitives

- Cards and panels: start with `ui-surface-card`, `ui-surface-muted`,
  `uiCardClass`, `uiCardMutedClass`, `uiPanelClass`, or
  `uiPanelMutedClass`.
- Tables: use `ui-data-table`, `uiDataTableClass`, and
  `uiTableContainerClass` before adding page-specific table classes.
  `components/list/listPresentation.css` owns the shared `--list-*` tokens;
  the former `manager-table` and `compact-table` style layers are retired.
- Toolbars and filters: use `ListToolbar`,
  `uiToolbarClass`, `uiToolbarSecondaryClass`, shared compact toolbar classes,
  and `ActiveFiltersBar`.
- Compact operational summaries: use `InlineSummary` for label/value pairs.
- Buttons: use `UiButton`, `uiButtonBaseClass`, `uiButtonVariants`, or
  `uiIconButtonClass`; keep custom button chains for exceptional states only.
  In listings, use `ListActionButton`/`ListActionLink` and `ListActions` instead.
  Use `ListActionAnchor` when native navigation is required, such as opening
  another workspace in a separate tab.
  They own geometry, focus, disabled/loading states and semantic variants
  without changing the default form-button scale.
- Forms: use `ui-control`, `uiInputClass`, `uiLabelClass`, and
  `uiCheckboxClass`. Use `SettingsSwitch` for binary settings, reserving
  checkboxes for selections and acknowledgements. Switches use theme primary
  for on and `--ui-text-muted` for the neutral off track; green remains a
  semantic success color, not a fixed switch color.
  `UiField` owns label/help/error associations and merges additional description
  IDs from its caller. Standard inputs, selects and textareas retain all those
  descriptions and never suppress a field error with an explicit false ARIA
  state. `ui-control[aria-invalid="true"]` uses the semantic danger border;
  errors must also have visible text. Modal controls keep 44px touch targets.
  `size="compact"` on `UiInput`, `UiSelect` and `UiTextarea` uses the shared
  `ui-control-compact` class: 12px text, an 18px line height and a 28px minimum
  height, increasing to 44px on mobile or coarse pointers. This explicit size
  class takes precedence over the standard `ui-control` typography; do not
  recreate compact field sizing at individual call sites.
- Selection: line tabs use a 3px primary underline and primary `700` text in
  light mode / `200` in dark mode. Sidebar links, including Profile, reuse the
  shared active styling and vertical primary marker. Keep shell backgrounds
  on `shell-*` tokens and content backgrounds on `ui-*` tokens.
- Use primary `500` in light mode and `400` in dark mode for active tab/sidebar
  markers and switch tracks. The lighter dark-mode shade keeps these small
  indicators legible, including with darker custom branding colors.
- Keyboard focus on line tabs and switches uses an opaque primary `700` / `200`
  outline so it remains visible on both themes and with custom branding.
- Modals and menus: use `Modal`, `uiMenuClass`, `uiMenuItemClass`, shell menu
  classes in the topbar, and `AnchoredPortalMenu` for positioned menus.
  `components/modal.css` bounds the entire dialog to the dynamic viewport,
  removes inherited list/form spacing from its overlay and lets the body scroll
  within the remaining height. Long titles wrap; exceptionally tall headers
  scroll within half the available height. The close action keeps a 44px target
  below 1024px or with a coarse pointer. Settings dialogs and shared confirmations
  use the compact spacing contract. Do not compensate for viewport issues with
  page-specific modal sizes.
- Destructive confirmations reuse `ConfirmActionDialog`, including Admin
  connection, endpoint, RGW account and RGW user deletion. Put optional deletion
  choices in its `options` slot (disabled while loading), resource constraints
  in `warning` with `warningTone="warning"`, and request failures in `error`.
  Keep resource counters, identifiers and backend deletion guards intact.
- Admin RGW creation reuses `AdminRgwCreateFields`; creation and import share
  `AdminRgwEndpointField` and named, field-adjacent validation. Use `SettingsForm`
  with `presentation="dialog"` inside `SettingsDialog`, or its page footer for
  a workflow page. `submitDisabled` blocks submission without freezing editable
  choices; `busy` freezes the draft and dismissal until the request completes.
  Keep successful import forms clean after clearing their identifiers.
- Badges and tags: use `UiBadge` / `UiTagBadge` and their shared
  `uiBadgeShapeClass` (4px radius, 1px border), pale tone fill and medium text,
  without shadows. Preserve semantic tones and custom tag palettes in both
  themes; contextual markers use `primary`. Keep list-specific compact sizes.

## Patterns To Avoid

- Do not add workspace-scoped themes when a shared token or primitive fits.
- Avoid `bg-gradient-*`, `backdrop-blur`, `shadow-xl`, `shadow-2xl`,
  `rounded-xl`, and `rounded-2xl` on standard workspace surfaces.
- Keep strong shadows, translucent overlays, and larger radii for justified
  cases: authentication screens, popovers, overlays, alerts, and
  temporary operation states.
- Do not use visual refactors to change backend contracts, permissions, IAM/S3
  semantics, routes, or execution context behavior.

## Documentation Theme

The published MkDocs theme should feel like the application shell and workspace
surfaces, not like a separate marketing site.

- `doc/docs/assets/stylesheets/docs-theme.css` mirrors the app tokens from
  `frontend/src/index.css`. Keep the same `--ui-*` and `--shell-*` token names
  when changing documentation colors, borders, text, shadows, or active states.
- Documentation content surfaces should follow app workspace primitives:
  8px radius (`0.5rem`), `--ui-surface`, `--ui-surface-muted`,
  `--ui-border`, `--ui-border-soft`, `--ui-text`, `--ui-text-muted`,
  `--ui-hover`, `--ui-selected-bg`, and soft/no shadows.
- Documentation density should also follow the app workspace posture: compact
  headings, tight vertical rhythm, dense tables, compact primary navigation,
  compact table of contents, and screenshot chrome that leaves as much room as
  possible for the actual capture.
- Documentation chrome should follow app shell primitives:
  `--shell-topbar-bg`, `--shell-sidebar-bg`, `--shell-border`,
  `--shell-text`, `--shell-muted`, `--shell-hover`, and
  `--shell-selected-bg`.
- Do not introduce one-off documentation palettes such as separate blue,
  purple, teal, or gradient systems. If the app primary color changes, update
  the mirrored docs token scale in the same pass.
- Changing the default does not rewrite already persisted Admin branding
  values. Resetting settings loads the current default palette.
- Validate meaningful documentation theme changes with a strict MkDocs build,
  the screenshot reference check, and at least one desktop/mobile render smoke
  of a table-heavy docs page.

## Compact settings tokens

`components/settings/compactSettings.css` owns the opt-in settings geometry:
`--settings-content-width` (1120px), `--settings-title-width` (190px),
`--settings-section-gap` (12px top/bottom), `--settings-column-gap` (16px),
`--settings-row-height` (40px minimum), `--settings-row-padding` (6px) and
`--settings-control-height` (28px desktop / 44px below 1024px or with a coarse
pointer). Change these shared tokens instead of copying dimensions into page-specific styles. Rows
may grow for translated labels; do not clip text or reduce mobile targets.

Compact sections, inline status badges and the sticky action area use the
existing surface, border, text and primary palette tokens. Page-level sticky
action bars use `ui-page-sticky-actions`. While a bar is present outside a
`hidden` tab, the main scrollport drops its bottom padding so `bottom: 0`
reaches the visible edge without revealing scrolling content below the bar.
Workflow panels also remove their bottom padding so the bar stays flush with
the panel border at the end of the form, without negative bottom margins.
Pages without a visible bar retain their normal bottom gutter; sidebar and
dialog footers keep their own scroll containers. Validate at the top, middle
and end of a long form, after switching tabs, and after cancelling a draft.
Branding previews
scope generated primary variables to their demonstration container; they must
not call the global branding runtime until a server save succeeds. Check both
light and dark themes and a custom accent. Switches represent binary settings;
checkboxes remain for multiple selections and acknowledgements. Inheritable
booleans use an explicit three-state selector, with a separate Customize switch
for numeric and list overrides.

The compact presentation is explicit. Nonmigrated consumers keep the default
`SettingsLayout` presentation, including bucket configuration. Account Portal
overrides and Storage Space settings now use the compact presentation. The former
Portal alias facade and unused card/form helpers have been removed; import the
canonical components directly.

Admin UI User and UI Group editors also use the compact settings sections and
`SettingsForm` footer. `AdminUserIdentityFields` owns the shared user identity
fields, while `AdminAccessToggleSection` presents all direct or inherited access
switches. Preserve the distinct grant semantics and the Manager-before-Browser
tab order. Pending saves freeze the draft and return controls; group close
guards include pending association selections and image changes. The user
Authentication tab keeps its immediate actions and Done footer: it must never
submit the parent profile draft.

The Authentication tab uses the same compact sections for passkeys, passwords,
external identities and sessions. Its native fieldsets submit their own immediate
action on Enter and freeze both their fields and the parent editor navigation
while an operation or passkey verification is pending. Loading errors offer a
read-only retry; mutation errors remain beside the action or inside its existing
confirmation through `ConfirmActionDialog.error`. Keep the exact WebAuthn guard
detection, explicit verification and single retry contract in
`useRecentWebAuthnStepUp`; its dialog uses `SettingsDialog` and shared actions.

API token creation also uses `SettingsDialog`, native fieldsets and compact
checkbox choices. Validate required names, scopes and whole-day expiry beside
their fields; blank expiry delegates to the server default. Freeze the draft and
close paths during creation, including explicit passkey verification. Keep the
one-time secret panel and use shared `SettingsButton` actions for copying or
hiding the newly created token. Copied examples resolve the configured API base
against the current origin rather than assuming a local backend address.

Short editable dialogs can compose `SettingsFormDialog`, which reuses
`SettingsDialog`, `SettingsForm` and `ModalActions`. Portal membership and quota
requests, space creation/import, public links and raw-log exports use this
composition. It owns the 12px field spacing, native form validation, translated
Cancel/Done controls, first-field focus, inline submission errors and pending
fieldset/close locks. The async submit callback must return its promise so the
dialog can suppress repeated submissions until it settles.

Mount one instance per draft and supply a stable `draftKey` containing only
editable values. Closing a changed draft uses the shared discard confirmation;
route departures and reloads are protected too. `onClose("navigation")` must
clear local state without rewriting the destination URL. After a successful
save that navigates, unmount the dialog before navigation so the saved draft
does not trigger a discard prompt. A completed public-link dialog keeps its
copy action and Done control, clears its dirty state and hides creation.
Callers retain API payloads, permission checks, field validation and resource
context; membership identity/reason fields are shared in `PortalRequestFields`.
Page-history load errors stay outside these dialogs; submission errors stay
inside, alongside the retained draft so the user can retry.
Browser bucket/folder creation uses the same dialog composition. Creation hooks
own validation, S3 requests and post-create refresh; presentation owns close
confirmation, focus and navigation guards. Pass the submit promise through
without `void` wrappers. Preserve bucket-name normalization and literal parent
prefixes, spaces and repeated separators in folder keys.

The SSE-C editor has multiple actions and composes `SettingsForm` with
`useSettingsFormController`. Secondary actions use `runAction` so Generate,
Clear and Enable share the pending lock and cannot overlap. Its hook owns the
accepted draft baseline because generation immediately activates a key. Keep
Show/Hide, memory-only scope, key validation and the manual-copy handoff; do not
change signing or encryption semantics to match presentation.

Manual Browser copy uses `SettingsDialog`, a labelled read-only `UiTextarea`,
selected text, shared actions and an announced result. A missing clipboard API
and a rejected clipboard permission both open the same fallback for paths and
presigned URLs. A failed presign must not open a copy dialog with no URL.

Read-only collection dialogs compose `ListDialog`: it shares `SettingsDialog`
geometry, an unframed `ListToolbar`, loaded counts, refresh/pagination controls,
and announced loading, error and empty states. Retain existing rows while
loading or after pagination failures; an initial failure must not look like an empty
collection. The modal body owns vertical scrolling, with no extra height-limited
list nested inside it. Descriptions and long identifiers wrap within the dialog.
Browser prefix versions and multipart uploads use responsive `DataTableShell`
rows with this composition. Counts describe loaded rows, not a server total;
exports retain the exact keys, versions and prefix. Keep row-action confirmation
and execution in the existing callers.

The Browser operations overview uses the same collection chrome while retaining
its timeline cards, group pagination and operation-specific actions. Use shared
listing buttons and badges, `aria-pressed` for filters, `aria-expanded` for file
groups and a named progress bar. Closing this read-only view never cancels work.

Browser bulk attributes, restore-to-date and old-version cleanup also use
`SettingsFormDialog` because their targets belong to the current selection or
prefix. Keep the target summary visible and use `UiInput`, `UiSelect` and
`UiTextarea` with associated labels. Conditional attribute groups share the
same 12px field rhythm and soft separators; metadata fields use two columns
when space allows. Restore preview keys wrap without normalizing or truncating
the object key. Operation hooks retain S3 payloads, version rules, cancellation
and partial-result summaries. Return their apply promise to lock fields, close
paths and repeated submissions while an operation runs. A dry-run result does
not complete the draft: the user can review it and run the restore.

Browser context changes, like Manager context changes, navigate through `ctx`
before changing provider state or stored preferences. The catalogue derives the
executor after navigation is accepted, so a keyed outlet cannot erase a draft
before its route guard runs. Do not expose an eager context-state setter.
Native bucket/prefix history entries may keep the same URL. While any modal
owns the Browser interaction, reject those local history transitions too;
otherwise Back can silently change the targets beneath a pending operation.
The modal's Close/Cancel controls keep their existing draft confirmation.

Contextual drawers yield Escape and focus trapping whenever `hasOpenModal()` is
true, including pending dialogs with Escape disabled. A covered drawer must not
close or rewrite its object URL while the user operates a child dialog.

Editable workflow pages use `SettingsWorkflowForm`, combining `WorkflowPage`,
compact settings sections and the shared sticky `SettingsForm` footer.
`useSettingsFormController` gives these pages and `SettingsFormDialog` the same
native submission, pending lock, discard and navigation contract. A loading
page freezes fields and submission but permits leaving; read failures expose a
retry action and must not make a fallback draft writable.

Manager SNS creation uses `SettingsFormDialog`; attributes and policy use
`SettingsWorkflowForm`. Each editor owns its load and draft, ignores late
responses after unmount, and accepts a new baseline only after loading or
saving succeeds. Submission errors retain the current draft. Capture the topic
ARN and execution context when opening an action: a context-selector update
must not retarget an existing draft or remove it before navigation confirmation.
Manager's context selector navigates to the new `ctx` before the provider changes
the executor; eager selection must not remount its keyed outlet before a draft
or pending-operation guard can decide. Clean editors close when the context
changes. Topic deletion uses a controlled
`ConfirmActionDialog` so failures remain visible and retryable, with dismissal
and navigation locked during the request. Keep native SNS attributes, policy
JSON and executor parameters in the feature layer.

Manager IAM user, group, role and policy creation, plus role trust-policy editing,
use `SettingsWorkflowForm` with a plain surface. Their identity, managed-policy
selection and inline-policy fields retain the same compact section layout.
The shared wrapper owns the native submit, pending caption, sticky footer and
close/route/reload guards; feature handlers retain IAM documents, attachments,
validation and one-time access-key presentation. Errors appear once inside the
active form. Do not reintroduce local close guards around these forms.

Manager bucket creation follows the same `SettingsWorkflowForm` contract with
General and Protection sections on one page. Keep the execution context visible,
associate labels with the bucket name and optional LocationConstraint, and use
the shared switches and action footer. The feature layer retains S3 name
normalization, endpoint-default placement and versioning payloads. Failed
creation retains the draft; pending creation and list refresh lock resubmission,
closing and context navigation.

Feature-rule inspection retains the specialized grouped `FeatureRulesTable`.
Its JSON opens in a `SettingsDialog` with a labelled, read-only `UiTextarea`,
using theme colors and wrapping long values for narrow screens. Context or
feature changes clear the previous inspection and rows; failed inventory loads
use the error state rather than the filtered-empty state.

`useSettingsRemoteDraft` is shared by SNS and IAM role editing. Mount it for one
resource and execution context, provide a stable load callback, and disable
editing/submission until the remote baseline is available. Its retry control
must remain operable after a read failure. A closed editor ignores late load
responses. Role names and paths remain read-only during trust-policy editing.

Bucket selection dialogs in Ceph Admin and Storage Ops use `SettingsDialog`,
`ModalOptions` and `ModalActions` for the same compact geometry. Configuration
backups use `SettingsFormDialog`: selected features survive capability-list
refreshes, unavailable features cannot be submitted, and pending downloads
freeze both the form and closing. Selection exports remain immediate format
actions with progress in the workbench.

UI tag operations retain custom drafts until the operation succeeds, show
submission errors inside the dialog and guard closing/navigation. Existing-tag
actions do not discard a separate new-tag draft. The selection-action hook
returns an error message on failure and `null` on success so the dialog can
retain its draft without changing tag API payloads or target resolution.
Tag settings popovers share the menu surface and compact settings controls;
they own Tab and Escape until closed and return focus to their tag trigger.
Hide a tag popover while its visibility confirmation is open so the topmost
confirmation owns Escape.

Comparison confirmations use `ConfirmActionDialog` and its detail/impact
slots. Manager remediation must retain the source and target execution
contexts, exact object keys, cutoff and destructive/truncation warnings.
Ceph Admin navigation confirmations retain the full object key. Confirmation
only starts the existing workflow; its execution and progress stay in the page.

`OneTimeSecretPanel` owns the compact handoff presentation for generated API
tokens and S3 keys across Admin, Manager, Ceph Admin and Portal. Reuse its warning
palette, standard badge, labelled value groups and shared copy controls. Each
copy reports success or a recoverable failure beside that value; Portal supplies
localized feedback. Keep values intact and selectable, including long strings,
and keep workflow-specific actions and secret lifetimes in the caller.

Settings typography is also tokenized: titles 14px/20px at weight 600, labels
13px/18px at weight 500, body/inputs 13px/18px at weight 400, descriptions and
buttons 12px/16px at weight 400. Use `settings-section-title`, `settings-label`,
`settings-body`, `settings-description` and `SettingsButton`; do not depend on
ad-hoc tiny text utilities or change the global `UiButton` defaults.
Dialog and action-bar spacing comes from `--settings-dialog-padding-x/y`,
`--settings-field-gap` and `--settings-actions-padding`. Heights are minimums,
so longer translated labels and validation messages can wrap without clipping.

## Listing tokens and exceptions

The `--list-*` scale centralizes 12px/18px text, 400/500/600 weights, 36px
minimum rows, 12px/4px cell padding, 28px controls with 8px inline padding,
6px action corners and 4px badge corners. Below 768px or with a coarse pointer,
controls use 44px targets. Do not use arbitrary `text-[12px]` utilities as a
substitute for the semantic classes; the global typography layer may normalize
those utilities differently.

Surfaces, borders, hover, selection and focus derive from `--ui-*`; primary
variants use the runtime brand scale. Success/warning/danger action colors and
association category colors are centralized in `listPresentation.css`.
`ListBadge` reuses `UiBadge` semantic palettes, while custom S3 tag colors remain
owned by the existing tag contract. Avatars, progress tracks and status dots
retain their geometric meaning.

A page may set column widths, scrolling, grouped-row geometry or Browser
density. It must not override action fonts, padding, corner radius or colors
with local chains. Desktop `ListActions` stays on a single line; mobile groups
wrap. `PageHeader`/`PageShell` opt in with `actionPresentation="listing"` and
page context inputs reuse `ui-list-control`, so unrelated form headers and
controls keep their existing appearance. See the
[presentation inventory](listing-presentation-inventory.md) for the exceptions
and validation command.


### Consultation toolbar scope

`ListToolbar` and `ListPageSection` require `page` or `section`. Their
`data-list-variant` and `ui-list-toolbar-*` classes own the heading, search,
filter, tools, count and secondary zones. Search is 18rem maximum, flexible
on desktop and full-width below 768px. Filter selects are bounded to 14rem
and their labels remain inline. Use the form primitives' labels rather than
local uppercase spans. `UiField` marker classes change presentation only
inside these toolbar zones; ordinary forms retain their existing defaults.
Mobile sort controls use `ui-list-mobile-sort`; they are hidden while table
column headers are visible. Table cell and row-action geometry is independent
of these header variants. Browser does not opt into the new header zones.


## Compact dashboard geometry

`components/compactDashboard.css` owns the explicitly adopted dashboard scale:
12px gaps, 12px vertical / 16px horizontal panel padding, 14px/20px semibold
panel titles, 12px/18px text, and 22px/28px metric values. Dashboard actions
wrap when necessary and use 28px minimum height, 12px normal-weight text and
6px corners; targets are at least 44px on mobile or any coarse pointer.
Badges retain shared semantic/theme colors and 4px corners.

At 1280px and above, the operational grid is 2:1; the secondary activity/map
grid is 1:1. Both stack below that breakpoint. Summary links use six columns,
three from 768px, and two below. Endpoint rows are at least 36px on desktop
and expand with long text. The map retains its explicit 220px height. This
geometry is distinct from settings and listing geometry; changes must not
implicitly restyle nonadopting consumers or global UiButton defaults.

Manager and Portal explicitly pass `presentation="compact"` to the KPI row.
Its minimum is 120px rather than the legacy 164px, with 32px icon bubbles,
20px icons, 12px/18px labels and 22px/28px values. Heights grow with content;
never clamp translated trends or drop quota details to fit. The storage chart
retains its 92px drawing area and the data-type donut its 128px height.
Compact storage charts use the primary theme token without changing their
points or semantic distribution colors. Navigation cards, health cards and
data-type cards retain their original defaults outside this explicit adoption.
Use dashboard action links for buttons and `WorkspaceDashboardLinkRow` for
rich shortcuts; retain plain identity links and their accessible touch areas.
