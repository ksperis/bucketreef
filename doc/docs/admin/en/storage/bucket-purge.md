# Administrative Bucket Purge

Use bucket purge from **Ceph Admin** or **Storage Ops** when an administrator
needs to empty selected buckets while keeping their bucket configuration.

## Before you start

- In Ceph Admin, select the intended endpoint and verify the administrative
  authorization path.
- In Storage Ops, verify every selected context and bucket after filtering.
- Treat current objects, versions, and delete markers as permanently removable
  data for this operation.

## Steps

1. Select the target bucket rows in the administrative workbench.
2. Open **Actions > Destructive S3 operations > Purge bucket contents**.
3. Review the workspace, endpoint/context, target buckets, and exact effect.
4. Set parallelism only when operationally justified.
5. Type the exact confirmation phrase shown by BucketReef.
6. Monitor progress and retain the failed-target details before closing the
   result.

Storage Ops uses the authorized S3 execution contexts associated with the
selected buckets. Ceph Admin follows its dedicated administrative path for the
selected endpoint. Their authorization and failure semantics therefore differ
even though the operator intent is the same.

Purge keeps bucket configuration. Administrative bucket deletion, ownership
changes, and RGW index repair are separate actions with their own safeguards.

## Related pages

- [Safe operations](safe-operations.md)
- [Ceph Admin](ceph-admin/index.md)
- [Storage Ops](storage-ops/index.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-bucket-purge.light.png" alt="Administrative bucket purge confirmation with selected targets" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-bucket-purge.dark.png" alt="Administrative bucket purge confirmation with selected targets" loading="lazy">
</div>
