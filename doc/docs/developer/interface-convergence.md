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

## Remaining passes

- Continue adopting the shared action area in remaining short dialogs.
- Adopt canonical field labels/help in remaining legacy forms.
- Review remaining export dialogs and operational form sections.
- Review remaining account and bucket form sections against the compact
  settings contract, preserving each independent save boundary.
