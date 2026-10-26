# How-to: Find Buckets Approaching Their Quota

Use this workflow to turn bucket quota usage into a review queue before
applications reach a hard storage or object-count limit.

The example identifies buckets at or above 80% of a configured quota, tags the
review set, validates current usage, and adjusts only the quotas that have an
approved capacity change.

## Prerequisites

- Access to **Ceph Admin > Buckets**.
- Bucket quota and usage data available for the selected endpoint.
- A capacity policy that defines warning and escalation thresholds.

## 1. Identify high-usage buckets

1. Open **Ceph Admin > Buckets**.
2. Enable quota and usage columns when they help the review.
3. Open **Advanced filter**.
4. Filter on bucket quota usage percentage, for example `>= 80%`.
5. If needed, add owner quota or owner quota usage criteria to distinguish a
   bucket-level constraint from an RGW user/account constraint.
6. Sort or narrow the result so the most urgent buckets are reviewed first.

Treat the percentage as an operational signal. Quota statistics may lag recent
writes, so a near-limit result should be verified before changing capacity.

The listing can expose used capacity, configured quota, percentage, object
count, and object-quota percentage together so the review is based on the
actual constraint rather than the bucket name alone.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/ceph-admin-quota-capacity-review.light.png" alt="Ceph Admin bucket quota review showing used capacity, configured quota, quota percentage, and object usage" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/ceph-admin-quota-capacity-review.dark.png" alt="Ceph Admin bucket quota review showing used capacity, configured quota, quota percentage, and object usage" loading="lazy">
</div>

## 2. Build a capacity review set

Select the filtered rows and use
**Actions… > Selection > Manage UI tags…** to add a shared tag such as
`quota-review-80pct`.

The tag lets the storage team revisit the same buckets after application owners
confirm whether growth is expected.

## 3. Refresh usage when the decision depends on it

When the available statistics are old or the bucket recently changed quickly,
select the affected buckets and run
**Actions… > S3 API > Calculate usage stats…** before making a quota decision.
Then refresh the listing and confirm the quota usage percentage again.

## 4. Decide the right remediation

For each reviewed bucket, choose the action that matches the cause:

- keep the quota and ask the application owner to remove or expire data;
- add or tighten lifecycle retention when old data is the cause;
- increase the quota when additional capacity is approved;
- investigate the RGW owner quota when the bucket limit is not the actual
  constraint.

Do not raise every quota merely because the threshold was crossed. The review
exists to distinguish expected growth from retention or application problems.

## 5. Change approved bucket quotas

For buckets with an approved capacity change:

1. Select only those buckets.
2. Open **Actions… > S3 API > Configure selected buckets…**.
3. Choose **Set bucket quota**.
4. Enter the approved size and/or object-count limit.
5. Click **Preview**, review the proposed quota values for every target, then
   apply the change.
6. Refresh the inventory and verify the new limit and usage percentage.

## Expected result

The storage team has a reproducible list of buckets nearing quota and a clear
record of which buckets were left unchanged, optimized through retention, or
granted more capacity.

## Limits / feature flags

!!! note
    **Set bucket quota** depends on bucket statistics/usage availability for the
    endpoint. Quota accounting is not instantaneous, so recent writes can make
    displayed percentages temporarily stale.

## Related pages

- [Workspace: Ceph Admin](index.md)
- [How-to: Use Advanced Filter in Ceph Admin](advanced-filter.md)
- [Feature: Bucket usage stats](../bucket-usage.md)
- [Operations: Quota Monitoring and History](../../operations/quota-monitoring.md)
