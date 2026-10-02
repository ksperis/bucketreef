# Common Manager Tasks

Select the intended Manager execution context before starting any task.

| Task | Go to | Check first |
|---|---|---|
| Create or inspect buckets | [Buckets](../buckets/index.md) | Correct context is selected. |
| Configure versioning, lifecycle, policy, CORS, or notifications | [Bucket configuration](../buckets/configuration.md) | The endpoint supports the feature. |
| Review bucket composition | [Bucket usage](../buckets/usage.md) | Usage statistics are enabled for the context. |
| Manage IAM users, groups, roles, and policies | [IAM](../iam/index.md) | IAM capability is available. |
| Manage delegated Ceph RGW user keys | [Access keys](../iam/access-keys.md) | The selected S3 user is eligible and key management is enabled. |
| Manage SNS topics | [Topics](../topics.md) | SNS capability is available. |
| Work with objects from Manager | [Embedded Browser](../browser/object-operations.md) | Data access is enabled for this Manager context. |
| Compare buckets | [Bucket compare](../tools/bucket-compare.md) | Tool access is enabled. |
| Verify bucket integrity | [Bucket integrity](../tools/bucket-integrity.md) | Tool access is enabled. |
| Empty a bucket | [Bucket purge](../tools/bucket-purge.md) | Review [safe operations](../reference/safe-operations.md). |
| Migrate bucket data | [Bucket migration](../tools/bucket-migration.md) | Source and target contexts are still authorized. |

If a task is hidden, check [feature availability](../help/feature-availability.md)
before requesting broader permissions.
