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

If version listing is unsupported, BucketReef can fall back to current-object
listing. The resulting snapshot is partial and does not provide a
current/noncurrent split.

Bucket composition statistics are separate from RGW traffic/usage metrics; the
two features can have different availability.

## Related pages

- [Buckets](index.md)
- [Feature availability](../help/feature-availability.md)
