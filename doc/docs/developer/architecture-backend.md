# Architecture: Backend

## Location

- Main entrypoint: `backend/app/main.py`
- Routers: `backend/app/routers/`
- Services: `backend/app/services/`

## Router groups

- Auth/users
- Admin
- Manager
- Portal
- Browser
- Ceph Admin
- Internal cron endpoints

## Feature gating

Router dependencies enforce global feature enablement (`require_*_enabled`).

## Error behavior

Backend preserves storage/API denial semantics and logs server-side details.

## API models

All application request and response DTOs inherit from
`app.models.base.ApiModel`. This boundary rejects unknown properties; do not
inherit directly from Pydantic's `BaseModel` for an application API schema.
FastAPI-generated form and multipart schemas are the only exceptions.

## Service boundaries

- Routers validate the HTTP boundary and call services.
- Services own business rules, storage execution choices, and audit metadata.
  The central audit policy rejects data-plane and operational-noise actions
  before persistence.
- Client modules wrap S3, IAM, RGW Admin Ops, or external integrations.
- Models and migrations define persistence; do not encode new authorization semantics only in the frontend.
- `FirstAdminBootstrapService` is the single boundary for first-user creation.
  Its CLI and API callers share email/password validation, the empty-database
  invariant, atomic singleton consumption and secret-free auditing.

## S3 download lifetime

Browser object downloads, Portal Storage Space downloads, and Portal public
links return an internal `S3ObjectDownload` from their service. This transfers
ownership of the open SDK `StreamingBody` to the shared `S3DownloadResponse`;
services must not discard it by returning only a chunk iterator.

The response streams one-MiB chunks without loading the whole object and keeps
the shared attachment-header encoding. It closes the provider body after
success, read/send failure, or client disconnection, including cancellation
before the first chunk. Cleanup runs outside the event loop and is shielded
from request cancellation. A response-construction failure also closes the
body. This lifecycle does not change execution identities, authorization,
public-link status checks, SSE-C parameters, or version selection.

Portal text previews and access-log readers consume their SDK bodies inside a
`contextlib.closing` scope so success and read failures both release the
provider connection. Text previews request and read at most 64 KiB, even when
the provider ignores the requested byte range; access-log reads retain the
complete object. A missing response body is not treated as an empty file:
previews report it as unavailable and log reads fail explicitly. A genuine
empty body remains valid, and a log object deleted after listing is still
ignored on `NoSuchKey`/not-found responses.

## Portal object identity

Portal object keys pass unchanged from HTTP query parameters or JSON payloads
to S3 reads, deletion, version history, and restoration. A leading slash is
part of the key: `report.txt`, `/report.txt`, and `//report.txt` are distinct
objects. Object names used for presentation or download filenames must never
be reused as execution keys.

Public-link creation checks and persists the exact requested key. Link
filtering compares that value literally, and downloads use the persisted
key. Existing links retain their stored targets; a formerly discarded leading
slash cannot be inferred or repaired by a data migration. Revoke and recreate
a link explicitly when its stored target is not the intended object.

Deleted-folder restoration retains leading and repeated slashes and spaces.
It appends only a missing final `/`. The empty prefix remains rejected for
this operation; `/` is a literal folder prefix rather than the bucket root.
The existing account, Storage Space role, and storage-side checks still apply.

## Browser object read identity

Object-column reads preserve each key exactly through HTTP validation, S3 HEAD
and tagging requests, cache lookup, and response mapping. Only exact duplicate
keys are deduplicated, in first-occurrence order; whitespace, Unicode, percent
characters, and path segments are never normalized. A refused read remains an
error for that exact key, without retrying a trimmed or otherwise altered name.

`ObjectColumnsRequest` requires both `keys` (1–200 nonempty strings) and
`columns` (1–6 supported column names). A whitespace-only object key is valid;
an empty string is not. Missing fields and invalid entries return `422` before
any storage read.

Version listing distinguishes an omitted exact `key` from the prefix-listing
mode. A supplied key must be nonempty and is sent unchanged as the S3 prefix,
with no delimiter; versions and delete markers are filtered by exact equality.
An empty key is rejected rather than broadening the request to a prefix or
whole-bucket listing. Omitted keys retain hierarchical prefix listing. S3 key
and version markers pass through unchanged, including on pages containing only
neighboring keys so the caller can continue pagination.

Object listings skip only the zero-byte folder marker whose key exactly equals
the selected folder prefix. Additional or repeated `/` characters identify
different keys and prefixes. Recursive folder synthesis scans delimiter
positions directly, so empty path segments such as `/`, `//`, and `docs//`
remain distinct in both the default and server-sorted listing paths.

Browser object tags use the same literal identity rule. Tag keys and values are
never trimmed, and a whitespace-only key remains valid input. Empty keys and
duplicate keys are rejected explicitly. CopyObject and multipart initiation
encode the validated tag list as ordered key/value pairs rather than converting
it through a dictionary, so no tag is silently discarded or overwritten.

## Browser mutation cache lifetime

Browser mutations use `BrowserContextMixin._object_mutation` around the storage
write, not around input validation or read-only preparation. On both success
and failure, the scope invalidates the affected execution context and buckets'
object listings, sorted snapshots, and lazy metadata/tag columns. A partial
DeleteObjects response, failed post-copy tag restoration or move verification,
or ambiguous transport error must not preserve a pre-mutation cached view.
Existing storage errors and copy-before-delete safeguards still propagate.

Copies invalidate only the destination bucket; moves invalidate source and
destination once each. Version cleanup invalidates after each attempted batch,
before local bookkeeping, even if a later step aborts. Empty cleanup scans and
failures before any write do not invalidate object views. Creating a bucket
also invalidates the context's bucket list if its optional versioning setup
fails after creation. Cache entries for unrelated contexts and buckets remain
untouched.

This scope covers backend-observed mutations. Direct presigned transfers still
need the caller's explicit listing refresh; TTLs and `force_refresh` remain
available for changes performed outside the backend.

## Long-running S3 client lifetime

Bucket usage scans, integrity checks, purges, and content comparisons own their
fresh S3 clients through `LongRunningS3ClientMixin._open_client`. The shared
scope closes the SDK client's endpoint connections on success, failure, or
cancellation. Worker pools must exit before their enclosing client scope so
in-flight reads or deletions never use a client that has already been closed.

Comparisons also close listing generators explicitly when temporary-index
writes fail. Remediation owns both source and target clients in an `ExitStack`;
failure to construct the target releases the already-created source client.
An empty remediation opens neither client. Request profiles, credentials,
storage-side authorization, and provider-specific listing behavior are
unchanged.

Usage scan cancellation remains a `BucketUsageStatsCancelled` signal through
versioned and current-object listings, rather than becoming a storage error.
It unwinds the worker and client scopes without persisting the canceled scan,
and the existing SSE boundary reports `canceled`.

## Bucket comparison object identity

Manager comparison remediation treats S3 object keys as opaque strings from
the HTTP payload through copy, streamed copy, deletion, and workflow metadata.
The request rejects empty keys and exact duplicates, but never trims keys or
normalizes Unicode or path segments. Context and bucket-name validation remain
separate from object-key identity.

Delete remediation matches provider errors against the exact requested keys
of that batch. Repeated errors for the same key count once. Malformed responses
or errors identifying an unrequested key fail explicitly instead of reporting
success or attributing failure to a different object.

## Bucket migration object identity

Version prechecks pass the scanned object key and version ID unchanged to the
source read and target CopySource-read probes. Only non-empty strings identify
an available sample; do not trim them or coerce other JSON types into names.
The same sample selector is used by temporary copy grants during version replay.

Streamed copies and version-aware comparison share the exact object-tag reader.
It requires a `TagSet` list with unique non-empty string keys and string values;
an empty list or value is valid. Malformed responses fail explicitly instead of
silently dropping tags or fabricating values. Spaces, Unicode, and URL encoding
characters remain literal data; sorting ignores tag order, not tag identity.
This applies to cross-endpoint copies and the existing authorized stream-copy
fallback after CopyObject denial. Deploying this correction does not change
permissions or automatically rewrite stored snapshots or remote objects.

## S3 deletion outcomes

`s3_delete_response.parse_delete_objects_failures` is the shared response
validator for comparison remediation and `s3_deletion`. It matches errors to
the exact requested key and version ID within the current batch. An omitted
error version ID is attributable only when that key identifies a single
target. Ambiguous or unrequested identities fail explicitly; repeated provider
errors never multiply the failure count for a requested entry. Responses
without errors need not include a `Deleted` list.

The deletion helpers still raise on partial failure rather than claiming that
the whole request succeeded. `DeleteObjectsError` carries confirmed successes
and individual failures, including prior successful batches. Bucket purges
retain these partial counts in progress and final results, with a bounded
sample identifying the actual failed objects, versions, or delete markers.
Unattributable responses and transport failures count the affected batch as
failed, not as confirmed deletions. Deleting the bucket remains blocked after any
content-purge failure.

The existing invalid-XML fallback and explicit individual-delete mode remain
available. Both preserve opaque keys and version IDs, including whitespace;
not-found results from individual retries remain idempotent successes. Browser
and Portal cleanup callers retain their fail-on-error contract.

## Operational routes

Internal cron routes are not UI routes. Keep them token-protected and documented
in Ops pages when scheduler behavior changes. Their health, billing, and usage
collection runs are operational telemetry rather than application audit rows.

See [Audit boundary](audit-boundary.md) before adding any audit producer.
