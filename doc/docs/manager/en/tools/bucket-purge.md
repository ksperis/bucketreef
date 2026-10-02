# Bucket Purge in Manager

Use **Tools > Purge** when you need to empty one or more buckets in the active
Manager context while keeping the buckets and their configuration.

## Prerequisites

- Bucket purge is enabled for Manager.
- Your direct or inherited Manager access includes the bucket-purge tool.
- The active execution context can delete current objects, versions, and delete
  markers in the selected buckets.

## Before you start

Purge is destructive. BucketReef does not provide an application-level undo for
objects, versions, or delete markers removed by this tool.

## Steps

1. Open **Manager > Tools > Purge**.
2. Confirm the execution context and select the target buckets.
3. Review the target summary and the effect of the operation.
4. Adjust parallelism only when necessary.
5. Type the exact confirmation phrase shown by the page.
6. Start the purge and keep the result open until completed and failed targets
   are known.

When bucket statistics are available, BucketReef can use them as an initial
progress estimate. The exact total can remain non-final while listing is still
in progress.

## Result

Purge removes current objects, historical versions, and delete markers. It keeps
the bucket itself and its configuration such as policy, lifecycle, CORS,
notifications, and versioning state.

A partial failure keeps confirmed deletion counts and reports the entries or
batches that failed. Inspect the bucket before retrying.

Deleting the bucket itself is a separate Manager bucket action. Deleting a
non-empty bucket can require purge access and removes the bucket configuration
after its content has been successfully purged.

## Related pages

- [Buckets](../buckets/index.md)
- [Safe operations](../reference/safe-operations.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-bucket-purge.light.png" alt="Manager bucket purge page with selected targets and confirmation phrase" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-bucket-purge.dark.png" alt="Manager bucket purge page with selected targets and confirmation phrase" loading="lazy">
</div>
