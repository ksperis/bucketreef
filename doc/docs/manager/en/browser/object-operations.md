# Object Operations Inside Manager

Manager can embed Browser for object work when data access is explicitly enabled
for the active Manager context.

## Execution context

The embedded Browser reuses the context already selected in Manager. It does not
ask you to choose a separate standalone Browser connection. Bucket and object
operations therefore run with the storage identity represented by that Manager
context.

For an account, embedded data access requires the account-administrator
association and the corresponding Manager Browser data-access permission. Other
context types follow their own Manager/Browser eligibility rules.

## Main tasks

1. Select the intended context in Manager.
2. Open **Browser** from Manager.
3. Choose a bucket and navigate to the required prefix.
4. Use the object actions available for that context: upload, download, preview,
   copy, move, delete, details, and versions where supported.
5. Follow long-running work from the embedded operation UI until its result is
   clear.

The visible actions depend on the Manager Browser profile, endpoint
capabilities, and storage-side S3 permissions. An `AccessDenied` response remains
a storage authorization result; Manager does not bypass it.

Standalone Browser features that depend on its own sidebar, such as personal
path favorites, are not part of the embedded Manager workflow.

## Related pages

- [Manager guide](../index.md)
- [Object versions](versions.md)
- [Feature availability](../help/feature-availability.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-objects-browser.light.png" alt="Object operations rendered inside a Manager context" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-objects-browser.dark.png" alt="Object operations rendered inside a Manager context" loading="lazy">
</div>
