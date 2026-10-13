# Audit Boundary: Control Plane and S3 Data Plane

BucketReef deliberately separates application audit from storage access logs.

## Formal contract

| Evidence source | Purpose | Examples |
|---|---|---|
| Application `audit_logs` | Control, security, configuration, and workflow-control evidence. | Authentication outcomes, IAM and key changes, shares and public links, bucket/project/application settings, migration or purge commands and state changes. |
| S3 provider access logs | Object data-plane evidence. | Upload, download, delete, copy, folder marker, object metadata/tags/ACL/retention, multipart, version cleanup, and individual restore requests. |
| Operational stores and backend logs | Metrics, health, billing, usage collection, and troubleshooting. | Healthchecks, usage snapshots, billing collection, request errors, and scheduler execution. |

The application audit service enforces this boundary centrally. Callers cannot
persist an excluded action by changing the surface or status. Global workflows
such as bucket migration, bucket purge, prefix restore, or history cleanup keep
one audit stream for their commands and state transitions; they must not emit
one application audit row per object.

Guided onboarding records configuration changes, dismiss/resume commands, saved
journeys, and operator attestations. Automatic verification records the workflow
start (which invalidates previous proof) and its success or failure, attributed
to the administrator and journey, with account context when applicable. It does
not record individual storage probes, object keys, credentials, or raw SDK
errors. Configuration preview is read-only and produces no audit event.

Application audit rows may carry the canonical Manager execution identity as
`context_kind`, `context_id`, and `context_name`. For RGW Accounts, the legacy
`account_id` and `account_name` fields remain populated for compatibility. New
Manager producers must pass the explicit `S3ExecutionContext`; they must not
encode RGW Users or S3 Connections as synthetic account references.

Admin Audit and `GET /api/admin/audit/logs` expose that execution context while
preserving the pagination contract. Their rows represent only control-plane and
security events, not an exhaustive history of object access. Workflows that
span more than one execution context, such as bucket migrations, keep their
source and target identities as workflow metadata rather than pretending that
one context represents the whole operation.

## Provider logging contract

Object auditing requires Server Access Logging, an equivalent provider feature,
or centrally collected storage request logs. Provider logs can be delayed and
their completeness depends on enablement, delivery, and retention. A backend
without S3 data-plane logging enabled has no exhaustive object audit trail.

Portal Managers can read the configured provider log stream through:

- `GET /api/portal/access-logs/page`
- `GET /api/portal/access-logs/raw`

The paginated route includes all S3 operation categories and supports action,
Storage Space, path, requester identity, and result filters. The removed
non-paginated `/api/portal/access-logs` route, `/api/portal/transfers`, and
`/api/portal/transfers/server-access-logs*` routes have no compatibility alias
and return `404`.

## Identity and attribution

Every person must use a dedicated IAM identity or an owned private S3
connection. Multiple keys for the same personal identity are allowed during a
controlled rotation, but a key must never be shared between people. Portal
already executes with a personal IAM identity. External tool access must also
remain assigned to one named person so provider logs can be attributed.

## Migration 0091

`0091_purge_data_plane_audit_logs` immediately removes historical data-plane,
operational telemetry, token-refresh, and OIDC-handshake-start rows from
`audit_logs`. The deletion is irreversible and downgrade is explicitly
unsupported. Back up the database before applying the migration if those rows
may be needed for historical analysis or legal retention.

Deploy the migration, backend, frontend, and documentation together because
the Portal access-log route change is intentionally breaking.
