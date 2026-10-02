# Safe Browser Operations

Use this page before deleting, moving, overwriting, or transferring a large set
of objects in standalone Browser.

## Before you act

- Confirm the selected Browser context and bucket.
- Check the current path before using a selection action.
- Remember that **Select all** covers loaded items; it does not silently select
  unloaded results.
- Existing S3 keys can be replaced by a write, or receive a new current version
  when bucket versioning is enabled.

## Operations to review carefully

| Operation | What to verify |
|---|---|
| Delete | Selected object keys and whether version history can provide recovery. |
| Move | Destination path and operation result; the source is removed only after the copy passes the existing verification. |
| Copy/paste | Destination context and exact key names. |
| Upload/paste | Whether an existing key will be replaced or versioned. |
| Download as ZIP | Selected files/folders, exclusions, and the current-session operation result. |

A failed operation does not imply that every requested change was rolled back.
Refresh the listing and inspect **Operations** before retrying.

Closing or reloading Browser interrupts active transfers. Multipart uploads do
not resume after returning to the page.

## Related pages

- [Object operations](../objects/operations.md)
- [Object versions](../objects/versions.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-objects-browser.light.png" alt="Browser operations view for selected objects" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-objects-browser.dark.png" alt="Browser operations view for selected objects" loading="lazy">
</div>
