# Anonymized laboratory captures

Captured on 2026-10-27 through the two RGW endpoints configured in the local
`backend/.env.save`, after the laboratory instances were restarted. All remote
requests were GET. No bucket, object, policy, credential or sync state was
created or modified.

These are **captured responses**, distinct from the `.synthetic.json` fixtures
under `../tentacle/`. Diagnostic fields are projected through the production
allowlist, and realm, period, zonegroup, zone, bucket and object identifiers
are consistently anonymized. Shard counts, phases, generation values, marker
positions and timestamp shapes retain their observed values. The manifest
records transformations and file digests; it contains no credentials or URLs.

Observed configuration: two zones, one metadata master and one secondary.
The metadata master returns a default `init`/0-shard HTTP 200 structure. The
secondary returns `sync` with 64 metadata and 128 data markers. The selected
bucket returns `incremental-sync`, generation 0 and 11 shard statuses. Its
full-sync position is an object containing `name`, not necessarily a string.

The three log page captures are empty, complete pages. They do not qualify
pagination with real entries, `next_log`, resharding or multiple generations.
The running server version was not independently attested by these APIs; the
implementation's reference contract remains upstream Ceph 20.2.4.
