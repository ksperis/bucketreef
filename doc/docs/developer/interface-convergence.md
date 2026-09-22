# Interface convergence

This follows the existing settings, listing and consultation-header work. Each
iteration extends a shared presentation primitive and retains workspace-specific
vocabulary, execution identities and save boundaries.

## Dialog viewport foundation

`Modal` now bounds the complete dialog, including its header, to the available
dynamic viewport. List/form `space-y` utilities cannot offset the fixed overlay.
Body scrolling keeps the final form actions reachable; long resource names wrap,
and unusually tall headers scroll. Closing retains focus restoration, nested
dialog behavior and the existing draft guards. The close target is at least
44px on mobile and coarse pointers.

Reproducible validation in the isolated authenticated Admin harness:

1. Open `/admin/api-tokens`, reload, and open **Create token**.
2. Check 1440 × 900 and 390 × 844 in both themes, then 667 × 280.
3. Verify the entire dialog fits the viewport, including its close button.
4. Tab to the final form action: the body scrolls to reveal it. Tab once more
   to return to Close. Escape closes the dialog and restores the trigger focus.
5. Repeat after entering a draft: Cancel/Escape must open the discard
   confirmation; keeping the draft returns to the parent dialog.
6. Check a compact profile/settings dialog and a contextual Browser dialog;
   inspect console errors separately from unavailable Gravatar images.

The authenticated harness validates Admin/Browser rendering with isolated Moto.
It does not prove Ceph, Portal or Manager storage operations. Temporary captures,
reports and authentication state must remain outside commits.

## Short-dialog actions

`ModalActions` now owns the final action area for shared confirmations, settings
draft dialogs, private connection creation, Admin API token creation and endpoint
deletion, Browser bucket/folder creation, SSE-C, copy and bulk dialogs, Manager
private access, and Portal public links/space identity/icons. It keeps native
form submission and save boundaries at the call site. Button geometry and
mobile wrapping are shared rather than copied into each feature.

Admin RGW account creation/import/deletion, RGW user creation/deletion and
single/bulk connection deletion also share these final actions. Their optional
RGW deletion controls use `ModalOptions` with `UiCheckboxField`, retain the
linked/unknown-resource safeguards and wrap complete resource identifiers.
Account creation reuses `AdminQuotaFields`, including the explicit size unit;
tenant import uses a labeled `UiTextarea`.

`Modal.closeDisabled` disables the header Close action, Escape and backdrop
dismissal while these requests are pending. Their final Cancel action uses the
same busy state. A failed request restores dismissal and preserves the existing
error/draft flow; successful handlers can still close programmatically.

Validate the seven Admin dialogs with documentary API fixtures in light/dark at
1440 × 1000 and 390 × 844. Check draft retention/discard, invalid tenant IDs,
quota values and units in the creation payload, pending-request dismissal and
failed-request recovery. Repeat account/user deletion with linked and unknown
resource counts; RGW deletion must remain disabled and absent from the request.
These fixture checks cover UI contracts, not live RGW mutations.

Portal public-link dialogs now pass all secondary/close/progress labels in the
selected language. Other workspace translation boundaries remain unchanged.

Validate final actions with both themes, desktop and 390px mobile. In Browser,
open **New folder**, check the existing name validation, fill a draft, cancel
and keep editing, then create a folder on isolated Moto. In compact settings,
verify **Apply** updates only the draft and **Cancel** retains the existing close
confirmation. Long translated action labels must wrap within the dialog, with
44px touch targets. No action may run when merely opening a confirmation.

## Shared confirmation content

`ConfirmActionDialog` owns compact presentation for direct callers, action hooks
and draft guards in every workspace. Titles use 14px, body text and resource
values 13px, and buttons 12px with 28px desktop / 44px touch targets. Settings
body typography excludes buttons so it cannot override their shared scale.
Resource details use aligned label/value rows; impacts and optional warnings
retain their distinct content and meaning. Names, ARNs and rich warning text
wrap without horizontal body scrolling, including inside nested dialogs.

The shared description is associated with the dialog. Loading disables Close,
Cancel, Escape and backdrop dismissal, as well as the confirmation action.
Callers still own the request, error recovery and programmatic completion;
`confirmDisabled` alone keeps cancellation available. Labels, translations,
details, impacts, widths and execution contexts remain caller-owned.

The settings-only confirmation wrapper is removed. Settings callers now import
`ConfirmActionDialog`; profile adapters retain translation injection and
`useSettingsCloseGuard` retains its layer ordering without a duplicate wrapper.

Validation: `npm run check` passed with 2,491 tests across 450 files. Thirty
component browser scenarios exercise simple, detailed, translated, nested and
primary-tone confirmations in both themes, at desktop/mobile widths, 320px and
667 x 280 landscape. Sixteen routed fixture cases cover Admin authentication
settings, Manager IAM group deletion, the Ceph Admin Browser warning and French
Portal session revocation. They check cancellation without mutation, pending
closure, exact targets and failure/retry behavior. Fixture requests do not prove
live storage or identity-provider operations.

## Managed private access dialogs

The IAM and RGW-user private-access variants use `SettingsDialog`, compact
`SettingsSection` rows, canonical labelled fields and `ModalActions`. Advanced
configuration remains collapsed by default. Long group/policy names wrap;
saved inline policies retain their explicit Add/Remove workflow and unique-name,
JSON-object validation. Browser access and the IAM AmazonS3FullAccess default
remain unchanged, as do backend availability gates and secret handling.

Connection-name, inline-policy and workspace-choice errors are associated with
their fields and receive focus. Hidden workspace errors reopen advanced
configuration. The shared access-choice component associates help and errors
with both checkboxes; one grid spacing contract avoids stacked margins in
compact forms. API failures remain operation errors and preserve the draft.

All dismissal paths protect changes, including an inline policy not yet added
to the request. Reverting to defaults permits clean cancellation. A pending
request freezes the form and dismissal; Enter submits once, and failure permits
an identical retry. IAM and RGW-user requests retain their distinct payloads and
explicit account/user execution contexts.

A short private-access dialog keeps the IAM list underneath it, allowing focus
to return to its trigger. Only the full user-creation workflow replaces that
list. Compact settings and confirmation styling now sits directly on the
`Modal` surface through its root class, without an extra wrapper that an active
workflow host could hide. Existing widths, focus trapping and nested layers
remain owned by `Modal`.

Validation uses the two routed documentary fixtures in both themes, desktop,
390px, 320px and short landscape viewports. Exercise clean/dirty cancellation,
all dismissal paths, local validation, exact default/custom payloads, pending
controls and failure/retry. A component matrix places simple, detailed,
translated and nested dialogs inside active workflow hosts to check visibility,
viewport bounds and focus. These checks simulate provisioning; they do not
create live IAM identities, RGW keys or private connections.

Delivery checks: 2,499 tests passed in the full frontend check; the final
45 targeted tests and `npm run check:ci` also passed. All 12 routed scenarios
and 30 workflow-host composition scenarios passed.

## Connection endpoint forms

Adding an existing key as a private S3 connection uses `SettingsDialog`, compact
`SettingsSection` rows, canonical fields and `ModalActions`. The shared endpoint
section applies the same labelled controls, source choices and responsive layout
to Admin shared connections and profile private connections. Owner metadata wraps
within the available width. Desktop controls stay compact; touch layouts retain
44px targets.

The key-import form initializes its draft synchronously on opening or changing
the source, so an initialization effect cannot overwrite the first edit. Dirty
tracking includes only active, saveable fields. A locked endpoint does not load
the catalogue or create a false discard warning; returning to the original
preset ignores inactive custom-field edits.

A requested preset remains selected while the catalogue loads or fails. If it
is unavailable, the form explains the problem and requires an explicit endpoint
choice; a catalogue refresh never silently redirects the connection to another
endpoint. Name, endpoint and workspace-access errors are associated with their
fields and focus the first invalid control. Submission freezes the draft and
all dismissal paths; a failed request preserves values for an identical retry.

Existing endpoint-ID precedence, custom endpoint fields, workspace flags, owner
metadata and supplied-key payloads are preserved. The UI uses the existing
private-connection permission checks and does not create a parallel grant.

Validation: 81 targeted tests and `npm run check:ci` passed. Twenty-eight
component scenarios cover fixed ID/URL, custom, delayed, unavailable and failed
catalogues, validation, immediate editing, pending requests and retries. Thirty
routed scenarios exercise Ceph Admin user creation/key management, Admin shared
connection creation/editing and profile private connection creation/editing.
Both matrices cover desktop/mobile and light/dark, including 320px and short
landscape component layouts. These fixtures validate rendering and request
payloads with synthetic keys; they do not create live RGW users, keys or S3
connections.

## Shared and private connection editors

Admin shared-connection and profile private-connection creation/editing use
`SettingsForm` and compact, unframed `SettingsSection` rows. Identity and tag
fields share `S3ConnectionIdentityFields`; endpoint and credential fields retain
their existing shared components. The Admin editor keeps its General, Linked UI
users and Linked UI groups tabs, with one save boundary for metadata, credentials
and associations. Profile editing retains server-managed and revoked-grant
restrictions while allowing the existing name, tags and workspace-access edits.

The payload model identifies the field responsible for each local error.
`useS3ConnectionFormValidation` associates those errors without duplicating the
payload rules, preserves native URL validation and focuses the first invalid
field. Admin validation returns to General when its fields are hidden behind an
association tab. Credential diagnostics remain advisory and do not disable
saving. Existing secret handling, endpoint-ID precedence and payloads remain
unchanged.

Endpoint mode changes happen on opening or explicit selection. A late catalogue
response does not replace an existing preset or create an untouched draft, and
selecting a preset preserves inactive custom-field values. Pending submissions
freeze the full form, association tabs, tag controls and return actions. A failed
request retains the draft for an identical retry. The shared workflow return
breadcrumb prevents native navigation and delegates to its close guard; a busy
return cannot bypass that guard.

Settings tag editors align with compact fields. Long tags stay within their
available width, retaining the full accessible label and tooltip. Edit/remove
buttons keep compact desktop geometry and 44px touch targets. A disabled editor
closes its portal controls so they cannot mutate a submitted draft.

Validation: the complete frontend suite passed with 2,511 tests across 450 files;
the final 71 targeted tests and `npm run check:ci` also passed. Thirty routed
fixture cases cover the four editors plus server-managed and revoked-grant
private editing, desktop/mobile, light/dark and 320px. They check field errors,
association payloads, tags, keyboard submission, pending guards and failure/retry.
Very long tags cause no horizontal form overflow; 54 start/middle/end scroll
measurements report a zero-pixel gap below the sticky action bar. All requests
use synthetic fixture data, without creating live connections or rotating keys.

## Shared short-form fields

API token name/expiry and Browser bucket/folder creation now use `UiInput`;
the SSE-C input composes `UiField` with its visibility button. Labels, help and
validation descriptions use the same association contract. API token fields no
longer depend on placeholders for accessible names. Bucket name validation
retains its rules and disabled action, with the error attached to the field.
Operational failures remain separate alerts rather than falsely marking a name
invalid. Browser folder keys and SSE-C handling retain their existing semantics.

`UiField` merges descriptions supplied by callers with its help/error IDs.
`UiInput`, `UiSelect` and `UiTextarea` preserve that merged result; a real field
error cannot be hidden by a caller's `aria-invalid={false}`. Invalid controls
share the semantic danger border, and modal controls keep 44px touch targets.

Validate bucket input with an invalid two-character name, correct it, and verify
the error association clears and Create becomes available. Check native token
required/minimum validation and SSE-C visibility without storing a key. Exercise
the same rendered forms in light/dark and desktop/mobile layouts.

## Inventory column selection

`ColumnVisibilityMenu` now owns the picker for Ceph accounts/users/buckets,
Storage Ops buckets and Manager buckets. Four local visibility/dismissal wrappers
and Manager's duplicate picker markup are removed. The single neutral Reset
action stays inside the picker and is disabled at defaults. Existing column IDs,
workspace availability, persistence and lazy feature loading remain with their
owners. Labels wrap and mobile/coarse-pointer checkbox targets reach 44px.

The non-modal dialog renders outside table clipping, fits the viewport and has
one scrolling surface. Its Reset/Close header stays visible while scrolling,
so touch users can close even when the panel fills the screen. Opening focuses
the first available checkbox; Close/Escape restores the trigger. Moving focus or
clicking outside dismisses without taking focus from the destination. The shared anchored primitive observes
content size changes so expanding details can reposition the panel, and clamps
its minimum width even when the anchor is wider than the viewport.

Validate the five inventories with documentary API fixtures in both themes at
1440 × 900 and 390 × 844, plus 320 × 568, a shallow 667 × 280 viewport and
a coarse pointer at desktop width (35 combinations). Open Columns with
the keyboard, toggle a column, expand details where available, reach the final
checkbox by scrolling, reset and dismiss. Verify geometry again after expansion
and resizing while open. These fixture checks cover presentation and interaction,
not authenticated Ceph/Manager storage operations.

## Inventory action menus

Ceph accounts/users now keep Configure visible as their declared default row
action. Owner navigation and deletion use `UiActionMenu` with resource-specific
accessible names. Their two native `details` popovers and manual DOM-closing
handlers are removed, along with the unused menu-class alias. The active RGW
identity still cannot delete itself; its reason is visible in the menu.

The shared action menu also serves Ceph/Storage Ops bucket rows and selections.
All menu items now share listing typography, spacing, semantic danger color and
touch targets, independently of the trigger class. Tall menus scroll inside the
viewport with Close kept visible. Focus moves through enabled items with arrows,
Home and End; Escape/Close returns to the trigger. Tab leaves from the trigger's
position in the page. Selecting an action restores that focus before opening a
dialog, so closing the dialog returns to an existing control.

Validate row menus and selected-bucket menus with documentary fixtures in both
themes, mobile/narrow/shallow viewports and desktop touch input. Check the final
item and Close after scrolling, keyboard dismissal and menu-to-dialog focus.
For Ceph owners, retain the account ID or exact tenant-qualified user identity
in bucket navigation. Opening and cancelling confirmations must issue no storage
mutation. These checks cover UI behavior, not live RGW execution.

## Export dialogs

Ceph/Storage Ops selection exports and Ceph configuration backups share
`ModalOptions` for their native format actions and checkbox choices. Options
use theme tokens, compact typography and wrapping labels, with 44px touch
targets. Backup choices have a named fieldset; unavailable reasons stay visible.
The selection export includes a final Cancel action using `ModalActions`.
Choosing Text, CSV or JSON still exports immediately and retains selected bucket
identities and visible columns.

Portal raw access-log exports reuse `UiInput`, `UiSelect` and `ModalActions`.
The date and storage-space labels remain associated with their fields, and
Close joins the existing English/French/German translations. Date validation,
account/space scope, timezone, progress and download behavior stay with the page.

Validate selection exports in both bucket workspaces, configuration backup in
Ceph Admin, and Portal exports in all three languages. Check both themes at
1440 × 900 and 390 × 844, a shallow 667 × 280 viewport and desktop touch input.
Verify wrapping, final action reachability, Cancel/Escape focus restoration,
empty backup selection, invalid date ranges and downloaded fixture contents.
Documentary API fixtures prove UI behavior and request shape, not live storage
access or the contents of real exports.

## Portal project loading and history links

The shared Portal account context stays loading until the account catalogue is
loaded and the selected project agrees with the URL accepted by the router.
Pages no longer treat this intermediate state as a missing project or missing
permissions. Existing URL priority, per-tab selection and unsaved-change guards
remain authoritative; failed or empty catalogues still reach their error/empty
state.

`usePortalWorkspaceData` associates project state and errors with the account
that requested them. Switching projects hides the previous state's permissions
immediately and ignores late responses. History waits for the current project's
state before selecting or discarding `view=access` and fetching access logs.
Pending or failed state loads retain the requested URL. A confirmed member role
or disabled logging still returns to Activity without fetching access logs.

Validate fresh History links with and without `project`, an invalid project
fallback, delayed catalogue/state responses, member and logging-disabled
projects, empty/failed catalogues, and a failed state request followed by reload.
Switch between two manager projects and then a member project using the topbar.
Verify that the URL, selected tab and log request account agree. Unit tests cover
router acceptance, settled empty/error states and late asynchronous failures;
documentary browser fixtures check the rendered transitions and request scopes.

## Bucket maintenance setup and progress

Usage calculation, integrity checks and purge workflows share
`BucketOperationSetup` and `BucketOperationProgress` in Ceph Admin, Storage Ops,
and their existing Manager consumers. The setup owns context/action alignment
and compact fields: 28px controls and 12px text on desktop, with 44px touch
controls below 1024px or with a coarse pointer. Native field labels use normal
case; HEAD/GET remains a named choice group. Options wrap into fewer columns on
narrow screens without squeezing the date or confirmation fields.

Progress tracks, scope labels and summary separators use theme tokens. Long
bucket names wrap. `UiProgressBar` accepts `null` for an indeterminate total,
omits `aria-valuenow` in that state and respects reduced motion. Usage and
integrity no longer substitute 100% when their denominator is unknown; purge
retains its discovered-total cap and exact destructive confirmation.

Validate the three operations in Ceph Admin and Storage Ops, plus Manager
integrity and purge, in light/dark themes at 1440px and 390px. Check selection,
HEAD/GET restrictions, invalid/exact purge confirmation, disabled controls while
running, cancellation, rerun, final progress and explicit target payloads using
documentary fixtures. Unit tests cover determinate/indeterminate progress and
existing execution contracts. These checks do not execute real storage work.

## Bucket maintenance results

Integrity and purge results share `BucketOperationResult` and
`BucketOperationFailures`. Native disclosures keep their keyboard behavior,
visible focus and open-state chevron. Bucket/context identities wrap, status
badges keep their meaning, and `InlineSummary` groups metrics without fixed
column widths. This contract applies to their existing Manager, Ceph Admin and
Storage Ops consumers.

Error samples use one intrinsically sized `ui-data-table` inside a named,
keyboard-focusable scroll area. Headers stay on one line; target, version and
message columns keep minimum readable widths. Stage, target, version, message
and purge counts remain complete. Partial samples keep their warning; an empty sample with a
positive error count explicitly says details are unavailable, while a bucket
with no errors retains its error-free message.

Integrity result search, status/error filters, reset and count use `ListToolbar`,
`ToolbarSearchInput`, labeled `UiSelect` and `ListActionButton`. Reset is disabled
without an active filter. The filter predicate and data scope remain unchanged.

Validate all six workspace/operation combinations in both themes at desktop and
mobile sizes, plus 1024px and 320px. Exercise Enter/Space disclosure, visible
focus, nested table scrolling, long identities/object keys/versions, partial and
missing samples, error-free results, object search, status/error filters, empty
results and reset. Use documentary fixtures; retain the existing execution tests.

## Manager SNS forms

Topic creation uses `UiInput` and `ModalActions`. The attributes and policy
workflow pages reuse compact `SettingsSection`, canonical fields,
`SettingsButton` and `WorkflowActions`. Attribute rows retain stable draft IDs;
their visible labels and numbered accessible names identify each name/value
pair and removal action. TLS help is associated with its checkbox.

The policy editor has sixteen visible rows independently of compact control
height. Missing-name and JSON syntax errors describe their field and clear when
it is edited; storage/API failures remain operation errors. One serialized
example supplies both the displayed JSON and
the inserted draft, retaining the current topic ARN. Loading/saving disables
draft changes, including example insertion. Creation blocks modal dismissal
while pending; workflow draft guards retain their existing return behavior.

Validate creation, attributes and policy in both themes at 1440px and 390px,
plus 320px. Use documentary fixtures with long names/ARNs. Check empty-name,
duplicate-attribute and JSON validation, draft retention, row removal, structured
attribute values, the TLS flag, pending requests, failure/retry and clean close
after save. Verify the selected execution context and exact topic ARN in the
requests. These checks do not exercise real SNS mutations.

## Bucket comparison setup

Manager and Ceph Admin use one `BucketCompareSetup` for comparison scope,
parallelism, modified-after cutoff, mapping mode and configuration features.
The workspace supplies its endpoint/context selector, execution actions and
manual mapping state. `BucketOperationSetup` owns compact control geometry and
the source/action header; feature choices use two columns on narrow screens.

Configuration and raw-mapping disclosures retain native keyboard behavior and
visible markers. The raw editor uses a labeled `UiTextarea` with format help and
parse feedback. Every target input names its source bucket. The intrinsic mapping
table has a named, focusable scrolling region and readable minimum column widths.
Raw entries remain authoritative over per-row choices; same-target exclusions,
fallback mappings and parser behavior remain in the existing shared model.

Both workflows use `BucketCompareProgress` and the common operation progress
presentation. Settled Ceph comparisons now say **Completed**, matching Manager.
Run, stop and export remain connected to each workspace's existing handlers.

Validate both routes with documentary fixtures in light/dark at 1440px and
390px, plus 320px. Exercise same-target restrictions, name/manual mappings,
invalid/authoritative raw entries, empty scope/features, cutoff and feature
payloads, frozen options during execution, stop, failure and retry. Check the
source and target identities in every request and the final progress state.
These checks do not run real bucket comparisons or Manager remediation.

## Bucket comparison results

`BucketCompareResults` shares the result toolbar, bucket-pair summary and nested
disclosures between Ceph Admin and Manager. Search/status/difference controls
use the listing primitives with accessible labels; Reset is disabled at defaults.
Pair identities wrap, counts use `InlineSummary` and badges/actions use the
listing presentation. Root and nested disclosures have visible chevrons,
keyboard focus and touch targets, while retaining their initial collapsed state.

Pair progress is indeterminate while its request runs, rather than displaying a
fixed 45%. Pending pairs show zero and settled pairs show complete processing;
the status badge still distinguishes failure, cancellation and differences.
The aggregate mapping progress remains determinate.

Ceph Browser-navigation and Manager remediation confirmations use `ModalActions`.
Manager identities wrap and confirmations retain the exact visible-key scope and
destructive warning. Workspace navigation and remediation authority remain with
their original handlers.

Validate both workspaces with documentary fixtures in both themes at 1440px and
390px, plus 320px. Check pending progress, failed/identical/different results,
combined filters, empty matches and reset. Open nested content/configuration
sections with keyboard input, check long names and object keys, and verify that
copy/remediation controls retain the displayed sample when a diff is truncated.
Open and cancel each workspace's confirmation without triggering navigation or
remediation. These checks do not execute live storage operations.

### Object metadata panels

`BucketCompareObjectDetails` owns the shared object rows and metadata panel for
Ceph Admin and Manager comparisons. It uses the anchored portal and dismissible
layer primitives, keeping the panel inside the viewport and outside result-list
clipping. The sticky Close action remains reachable in short viewports. Object
keys, including significant spaces, and full ETags wrap without losing their
contents; missing metadata retains its explicit placeholder.

Opening focuses the non-modal panel. Escape/Close returns to the object; Tab
leaves from that object's position, and outside interaction keeps its destination
focus. Starting a panel action restores the persistent object trigger before
dispatch, so cancelling a following confirmation can return to it. Manager
Browser links remain native links to a separate tab using `ListActionAnchor`,
and Browser-disabled reasons remain visible. Workspace navigation, download,
remediation and exact-key callbacks keep their owners.

Validate both workspaces with documentary API fixtures in both themes at desktop
and mobile widths, plus a 320px viewport, short landscape viewport and desktop
touch input. Open with Enter, close with Escape/Close, Tab in both directions,
click outside, and open/cancel the workspace confirmation. Check full object
keys/ETags, viewport bounds, scrolling, action targets and restored focus. These
checks exercise presentation and mocked requests, not live storage operations.

## RGW Admin Ops dialogs

Account/user/bucket deletion, bucket link/unlink and index checks reuse
`ModalActions`, `ModalOptions`, canonical fields, `InlineSummary` and semantic
messages/badges. The shared `modal-disclosure` keeps native keyboard behavior
and visible focus for advanced options. Long target identities and confirmation
instructions wrap; the raw RGW response has a named, focusable scrolling region.

Destructive operations retain their exact confirmation phrase and purge/fix
dependencies. Phrase errors describe the field; API failures remain operation
errors. All execution options and dismissal paths are disabled during a request,
then become available after failure. Settled options remain editable so a
read-only index check can be followed by an explicitly confirmed repair.
Link target changes immediately hide the previous catalogue during debounce and
loading; unavailable account support remains visible with its capability reason.

The shared `UiInput`, `UiSelect` and `UiTextarea` compact size now owns its
typography explicitly, preventing the standard control class from overriding
it. Compact controls use 12px text and a 28px minimum height, with 44px targets
on mobile or coarse pointers. Textareas retain their requested rows; standard
field sizing is unchanged.

Validate all eight operation/target variants with documentary API fixtures in
both themes at 1440px and 390px, plus deletion and account linking at 320px and
667×280px. Check exact phrases, pending controls and dismissal, structured
failure/retry/success, and unchanged target/tenant/options across retries.
Check shared compact input/select/textarea consumers in Ceph user creation and
the Manager topic list, including the standard topic-creation field. These
checks do not execute live RGW or SNS mutations.

## Bucket list scrolling

Ceph Admin and Storage Ops share the `BucketOpsTable` scroll region. Selection
and name columns stay pinned only when the region is at least 640px wide,
leaving space for data columns to scroll beside the identity. Below that width,
all columns scroll together so the name cannot cover statistics or row actions.
The decision follows the actual table container width, including sidebar and
page padding, rather than the window width. Native intrinsic table sizing and
the user's visible-column choices remain intact.

One CSS contract owns the pinned-cell layers and theme backgrounds. The named
Bucket list region accepts keyboard focus with a visible inset outline and
native horizontal scrolling; it leaves the tab order while the advanced filter
drawer is open.

Validate both workspaces with documentary fixtures and long bucket names in
both themes at 320px, 390px, 1024px and 1440px. Check widths immediately below
and above the 640px container threshold, plus a short landscape viewport.
Scroll to the final columns, open actions with a real pointer click, dismiss
with Escape and verify restored focus. Confirm keyboard scrolling, selection
retention, sorting, and pinned identities where there is sufficient space.
In Ceph Admin, open and cancel an index-check dialog from the scrolled row;
no live storage operations are needed for this presentation check.

## RGW user forms and quota fields

User creation and the Ceph Admin configuration tab share profile, flags and
capability fields through `CephAdminUserFormFields`. Compact `SettingsSection`
and `WorkflowActions` replace local section cards and action geometry. UID,
account/tenant selection and initial key generation remain creation fields;
default placement and storage class remain configuration fields. Other editor
tabs retain their own workflows.

One parser deduplicates capabilities and one validator handles non-negative
integer limits and storage sizes. Invalid fields receive associated messages
after submission; correcting a value clears its error, and submitting an
invalid form focuses the first error. API failures remain form-level feedback.
The tenant stays editable when an account is selected, allowing the existing
mutual-exclusion error to be corrected without discarding the draft. Creation
still derives account-root status from an explicit account selection.

Native forms support Enter submission. A disabled fieldset freezes the submitted
draft until the request settles, while existing close guards block departure.
Configuration requires successfully loaded details. Retries retain the same
endpoint, tenant and payload; quota patching retains its existing omission and
explicit-null semantics. Generated credentials keep the existing
one-time panel and S3 Connection permission guard.

`CephAdminQuotaFields` uses the same compact section and field contract in user
and account creation/configuration, including the unit selector. Account quota
and default bucket quota retain independent controls and API fields.

Account creation and configuration also share `CephAdminAccountFormFields` for
identity and the five resource limits. Both use compact `SettingsSection` fields
and the canonical `SettingsActionBar`, including its bottom-aligned sticky
behavior. Empty creation limits defer to cluster defaults; empty configuration
limits retain the existing explicit-clear contract. Account and user forms use
one quota validator. Account errors appear beside each field, clear as values
are corrected or quotas disabled, and receive focus on invalid submission.
Native Enter submission, frozen pending drafts and detail-load guards apply to
account forms too. A failed save retains the draft and permits an identical
retry; unchanged quotas remain omitted from configuration requests.

Validate the four user/account forms with documentary API fixtures in both
themes at 1440px and 390px, plus 320px. Check long identities, quota units and
disabled quota fields, errors and focus, Enter submission, frozen drafts,
failure/retry/success, exact payloads and clean return after saving. Check the
one-time panel with synthetic credentials only; cancel account quota drafts
through the existing discard confirmation. These checks do not create users,
change account rights or apply quotas on a live RGW service.

## Exact quota form values

The shared quota conversion and unit catalogue serve RGW user, account and
default bucket quota forms. Existing limits use the largest exact integer
MiB/GiB/TiB value, or Bytes when those units would require rounding. A numeric
zero remains distinct from an empty field. Reject byte conversions that
overflow to infinity; do not silently serialize them as null.

Saving another profile field omits unchanged quotas. Disabling a quota sends
only its enabled flag, preserving RGW's stored limits; disabled input values
do not request a limit change. Clearing an enabled quota still sends explicit
nulls through the existing API contract. Account and default bucket quotas
keep separate patches. The detail API currently normalizes disabled and zero
limits to null; this presentation change does not alter that normalization.

Validate exact byte values, zero, omission, explicit clearing, disabling and
reenabling in both editors, using documentary API fixtures and captured
requests in light/dark desktop and narrow layouts. These checks prove form
behavior and request payloads, not live RGW enforcement. Conversion precision
is bounded by the existing JavaScript numeric API representation.

## Admin dashboard — completed

The Admin overview now starts with endpoint health and incidents, followed by
full-width storage/traffic and one administrative counter band. The map stays
visible in the secondary activity/geography row. Enabled feature groups use a
single restrained panel. Monitoring names, timestamps and audit descriptions
wrap, while empty chart placeholders and competing mini-cards are removed.
The onboarding checklist and all existing navigation destinations remain.

The shared dashboard kit provides explicitly adopted compact panels and
actions, summary links, grouped features and compact incidents/statuses.
Admin data requests, role-scoped counts, health windows and refresh boundaries
are unchanged. Missing/error values are explained locally without fake zeroes.

Validation combines component tests, the Admin dashboard visual fixtures
(light/dark, custom primary color, mobile, 200% reflow and touch), and the
isolated authenticated Admin/Browser harness. Fixtures and Moto are not proof
of successful Ceph monitoring or live cluster metrics.

## Other dashboards — visual convergence completed

Manager and Portal share compact KPI, storage, panel and action presentation.
All existing blocks, repeated metrics, graph data, list limits and destinations
remain in their original order. Long names and timestamps wrap. Ceph Admin
keeps health, conditional incidents and four navigation cards; Storage Ops
keeps its single context summary. Neither gains new dashboard content.

`WorkspaceDashboardStorageOverview` is presentation-only. Page adapters retain
calculations, translations and unavailable-state decisions. Health, navigation
and data-type cards opt into compact styling without changing other consumers.
The dedicated dashboard presentation fixtures cover the four routes, light/dark,
custom color, mobile/coarse pointer, 200% reflow, Portal's existing three languages
and long text. Fixture data and the isolated Admin/Browser Moto harness do not
prove live Manager, Portal or Ceph workflows against an RGW cluster.

Delivery checks: `npm run check` passed (448 frontend files, 2,457 tests),
117 browser fixture scenarios passed across the dashboard and workspace suites,
and the isolated Admin/Browser harness passed 11 authenticated checks. Eight
documentation images were generated; the screenshot reference check passed.
The final lint, typecheck, dead-code, build, chunk and bundle checks also passed.

## IAM policy draft panels

User, group and role creation share compact managed-policy selection and inline
policy draft sections through `ManagedPolicySelectionPanel` and
`InlinePolicyDraftEditor`. Both use `SettingsSection`, `SettingsButton` and
canonical labelled controls. The JSON editor spans the content width; saved
drafts remain visible above it, with wrapping names and a pressed selection
state. Replacement warnings are associated with the draft-name field.

Disclosure controls expose their expanded state and controlled content. Closing
a section preserves its selection, search and draft. Searches by name or ARN
retain selected policies outside the current results. Draft save, replacement,
rename, removal and clearing retain their existing local behavior and must not
submit the entity form. API ownership and IAM permission semantics remain with
the three parent pages.

Validate all three routed creation forms in both themes at desktop and mobile
widths, including long policy names, collapsed states, keyboard toggles,
replacement, cancellation and exact creation/attachment payloads. Use fixture
responses to exercise failure and retry without creating live IAM identities.

## IAM entity forms

User, group and role creation, plus role editing, use the native `SettingsForm`
and compact `SettingsSection` layout. Their identity fields, optional group
selection, policy panels and action footer share the settings control contract.
`ManagerRoleFormFields` owns the common identity and trust-policy presentation
for role creation and editing.

Required names and invalid trust-policy JSON produce field-associated errors,
focus the first invalid field and clear as the input is corrected. JSON parsing
checks syntax only; IAM policy semantics remain server-owned. While a request
or a subsequent policy attachment is pending, the draft and dismissal controls
are disabled. Native Enter submission, failure recovery and retries preserve
the selected execution context, key-generation default and attachment order.

Role names and paths are read-only during editing because IAM identity is fixed
at creation. Role updates send only the trust policy; creation retains the
existing optional path behavior. Long page titles wrap in the shared
`PageHeader` so they cannot introduce a horizontal scrollbar that raises the
sticky action footer above the bottom of the main scroll area.

Validation: 36 targeted tests and `npm run check:ci` passed. Twenty routed
browser fixture cases cover all four forms at 1440 px and 390 px in both themes,
plus 320 px in dark mode. They check validation, pending drafts, cancellation,
failure/retry payloads and long identifiers. Footer checks at the start, middle
and end of scrolling report no bottom gap or horizontal overflow. These fixtures
validate rendered behavior and requests, not live IAM mutations against RGW.

## IAM policy configuration

Managed-policy creation uses `SettingsForm` with compact identity and JSON
sections. Existing user, group and role policies use the same compact section
layout: the inline editor and attached-policy inventory occupy the available
content width instead of competing in two columns. Managed-policy attachment
has a visible field label and shared controls. Inline saving and managed
attachment remain independent operations; only the creation workflow uses a
sticky page footer.

`InlinePolicyChoice` owns the wrapping policy identity, summary and pressed
selection state for both creation drafts and persisted inline policies. The
inline editor associates name and JSON errors with their fields, focuses the
first error, and freezes its controls throughout save/delete and reload.
Selection, creation, cancellation and refresh protect unsaved local edits with
the shared discard confirmation. Replacement warnings remain associated with
the name field, and deletion retains its explicit policy/impact confirmation.

The inline loader callback is stable across managed-policy operations so a
parent refresh or attachment cannot reset the inline draft. Request context,
replacement semantics and policy documents remain unchanged: renaming a
persisted policy saves another policy without removing its source; blank inline
JSON still means an empty document, while managed-policy creation requires
valid JSON. IAM permission semantics remain server-owned.

Long breadcrumb segments wrap through `PageHeader`, retaining the complete
entity name without introducing horizontal page scrolling. Validation includes
43 targeted tests, `npm run check:ci`, and 20 routed browser fixture cases across
the four screens at desktop/mobile widths in both themes, including 320 px.
The fixtures exercise exact payloads, field errors, pending and duplicate
submissions, failure/retry, replacement, blank JSON and confirmed deletion.
They provide rendered/request evidence without performing live IAM mutations.

## Object configuration drawers

Browser Properties, Access & Protection and Archive now share the compact
settings layout and `SettingsOperationSection`. Standard/custom metadata share
one explicit save action; the other native S3 operations keep independent forms.
The shared object facts and Standard profile's read-only details use the same
section layout, without exposing edit actions in the read-only profile.
Native Enter submission, labels, pending locks and duplicate-submission handling
are centralized. Loading and Object Lock capability messages remain readable.
The read-only properties retry is outside the editing lock. Signed URLs and
required headers have named, selectable read-only fields in both themes.
The unused Browser input-style alias and the local editable-pair card layout are
removed.

Validate the advanced object drawer in desktop/mobile and light/dark layouts,
including long metadata/tag values, loading and unavailable protection. Check
independent submission, pending controls, keyboard use and failed-read retry.
Use isolated Moto for authenticated Browser navigation; fixture-only archive or
Object Lock cases do not establish live provider behavior.

Object property drafts now keep separate metadata, tag and storage-class
baselines. Successful writes accept only the submitted section, while refresh
updates clean sections and preserves unrelated or newer local edits. Each dirty
section is marked with the shared unsaved badge. Subsequent saves use the latest
observed VersionId and explicit workspace/account context.

A failed post-write read retains the drafts and close guard, disables mutation
against a stale version, and requires an explicit read retry. Retrying the read
does not repeat the write. A shared pending-operation boundary rejects duplicate
or competing section saves and ignores completion after a scope reset.
`prepareS3Tags` is shared by object and Manager/Ceph Admin bucket editors: literal
keys/values (including whitespace-only keys) are preserved; missing keys with a
value and exact duplicate keys are rejected before any request.

## Admin storage endpoint editor

Create, edit and view reuse `StorageEndpointEditor`, `SettingsForm` and
`useSettingsFormController`. Connection, Credentials and Capabilities & health
are domain-specific field compositions built from compact `SettingsSection`,
`SettingsItem`, canonical fields, named provider choices and `SettingsSwitch`.
Credential fields share presentation while retaining three separate purposes;
operational command examples remain visible. Local card and toggle styling has
been removed from the page.

`buildStorageEndpointSubmission` owns field validation and existing payload
normalization. Errors reveal the relevant tab and focus the first invalid field.
One pending boundary locks native fields, tags and their portal menu, tabs,
dismissal and router departures. Accepted navigation preserves its destination,
including another endpoint and browser history. Opening the next endpoint uses
a new controller instance; the old target is never changed before acceptance.

Configuration and tag baselines are independent. After a successful configuration
write the form accepts the returned endpoint, clears submitted secret values,
and retains pending tags. A tag failure reports the partial result; retry only
replays outstanding changes against the saved ID, including after creation.
Unchanged tags/configuration do not cause redundant API writes. Environment and
protected configurations remain read-only; only superadmins can edit their tags.
Metadata failures still prevent mutation. Advisory Ceph detection ignores stale
responses during saving; provider constraints and stored-secret semantics remain
in the domain model.

`StorageEndpointsPage.tags.test.tsx` covers provider and credential behavior,
field focus across tabs, frozen pending drafts, failure/retry, tags-only and
partial saves, router/history destinations and access modes. Browser validation
must cover all tabs, mobile/desktop, both themes, keyboard submission and close
confirmation. Isolated Moto proves authenticated UI/API flows; fixture Ceph
responses do not prove live RGW access or capabilities.

## Admin authentication provider editors

OIDC and LDAP creation, editing and consultation use `SettingsWorkflowForm`
with compact `SettingsSection` rows, canonical fields and one sticky action
area. Identity and Connection are shared section patterns; OIDC then groups
sign-in options, protocol security and identity linking, while LDAP separates
user search, identity mapping and transport security. The providers keep their
own API adapters and payloads.

`AuthProviderIdentityFields`, `AuthProviderSecretField` and `AuthProviderToggle`
centralize labels, switches, stored-secret output and accessible lock-source
help. Preserve API field names for environment locks, including scopes and
domain text adapters. A locked secret has no password input or clearing action;
an editable replacement is empty and explains whether a secret is stored.
OIDC clearing remains an explicit checkbox acknowledgement. LDAP anonymous
search, stored-password preservation/removal, TLS compatibility options and
mapping fields retain their existing semantics. Timeout validation matches
the backend's greater-than-zero and 60-second maximum bounds.

Each provider ID/type owns a separate draft. Failed or missing reads expose
Retry without editable fallback values. Submission errors and cancelled
passkey verification keep the draft; pending writes and verification lock
fields, repeated submissions, close controls and navigation. Discarding
preserves the requested router/history destination. Successful saves clear
the secret-bearing draft and unmount the guard before returning to the list.
Provider saves do not update global authentication policy.

Regression coverage in `AuthenticationSettingsPage.test.tsx` includes field
locks, hidden/stored secrets, independent payloads, native Enter submission,
failed-read retry, draft retention, router/history guards, timeout focus and
explicit WebAuthn verification with one retry. `SettingsWorkflowForm.test.tsx`
also checks consultation without submission or an unnecessary discard prompt.

Browser validation covers 28 create/edit/view cases in both themes at desktop
and mobile widths, including 1024px creation, with top/end captures and sticky
footer checks during scrolling. Edit/view visual cases use API fixtures,
including long environment-lock sources. A separate authenticated isolated
backend flow creates each provider (201), edits it (200), reloads persisted
values and verifies secret preservation plus draft navigation. These checks
do not establish login against an external LDAP directory or OIDC provider.
Temporary screenshots, scripts and authentication state remain outside commits.

## Admin RGW account configuration

`AdminAccountEditor` owns a keyed account draft and its read/retry lifecycle,
leaving listing, creation, import and deletion in `AccountsPage`. General,
linked users, linked groups, privileged access and Portal settings share the
compact workflow presentation. General uses side-title settings sections for
tags, observed usage and quotas; `InlineSummary` preserves unknown versus zero
usage and shows the saved limits separately from editable quota values.
Inactive tab wrappers must retain native `hidden` behavior: put grid/flex
presentation inside the wrapper rather than overriding its display rule.

`AdminAccountAssociations` shares the user/group table and picker while explicit
adapters preserve their API identities and grant fields. Failed catalogues
show an error and Retry, not an empty result. Selected additions survive tab
changes and participate in the account close guard; saving directs the user to
apply or cancel them first. Existing Manager and Portal roles stay independent,
including when Portal is disabled. Advanced association settings reuse the
compact draft dialog and a named switch; Apply changes only the parent draft.
Native dialog submission stops propagation to an enclosing account form.
Association tables use `DataTableShell` responsive cards below 768px so long
identities, both role controls and actions remain usable without horizontal
scrolling. Desktop rows retain the shared compact table presentation.

The account uses `SettingsForm` and `useSettingsFormController` for Enter,
pending fields, duplicate submission, close and route/reload protection.
Portal settings keep their own save/merge/conflict boundary and report dirty
and busy state to the enclosing account workflow. Either pending save locks
the account tabs and closing; a successful account save preserves an unsaved
Portal draft. Failed reads never expose an empty writable configuration,
failed writes retain drafts, and unmounted editors ignore late completion.

Permission lookups have an explicit retry. Quota editing still requires
`accounts=write`; enabling bucket quota management still requires
`buckets=write`. `adminAccountPayload` omits unchanged quotas and sends both
quota dimensions when either changes, retaining explicit clearing semantics.
The shared quota input adapter uses whole MiB only when exact and otherwise
preserves fractional GiB, avoiding rounding when an object limit is changed.

Regression scenarios cover the two association adapters, pending selections,
native submission, router history, read and permission retries, independent
Portal drafts, write failures and exact quotas. Browser validation must cover
all five tabs, the picker and advanced dialog in light/dark, desktop and mobile,
including inactive-tab visibility, sticky actions, field focus and retry.
Account and permission fixture responses validate UI contracts, not live RGW
quota enforcement or mutations. Temporary captures and auth state stay outside
commits.

Final validation for this pass covered 2,776 frontend tests across 465 files,
the full frontend CI check, and a strict MkDocs build. The authenticated
isolated-browser matrix covered all five tabs at 1440, 1024 and 390 px in light
and dark themes (52 captures), including responsive user/group role controls,
picker controls, long advanced-dialog identifiers, pending association locks,
sticky actions, retry paths and independent Portal saves. It reported no page
exceptions or root horizontal overflow. The account, permission, usage and
write responses in that browser matrix are fixtures; this pass does not prove
live RGW quota enforcement or account mutations.

## Remaining passes

- Continue adopting the shared action area in remaining short dialogs.
- Adopt canonical field labels/help in remaining legacy forms.
- Review remaining operational form sections.
- Review remaining account and bucket form sections against the compact
  settings contract, preserving each independent save boundary.
