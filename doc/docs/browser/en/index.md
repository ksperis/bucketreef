# Browser Guide

Use **Browser** for direct bucket, prefix, object, and version operations with
an explicit storage context.

## Before you start

- Browser must be enabled for your user and context.
- Select the intended private S3 connection or enabled Portal project before
  choosing a bucket.
- Storage-side S3 permissions still decide whether each operation succeeds.

## Daily workflow

1. Open `/browser` and select the storage context.
2. Choose a bucket and navigate prefixes or folders.
3. Open files for preview and details, or use row and selection actions for
   upload, download, copy, move, delete, and restore operations.
4. Use version history when the bucket has versioning enabled.
5. Check the operation status UI for long-running transfers and bulk work.

The standalone Browser may expose Standard or Advanced capabilities according
to platform settings. Embedded Browser experiences are documented by their host
workspace because their identity and available actions differ.

## Next pages

- [Getting started](getting-started/index.md)
- [Object operations](objects/operations.md)
- [Object versions](objects/versions.md)
- [Safe operations](reference/safe-operations.md)
- [Troubleshooting](help/troubleshooting.md)
