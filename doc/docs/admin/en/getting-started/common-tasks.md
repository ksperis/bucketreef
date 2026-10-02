# Common Administration Tasks

| Task | Go to | Check first |
|---|---|---|
| Add or configure a storage endpoint | [Admin workspace](../platform/index.md) and [Configuration](../configuration/index.md) | Provider, endpoint URL, credentials, and intended capabilities are known. |
| Check an endpoint incident | [Endpoint status](../platform/endpoint-status.md) | Health collection is active. |
| Review who can access an account or workspace | [Effective access audit](../platform/access-audit.md) | The user/group and target account are known. |
| Review platform changes | [Audit](../platform/audit.md) | Use application audit for control-plane events. |
| Review usage, quota, or billing collection | [Usage and metrics](../platform/usage-metrics.md), [Usage history](../platform/usage-history.md), and [Billing](../platform/billing.md) | Collection jobs and endpoint capabilities are healthy. |
| Rotate managed endpoint credentials | [Key rotation](../platform/key-rotation.md) | Maintenance impact and rollback plan are understood. |
| Operate Ceph RGW accounts/users/buckets | [Ceph Admin](../storage/ceph-admin/index.md) | Correct endpoint and Ceph Admin authorization are selected. |
| Run cross-context bucket work | [Storage Ops](../storage/storage-ops/index.md) | Target contexts and filters are correct. |
| Purge storage data administratively | [Bucket purge](../storage/bucket-purge.md) and [safe operations](../storage/safe-operations.md) | Exact targets and destructive effect are reviewed. |
| Prepare production rollout | [Production readiness](../operations/production-readiness.md) | Backup, health, security, and recovery checks are complete. |

For account-scoped bucket and IAM administration, hand the user to the
[Manager guide](/manager/en/) after the platform access has been provisioned.

## Related pages

- [Start here](index.md)
- [Storage admin runbook](storage-admin-runbook.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/use-cases-storage-admin.light.png" alt="Administrative storage workflow in BucketReef" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/use-cases-storage-admin.dark.png" alt="Administrative storage workflow in BucketReef" loading="lazy">
</div>
