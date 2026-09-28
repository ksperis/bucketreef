# Feature: Object Versions in Browser

## When to use

Use this guide when you need to inspect object history, restore a previous state, or review delete markers directly from Browser.

## Prerequisites

- Access to `/browser`, `/manager/browser`, or `/ceph-admin/browser`.
- Effective permissions for the target bucket and object.
- Versioning enabled on the bucket.

## Before you start

Open the exact bucket and object key from the intended context. Version history belongs to the bucket, not to the display row alone.

## Steps

1. Open a Browser surface and navigate to the target bucket and object.
2. Open **Versions** from the item actions.
   - On `/browser`, you can use the item `More actions` menu, the context menu, or version-aware flows triggered from deleted objects.
3. Review the entries shown in the `Versions` tab of the file details drawer.
   - Latest versions and delete markers are clearly identified.
   - Each row keeps restore and delete actions next to the corresponding version metadata.
4. Choose a version in **First version**, then **Preview version** to inspect its exact historical content in a read-only window. In Portal, use the same controls in **History**.
5. Choose a different **Second version**, then **Compare versions** to see removed and added lines. The summary includes each version's identifier, date and size. The first version is the source of removed lines; the second is the source of added lines.
6. Restore or remove the required version directly from the history tab, as a separate action with its existing confirmation.
   - If the current object state is deleted, Browser opens the details drawer directly on `Versions`.

## Expected result

You can inspect object history and act on previous versions without leaving Browser.

## You are done when

The versions tab shows the expected latest version, older versions, and delete markers, or clearly explains that no version history is available.

## If you do not see this action

Check bucket versioning, endpoint capability, the selected object state, and whether your credentials can list versions.

## Limits / feature flags

!!! note
    Browser availability depends on workspace browser flags and endpoint capabilities. The `Versions` tab is only useful when the target bucket has S3 versioning enabled.

Historical previews reuse the 50 MiB object and 64 KiB text limits. Comparison requires two distinct, non-deleted text/JSON versions, each at most 64 KiB; it never compares truncated text as if it were complete. Unknown sizes and deletion markers are excluded. Large changed sections use a bounded block diff. Reading a version still requires current access rights, including permission to read historical versions; no fallback reads the current object if access to the selected version fails. Direct, proxy and Portal downloads preserve the exact version identifier. Viewing or comparing does not restore, delete or modify either version.

## Related pages

- [Workspace: Browser](workspace-browser.md)
- [Feature: Object operations in Browser](feature-objects-browser.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-object-versions-browser.light.png" alt="Browser object versions modal showing prior versions and delete markers for a daily report" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-object-versions-browser.dark.png" alt="Browser object versions modal showing prior versions and delete markers for a daily report" loading="lazy">
</div>
