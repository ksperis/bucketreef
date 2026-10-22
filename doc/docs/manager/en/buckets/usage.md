# Bucket Usage in Manager

Use **Usage stats** to understand the logical S3 content of buckets in the
active Manager context.

## What the snapshot contains

A successful bucket snapshot can include:

- object count and logical bytes;
- delete-marker count;
- object type, storage class, size, and age distributions;
- current versus noncurrent logical bytes when object-version listing is
  available.

These values describe logical S3/RGW content. They are not Ceph physical
capacity figures and do not include replication, erasure-coding, compression,
or other placement overhead.

## Steps

1. Select the intended Manager context.
2. Open a bucket and choose **Usage stats**.
3. Review the latest successful snapshot and its timestamp/coverage.
4. Choose **Recalculate** when the snapshot needs to be refreshed.
5. Use the Manager **Usage & Metrics** view when available to review the latest
   bucket snapshots aggregated for the current account scope.

At account scope, **Usage composition** makes coverage, logical bytes,
current/noncurrent bytes, and the main composition breakdowns visible together.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-bucket-usage-stats.light.png" alt="Manager Usage and Metrics usage-composition view with snapshot coverage and logical-byte breakdowns" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-bucket-usage-stats.dark.png" alt="Manager Usage and Metrics usage-composition view with snapshot coverage and logical-byte breakdowns" loading="lazy">
</div>

If version listing is unsupported, BucketReef can fall back to current-object
listing. The resulting snapshot is partial and does not provide a
current/noncurrent split.

Bucket composition statistics are separate from RGW traffic/usage metrics; the
two features can have different availability.

Automatic collection is configured separately from feature availability. When
enabled for an RGW Account, the scheduler checks hourly for missing snapshots or
snapshots at least 24 hours old and refreshes only those buckets. Manual
recalculation remains available whenever bucket composition statistics are
enabled, even when automatic collection is disabled.

## Related pages

- [Buckets](index.md)
- [Feature availability](../help/feature-availability.md)
