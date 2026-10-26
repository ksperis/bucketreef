# How-to: Audit Server-Side Encryption and KMS Usage

Use this workflow to inventory bucket default-encryption settings, find
unexpected algorithms or KMS key identifiers, and build a remediation queue.

BucketReef currently provides the strongest bulk support for the audit and
selection phase. Encryption changes are reviewed and applied from each bucket's
configuration rather than through a direct bulk encryption action.

## Prerequisites

- Access to **Ceph Admin > Buckets**.
- The selected endpoint exposes server-side-encryption capability.
- An approved encryption policy, including accepted algorithms and KMS key IDs.

## 1. Define the expected encryption policy

Before filtering, write down the expected state for each bucket family. For
example:

| Bucket family | Expected default encryption |
|---|---|
| `finance-prod-*` | `aws:kms` with the production finance key |
| `research-*` | `AES256` or an approved project KMS key |
| public test buckets | documented exception only |

Do not use the audit to infer which KMS key should be selected when ownership
or data classification is unclear.

## 2. Find buckets with unexpected settings

1. Open **Ceph Admin > Buckets**.
2. Open **Advanced filter**.
3. Use **Server-side encryption** detail criteria such as encryption algorithm
   and KMS key ID.
4. Narrow by owner, naming convention, S3 tag, or UI tag to compare like-for-like
   workloads.
5. Repeat the filter for each expected bucket family and record mismatches.

Useful review sets include buckets with no expected algorithm, buckets using
`aws:kms` with an unexpected key ID, and buckets whose configuration cannot be
resolved because the endpoint does not expose SSE capability.

Expose the encryption columns during the review so mismatches are visible in
the working set. The example below separates the expected KMS key, a legacy KMS
key, and an `AES256` bucket with no KMS key ID.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/ceph-admin-encryption-kms-audit.light.png" alt="Ceph Admin encryption audit comparing aws:kms keys and an AES256 bucket without a KMS key ID" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/ceph-admin-encryption-kms-audit.dark.png" alt="Ceph Admin encryption audit comparing aws:kms keys and an AES256 bucket without a KMS key ID" loading="lazy">
</div>

## 3. Tag the findings

Use **Actions… > Selection > Manage UI tags…** to classify results, for example:

- `encryption-compliant`;
- `encryption-remediate`;
- `kms-key-review`.

These tags do not alter S3 encryption. They preserve the operator review set
inside BucketReef.

## 4. Review and remediate individual buckets

For each bucket tagged for remediation:

1. Open the bucket configuration drawer.
2. Review the current default server-side-encryption algorithm and KMS key ID.
3. Confirm that the intended KMS key is accessible to RGW and approved for the
   workload.
4. Apply the required bucket encryption configuration.
5. Reopen or refresh the bucket and verify the resulting settings.

Work through the tagged remediation set until no unresolved bucket remains.

## 5. Re-run the audit

1. Return to **Ceph Admin > Buckets**.
2. Reapply the same SSE algorithm and KMS-key filters.
3. Confirm that all buckets in each family now match the documented policy.
4. Keep durable compliance tags only if they are useful for recurring reviews;
   otherwise remove temporary campaign tags.

## Limits / feature flags

!!! note
    Server-side-encryption columns and Advanced filter details follow the
    endpoint SSE capability. Ceph RGW support for SSE modes and KMS backends
    also depends on the RGW deployment configuration.

    Ceph Admin does not currently expose a direct multi-bucket **Set encryption**
    operation in **Configure selected buckets…**. Keep encryption remediation
    explicit per bucket.

## Related pages

- [Workspace: Ceph Admin](index.md)
- [How-to: Use Advanced Filter in Ceph Admin](advanced-filter.md)
- [How-to: Use UI tags in Ceph Admin](ui-tags.md)
- [Safe administrative storage operations](../safe-operations.md)
