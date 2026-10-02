# Start Here

Standalone Browser is for direct work with S3 buckets, prefixes, objects, and
versions through a storage context you are allowed to use.

## Your first visit

1. Open `/browser`.
2. Select the intended storage context.
3. Choose a bucket.
4. Navigate to the required prefix or folder.
5. Open an object for preview/details, or use the available actions to upload,
   download, copy, move, delete, or work with versions.
6. Watch **Operations** while transfers or bulk work are running.

Each action uses the credentials of the selected Browser context. Browser does
not grant extra S3 permissions.

## Browser contexts

Standalone Browser can expose eligible personal connections and project
contexts assigned to you. If a context is missing, check
[Feature availability](../help/feature-availability.md).

Browser rendered inside another workspace follows that workspace's identity and
help. Manager Browser, Portal file views, and Ceph Admin Browser are therefore
documented in their host guides.

## Where to continue

- [Common tasks](common-tasks.md)
- [Object operations](../objects/operations.md)
- [Object versions](../objects/versions.md)
- [Safe operations](../reference/safe-operations.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/start-here.light.png" alt="Workspace selector with Browser available" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/start-here.dark.png" alt="Workspace selector with Browser available" loading="lazy">
</div>
