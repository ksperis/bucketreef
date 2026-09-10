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

## Remaining passes

- Continue adopting the shared action area in remaining short dialogs.
- Adopt canonical field labels/help in remaining legacy forms.
- Consolidate repeated column/export popovers in operational inventories.
- Review remaining account and bucket form sections against the compact
  settings contract, preserving each independent save boundary.
