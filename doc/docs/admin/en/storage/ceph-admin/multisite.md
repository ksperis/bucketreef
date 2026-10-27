# Multisite diagnostics

Open **Ceph Admin → Monitoring → Multisite** to inspect RGW multisite
configuration, incoming synchronization states and source journals. The module
uses signed RGW Admin Ops GET requests. It cannot trim logs, initialize or stop
sync, repair buckets, change policies, or create zones or credentials.

## Live topology discovery

When **Ceph Admin → Monitoring → Multisite** opens, BucketReef reads the local
zone configuration from the selected endpoint and then reads the current
realm/period. Registered Ceph Admin endpoints are matched to period zones by
reading each endpoint's own local zone configuration. The endpoint form does
not store realm, zonegroup, zone or diagnostic associations.

If exactly one registered endpoint maps to a zone, BucketReef uses it for
diagnostic reads. If several endpoints map to the same zone, the mapping is
shown but no diagnostic endpoint is selected automatically. A secondary
endpoint whose local-zone read is denied or unavailable is left unassigned.
Published URLs in a period are configuration data; BucketReef never follows
them automatically and only contacts endpoints registered in the application.

The navigation performs a lightweight local-zone probe for the selected
endpoint. The Multisite entry is disabled only when that read succeeds and the
zone has no realm. A denied, unavailable or invalid response leaves the state
unknown and keeps the page accessible so the operator can inspect the error.
One zone inside a configured realm still counts as Multisite configured.

The existing external Ceph Admin identity remains in use (`admin=true`,
`system=false`). The discovery call `GET /admin/config?type=zone` requires
`zone=read`; that raw Ceph response can contain the multisite system key.
BucketReef immediately projects it to zone ID/name, realm ID, placements and
storage-class names. The raw body is never persisted or returned by this
feature, and provider error bodies from this operation are not surfaced.
Relevant diagnostic reads also include `mdlog`, `datalog`, `bilog` and
`buckets`. Missing permissions are shown as denied. BucketReef never grants
capabilities automatically.

## Read the three views

- **Overview** separates topology, metadata synchronization and data
  synchronization. Coverage identifies zones without a selected endpoint,
  unreadable components and destinations outside the current collection.
  Complex policy candidates retain a scope warning. A successful status read
  does not establish that every bucket participates in that flow.
- **Bucket replication** offers only source and destination zones that form a
  configured data-sync route and have an automatically matched Ceph Admin
  endpoint. Read-only zones are not offered as sources. Tenants and resolved
  bucket instances remain separate on both sides. Shards expose the destination
  marker and Ceph phase; source bilog generations show the followed and latest
  generations separately.
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

## Interpret current status

`sync` and
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
Collection is on demand and refresh is manual. There is no background collector,
automatic polling or persistent history.

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
