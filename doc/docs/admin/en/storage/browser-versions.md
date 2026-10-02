# Object Versions from Ceph Admin

Use this page when an administrator opens object history from a Ceph Admin
Browser context.

## Before you start

- Select the correct Ceph Admin endpoint and bucket.
- Confirm that bucket versioning/history exists.
- Confirm that the administrative execution path is allowed to list and operate
  on the required versions.

## Steps

1. Open the embedded Browser from the intended Ceph Admin context.
2. Navigate to the exact object key and open **Versions**.
3. Review current and historical versions and any delete markers.
4. Download, restore, or remove only the intended version.
5. Refresh the bucket/object view and verify the post-action state.

Version operations are S3 object-history work. Use the separate RGW Admin Ops
workflows for bucket index repair, ownership changes, or administrative bucket
removal.

## Related pages

- [Object operations](browser-operations.md)
- [Ceph Admin](ceph-admin/index.md)
- [Safe operations](safe-operations.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-object-versions-browser.light.png" alt="Object version history in an administrative Browser context" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-object-versions-browser.dark.png" alt="Object version history in an administrative Browser context" loading="lazy">
</div>
