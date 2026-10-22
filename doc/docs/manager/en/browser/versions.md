# Object Versions Inside Manager

Use version history in Manager's embedded Browser when you need to inspect,
download, restore, or remove a historical object version from the active Manager
context.

## Before you start

- Keep the intended Manager context selected.
- The bucket must have versioning history to show.
- The active storage identity must be allowed to list and operate on versions.

## Steps

1. Open **Browser** from Manager and navigate to the object.
2. Open its **Versions** view.
3. Review which entry is current and whether delete markers are present.
4. Download, restore, or remove the intended version using the action beside
   that exact version identifier.
5. Refresh the object listing after a restore or delete so the current state is
   clear.

The versions drawer focuses on the exact object key and keeps each version or
delete marker next to the actions that apply to that entry.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-object-versions-browser.light.png" alt="Focused object-versions drawer with current and previous versions plus a delete marker" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-object-versions-browser.dark.png" alt="Focused object-versions drawer with current and previous versions plus a delete marker" loading="lazy">
</div>

A historical read never silently falls back to the current object if the
requested version cannot be read.

## Related pages

- [Object operations](object-operations.md)
- [Bucket configuration](../buckets/configuration.md)
- [Troubleshooting](../help/troubleshooting.md)
