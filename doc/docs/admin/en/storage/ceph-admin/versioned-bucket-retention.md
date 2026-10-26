# How-to: Control Storage Growth on Versioned Buckets

Use this workflow when versioned buckets keep old object versions longer than
the storage policy requires.

The example finds versioned project buckets that do not expire noncurrent
versions and standardizes a 90-day retention rule.

## Scenario

Versioning protects applications from accidental overwrite or deletion, but
every retained version can continue to consume storage. A common drift pattern
is a set of buckets with **Versioning: Enabled** and no noncurrent-version
expiration rule.

The target lifecycle rule is:

```json
{
  "ID": "expire-noncurrent-versions-90d",
  "Status": "Enabled",
  "Filter": {
    "Prefix": ""
  },
  "NoncurrentVersionExpiration": {
    "NoncurrentDays": 90
  }
}
```

## Prerequisites

- Access to **Ceph Admin > Buckets**.
- Versioning is intentionally enabled on the target buckets.
- A documented retention requirement for historical object versions.

!!! warning
    A noncurrent-version expiration rule permanently removes historical
    versions after they become eligible. Check legal, backup, recovery, and
    application requirements before applying the rule.

## 1. Find versioned buckets without retention

1. Open **Ceph Admin > Buckets**.
2. Narrow the list to the intended project or environment.
3. Open **Advanced filter**.
4. Filter for **Versioning: Enabled**.
5. Add lifecycle detail criteria to find buckets without the expected
   noncurrent-version expiration period.
6. Review exceptions such as immutable archives or buckets governed by another
   retention policy.

The active-filter summary below makes the two conditions explicit: the bucket
must have versioning enabled and must not already have a noncurrent-version
expiration rule.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/ceph-admin-version-retention-audit.light.png" alt="Ceph Admin active filters requiring Versioning Enabled and no noncurrent-version expiration lifecycle rule" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/ceph-admin-version-retention-audit.dark.png" alt="Ceph Admin active filters requiring Versioning Enabled and no noncurrent-version expiration lifecycle rule" loading="lazy">
</div>

## 2. Tag the campaign

Select the approved buckets and use
**Actions… > Selection > Manage UI tags…** to add a shared tag such as
`version-retention-audit`.

## 3. Back up existing lifecycle rules

Use **Actions… > S3 API > Back up bucket configurations…** and include
**Lifecycle** before changing the selection.

## 4. Preview the 90-day rule

1. Open **Actions… > S3 API > Configure selected buckets…**.
2. Choose **Add or update lifecycle rules**.
3. Paste the `expire-noncurrent-versions-90d` rule above.
4. Keep **Only update rules that already exist (do not add new rules)**
   disabled when buckets without the rule should receive it.
5. Click **Preview** and inspect representative **Before / After** results.

BucketReef replaces a lifecycle rule only when the rule identifier matches and
preserves lifecycle rules with other identifiers.

## 5. Apply and verify

1. Apply the change after the preview is clean.
2. Refresh the bucket inventory.
3. Filter for **Versioning: Enabled** and noncurrent expiration of `90` days.
4. Open representative buckets and confirm that unrelated lifecycle rules are
   still present.
5. Keep or replace the campaign UI tag with a durable classification such as
   `noncurrent-retention-90d`.

## Operational follow-up

Lifecycle expiration is asynchronous. Track storage consumption over the next
retention cycle instead of expecting an immediate reduction after the rule is
applied.

## Related pages

- [Workspace: Ceph Admin](index.md)
- [How-to: Use Advanced Filter in Ceph Admin](advanced-filter.md)
- [How-to: Standardize Bucket Lifecycle Policies at Scale](bulk-lifecycle-campaign.md)
- [Feature: Bucket usage stats](../bucket-usage.md)
