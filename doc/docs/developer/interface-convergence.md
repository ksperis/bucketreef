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

## Remaining passes

- Normalize action areas in short dialogs through a shared composition.
- Adopt canonical field labels/help in remaining legacy forms.
- Consolidate repeated column/export popovers in operational inventories.
- Review remaining account and bucket form sections against the compact
  settings contract, preserving each independent save boundary.
