# Multisite diagnostics

Open **Ceph Admin → Monitoring → Multisite** to inspect RGW multisite
configuration, incoming synchronization states and source journals. The module
uses signed RGW Admin Ops GET requests. It cannot trim logs, initialize or stop
sync, repair buckets, change policies, or create zones or credentials.

## Associate registered endpoints with zones

In **Admin → Storage endpoints**, edit each Ceph endpoint and enter its realm,
zonegroup and zone IDs together. Explicitly select the diagnostic endpoint for
each zone. If several registered endpoints represent the same zone, choose one.
An endpoint must consistently reach that zone; a load balancer spanning several
zones cannot provide reliable attribution.

BucketReef checks these declarations against the period configuration. Without
an association, the configuration remains readable but local synchronization
observations cannot be attributed. A mismatch blocks attribution and is never
corrected automatically. Published URLs in a period are configuration data;
BucketReef only contacts endpoints registered in the application.

The existing external Ceph Admin identity remains in use (`admin=true`,
`system=false`). The new application path is read-only; this does not reduce
the identity's broader storage privileges. Relevant RGW read checks include
`zone`, `mdlog`, `datalog`, `bilog` and `buckets`. Missing permissions are shown
as denied. BucketReef never grants capabilities automatically.

## Read the three views

- **Overview** separates topology, metadata synchronization and data
  synchronization. Coverage identifies zones without a selected endpoint,
  unreadable components and destinations outside the current collection.
  Complex policy candidates retain a scope warning. A successful status read
  does not establish that every bucket participates in that flow.
- **Bucket replication** requires explicit source and destination endpoints,
  source zone and bucket names. Tenants and resolved bucket instances remain
  separate on both sides. Shards expose the destination marker and Ceph phase;
  source bilog generations show the followed and latest generations separately.
- **Logs** reads one family and shard at a time. Metadata requires a period;
  bucket index requires a bucket instance and generation. Data logs preserve
  `extra-info` fields. Pagination follows provider markers; there is no invented
  total or last page. The local filter and exports cover only loaded entries.
  Moving to a subsequent bilog generation is explicit after the current page
  has been consumed.

Details retain collection time, endpoint, source/local zone, operation, HTTP
status and filtered JSON. Unavailable, denied, unsupported, not found and not
observed are distinct states. The metadata master has no incoming metadata
sync to inspect. Previous successful status reads can remain visible as stale
for up to 30 minutes after transient failures; denied results do not reveal
cached data. Journals are fetched on demand without preloading or polling.

## Interpret observations

Session observations compare opaque markers and states by equality within an
exact endpoint, realm, zone, bucket instance, shard, period and generation
scope. The last 20 observations are kept in memory for at most 30 minutes.
Reloading the page starts a new session. A changed period, generation or bucket
instance starts a new comparison context.

An unchanged marker does not establish a fault. `sync` and
`incremental-sync` are phases, not proof that a destination is current. Source
bilog `pending`/`complete` describe the source operation, not the replication
state of an object. Generation differences are observations, not exact lag.
No replication percentage, incremental remaining-object count or estimated
completion time is calculated. Empty and Unix-epoch timestamps are unavailable.

## Collection limits and qualification

Overview collects at most eight destination zones per page, with three
concurrent reads, a default budget of 32 RGW calls and a 20-second collection
deadline. Each read has an eight-second socket timeout and a 4 MiB response
limit. Journal pages default to 100 entries and are capped at 500. Large shard
lists render in slices of at most 1,000. Configuration is cached for 60 seconds
and statuses for 10 seconds; each request rechecks workspace and endpoint
authorization. Credentials, configuration and exact scope isolate cache keys.

Operators may tune `CEPH_MULTISITE_TIMEOUT_SECONDS`,
`CEPH_MULTISITE_DEADLINE_SECONDS` and `CEPH_MULTISITE_CALL_BUDGET`.
Collection is on demand. Optional 30-second refresh only runs while the page
is visible; it does not enable a background collector or persistent history.

The initial contract targets upstream Tentacle 20.2.4 with RADOS. Distribution
and driver variants need separate qualification. To capture laboratory reads
without printing credentials, run from the repository root:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m app.scripts.probe_rgw_admin_contract \
  --multisite --env-file backend/.env.save --output-dir /tmp/ceph-multisite-capture
```

Add `--bucket <name> --tenant <tenant>` to inspect an existing bucket. The probe
does not create test resources. Captures contain filtered operational data;
review and anonymize identifiers before committing them as fixtures. Synthetic
fixtures and UI screenshots do not constitute live cluster qualification.
