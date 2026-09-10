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
The surrounding entity identity fields remain a separate convergence pass.

## Remaining passes

- Continue adopting the shared action area in remaining short dialogs.
- Adopt canonical field labels/help in remaining legacy forms.
- Review remaining operational form sections.
- Review remaining account and bucket form sections against the compact
  settings contract, preserving each independent save boundary.
