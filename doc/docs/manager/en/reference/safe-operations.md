# Safe Manager Operations

Use this page before deleting a bucket, purging content, migrating data, or
starting another Manager workflow with a large blast radius.

## Before you act

1. Confirm the active Manager execution context.
2. Recheck every selected bucket and destination.
3. Read the confirmation text and exact effect before typing a confirmation
   phrase.
4. For migration, verify source and target contexts and the selected mode.
5. For a retry after failure, inspect the current bucket or job state first.

## Manager operations

| Operation | Main risk | Safety control |
|---|---|---|
| Purge bucket contents | Removes current objects, versions, and delete markers while keeping bucket configuration. | Explicit targets, confirmation phrase, progress and failure counts. |
| Delete a non-empty bucket | Purges data and then removes the bucket and its S3 configuration. | Requires purge access and a guarded delete flow. |
| Bucket migration | Copies data and changes target state. | Precheck, explicit source/target, mode selection, progress and integrity options. |
| Bulk configuration or tool action | Changes multiple targets in the selected context. | Review selection and per-target result before continuing. |

A partial result is not an automatic rollback. Confirm which targets completed
before repeating the action.

## Related pages

- [Bucket purge](../tools/bucket-purge.md)
- [Bucket migration](../tools/bucket-migration.md)
- [Buckets](../buckets/index.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-bucket-purge.light.png" alt="Manager bucket purge confirmation with selected targets" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-bucket-purge.dark.png" alt="Manager bucket purge confirmation with selected targets" loading="lazy">
</div>
