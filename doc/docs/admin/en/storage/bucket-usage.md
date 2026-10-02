# Administrative Bucket Usage

Use bucket usage statistics in **Ceph Admin** or **Storage Ops** to inspect
logical S3 content for administratively selected buckets.

## Ceph Admin

From the selected Ceph Admin endpoint, open a bucket's usage statistics or the
cluster-level usage view when available. Recalculation can refresh selected
buckets or the endpoint scope using the administrative storage context.

## Storage Ops

Use the bucket list to select the authorized buckets you want to recalculate or
inspect across contexts. Review the filter and selected-target count before
starting a multi-bucket calculation.

## Interpreting results

Snapshots can include object counts, logical bytes, delete markers,
distributions, and current/noncurrent logical bytes when version listing is
available. Aggregated views combine the latest successful bucket snapshots and
show their coverage.

These are logical S3/RGW values. They do not represent physical Ceph capacity,
replication or erasure-coding overhead, or compression effects.

If version listing is unavailable, a current-object-only fallback is marked
partial and cannot provide a current/noncurrent split.

## Related pages

- [Ceph Admin](ceph-admin/index.md)
- [Storage Ops](storage-ops/index.md)
- [Usage and metrics](../platform/usage-metrics.md)
- [Troubleshooting](../help/troubleshooting.md)
