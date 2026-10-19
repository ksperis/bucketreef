# Operations: Billing

Billing collection is disabled by default and must be enabled explicitly.

## Enablement model

Billing uses the `billing_enabled` application setting. Administrators can
change it in general settings; deployments can force it with
`FEATURE_BILLING_ENABLED=true` or `false`.

The Portal **Costs** tab is shown only when the effective setting is enabled.
When it is disabled, Portal does not call the billing source endpoint.

## Rate cards

Billing cost estimates require an existing rate card. The service resolves rate cards in this order:

1. Explicit account or S3 user assignment.
2. Resolved Billing Entity assignment.
3. Endpoint default Rate Plan valid for the billing period.
4. Global default Rate Plan valid for the billing period.

Endpoint/global fallback uses the conventional Rate Plan name `default`, or the
name configured by `BILLING_DEFAULT_RATE_CARD_NAME`. An unrelated named plan is
not selected implicitly. An explicit assignment with no effective tariff
version for the requested month remains an explicit missing-pricing state rather
than falling through to a lower-precedence plan.

The resolver also returns provenance for the selected layer, logical Rate Plan,
effective tariff version, currency, and storage charge basis. Membership or
assignment ambiguity is returned as a conflict. Admin views and CSV exports
surface these states so an unresolved price cannot be mistaken for a zero cost.

Without a matching rate card, Admin and Portal still show storage, traffic, request, and coverage data, but estimated costs are unavailable.

Superadmins manage global and endpoint-specific rate cards in `/admin/billing-settings`. Tariff versions use month boundaries and overlapping periods for the same name and scope are rejected. Future versions are editable; active and expired prices are immutable. Creating a new version from an active rate card closes the current version at the end of the preceding month and creates the replacement atomically.

Each tariff version stores a storage charge basis: `actual_usage` or `allocated_quota`. Existing pricing is migrated to `actual_usage`. The basis belongs to the effective tariff version, so a future switch between measured consumption and reserved-capacity pricing is scheduled through a new version rather than rewriting an active or historical tariff. In quota mode, ingress, egress, and request quantities remain usage-based.

## Manual daily collection

```bash
curl -X POST "http://localhost:8000/api/internal/billing/collect/daily?day=YYYY-MM-DD" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

Admins can also trigger one UTC day from `/admin/billing`. The result reports
endpoint count, storage records, usage records, and structured partial-collection
errors (`stage`, endpoint, and subject identifiers when applicable). Exception
details stay in backend logs instead of being returned by the API.

## Coverage

Billing coverage is tracked separately for storage snapshots and RGW usage logs.
The UI shows both source counts when they differ, because a month can have storage data without usage traffic, or usage traffic without a storage snapshot.
Treat estimated costs as provisional when coverage is low or source counts do not match.

Quota-based storage pricing adds a third coverage dimension. The billed storage
quantity is the prorated historical allocated quota for the month, while measured
storage remains available for diagnosis. Missing, disabled, unlimited, or invalid
quota observations make the storage price incomplete; they are never converted
to a zero-byte quota.

## Consolidated monthly analysis

`GET /api/admin/billing/analysis?month=YYYY-MM` composes the canonical Billing
Entity membership and Rate Plan resolution services into one monthly preview.
The route does not persist or reprice a statement.

- Billing Entity totals may span several endpoints and stay separated by currency.
- Membership conflicts remain visible and are excluded from totals.
- Billing Group totals reuse the already-priced entity results; group overlap does
  not cause an entity to be priced again.
- Group membership is evaluated for the requested month.
- Storage, usage, and quota coverage are returned with the consolidated preview.

The Admin UI exposes the same structure as `Billing Group -> Billing Entity ->
Endpoint -> Account/S3 User`. Immutable monthly results and annual/range totals
are built from finalized Billing Statements rather than from repeated live
recalculation of this preview.

## Monthly Billing Statements

BucketReef can persist the monthly Billing Entity result as a Billing Statement.
Statements are technical chargeback records, not commercial invoices. One
Billing Entity may produce one statement per currency for the same month; values
from different currencies are never combined.

The Admin API exposes the lifecycle used by later UI and integration layers:

- `POST /api/admin/billing/statements/generate` creates the entity/month drafts;
- `GET /api/admin/billing/statements` lists persisted drafts and finalized rows;
- `GET /api/admin/billing/statements/{id}` reads one persisted snapshot;
- `GET /api/admin/billing/statements/{id}/export.csv` exports snapshot lines as CSV;
- `GET /api/admin/billing/statements/{id}/export.json` exports the complete snapshot as JSON;
- `GET /api/admin/billing/statements/{id}/export.pdf` renders a finalized
  snapshot as a human-readable PDF cost statement;
- `POST /api/admin/billing/statements/{id}/finalize` freezes a reviewed draft.

PDF export is deliberately limited to finalized statements. A draft returns a
conflict response because its snapshot can still be regenerated. Rendering is
server-side and uses the persisted statement lines for all business content; it
does not resolve current tags, quotas, membership, or Rate Plans.

PDF presentation settings are available through
`GET/PUT /api/admin/billing/pdf/settings`. The optional logo is an embedded
PNG/JPEG data URL limited to 512 KiB. Audit metadata records whether a logo is
configured but never stores the base64 image payload.
`POST /api/admin/billing/pdf/preview` renders a deterministic sample using the
submitted settings, allowing the Admin UI to preview unsaved presentation
changes.

The PDF does not add legal invoice numbering, VAT/tax calculation, payment
terms or status, credit notes, or payment collection. Commercial invoicing
systems should consume finalized data through Billing Integration API v1.

Generation is idempotent by default: repeating it returns the existing draft
instead of creating another statement. Set `regenerate=true` explicitly to
rebuild an existing draft from current membership, collection, and tariff data.
A finalized statement cannot be regenerated.

Each line snapshots the Billing subject and endpoint identity, membership reason,
measured storage and usage, source coverage, storage charge basis, billed storage
quantity, Rate Plan/version provenance, unit prices, and component amounts. In
`allocated_quota` mode, measured storage remains in the snapshot alongside the
historical quota quantity used for pricing.

Tag-based membership is evaluated when the draft is generated. A later tag
change affects a future regeneration/new statement, while a finalized statement
keeps the membership reasons and tag labels captured in its snapshot. BucketReef
does not reconstruct day-by-day tag history for an already generated month.

Finalization revalidates the same canonical Billing inputs transactionally. A
draft with membership conflicts, incomplete required coverage, missing pricing,
or unusable quota history cannot be finalized. If membership, rates, usage, or
other priced inputs changed since the draft was generated, finalization reports
the draft as stale and requires explicit regeneration first.

Finalized rows and their line snapshots no longer depend on live tags, Rate
Plans, quotas, or daily Billing rows for rendering. They therefore remain
auditable after later configuration changes and after raw daily history ages out.

The **Statements** tab in `/admin/billing` exposes this lifecycle without leaving
the Billing workspace. Select a month, optionally filter by status, generate or
regenerate a draft for a Billing Entity, review every persisted subject/endpoint
line, and finalize only after all blocking conditions are resolved. Finalization
uses an explicit confirmation showing the entity, month, amount, currency, and
coverage. Finalized rows are presented as immutable snapshots.

## Finalized period analysis

`GET /api/admin/billing/finalized-period` aggregates persisted finalized monthly
statements for either one Billing Entity or one Billing Group. The same endpoint
supports a single month, a calendar year, or any month-aligned start/end range.
It never re-rates historical usage.

The response keeps currencies separate and returns the contributing statement
IDs, monthly entity contributions, expected months, finalized months, missing
months, and months that still contain drafts. Missing months are reported as
missing rather than represented as zero cost. Group analysis evaluates the
historized membership that was effective independently for every month in the
requested period.

The **Finalized period analysis** section in the Statements tab uses this
contract. Operators can switch between month, calendar year, and custom range,
inspect each month's completeness and entity contribution, then reopen an
underlying statement to continue the drill-down through endpoint and Account/S3
User snapshot lines.

## Monthly statement automation

Statement automation is configured in **Settings → Billing → Automation**. The
supported modes are `manual`, `automatic_draft`, and `automatic_finalize`.
`schedule_day` accepts days 1 through 28 and controls when the previous UTC
calendar month becomes eligible. Keeping the maximum at 28 makes the schedule
valid for every month.

The deployment Billing scheduler calls two internal operations on its daily
schedule:

1. `/api/internal/billing/collect/daily` collects the configured historical day;
2. `/api/internal/billing/statements/monthly` evaluates the statement workflow.

The monthly endpoint returns a harmless `skipped` result when Billing is
disabled, the workflow is manual, the configured day has not arrived, another
backend owns the month lease, or that mode already completed successfully for
the month. This lets Compose and Helm keep one simple daily Billing schedule
while the application owns the month-level policy.

`automatic_draft` calls the canonical statement generation service with
idempotent generation. Existing drafts and finalized statements are reused and
are not duplicated. `automatic_finalize` then calls the same
`BillingStatementService.finalize()` path used by Admin/API finalization. It
cannot bypass membership conflicts, missing pricing, stale drafts, source
coverage failures, or quota-history failures.

When the effective Rate Plan uses `actual_usage`, absent quota history does not
block finalization. When it uses `allocated_quota`, complete historical quota
coverage is part of the priced quantity and therefore remains a mandatory gate.
Different currencies continue to produce separate statements.

Each attempted monthly run is persisted with its month, mode, trigger source,
status, counts, and non-sensitive diagnostic codes. Automatic statement
finalization is audited using the explicit
`billing-automation@bucketreef.internal` workflow identity. A successful
scheduled run is not repeated by subsequent daily scheduler invocations for the
same month and mode.

### Recovery from a partial or failed run

Start with **Settings → Billing → Automation** and the **Statements** tab for the
affected month. Resolve the reported membership, pricing, assignment, quota, or
collection problem first. If an existing draft became stale because its source
inputs changed, regenerate that draft explicitly in the Statements view; the
automation retry never silently rewrites it.

The next scheduled invocation retries a month whose prior scheduled run is
still partial or failed. An operator with access to the internal scheduler
credential may also request an explicit idempotent retry of a completed month:

```bash
curl -X POST \
  "http://localhost:8000/api/internal/billing/statements/monthly?month=YYYY-MM" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

The explicit month must be completed; the current or a future month is rejected.
Retries preserve finalized statements and reuse existing drafts, so they cannot
create a second entity/month/currency statement.

## Scheduler integration

- Compose scheduler calls daily collection and monthly statement evaluation on
  `BILLING_CRON_SCHEDULE`. `BILLING_DAY_OFFSET` still controls the daily
  collection date; statement timing comes from the Admin Automation setting.
- `BILLING_STATEMENT_CRON_HTTP_TIMEOUT_SECONDS` controls the Compose monthly
  statement request timeout (default 1800 seconds).
- Helm `billingCronJob` runs the same two operations and exposes `schedule`,
  `dayOffset`, and `statementTimeoutSeconds` (default 1800 seconds).

## Retention

Billing daily tables are purged by the shared `DataRetentionService` (used by billing and quota jobs).

- `BILLING_DAILY_RETENTION_DAYS` (default `365`)
- `0` disables billing purge

Finalized Billing Statements are retained independently from these raw daily
tables. `BILLING_DAILY_RETENTION_DAYS` never deletes persisted statements or
their snapshot lines.

## External invoicing boundary

BucketReef Billing Statements are chargeback/cost records, not automatically
legal commercial invoices. Invoice numbering, taxes/VAT, payment terms and
status, payment collection, accounting ledgers, dunning, and commercial credit
notes belong to the downstream invoicing/accounting system. Use the supported
Billing Integration API v1 and optional statement-finalized webhook to hand the
immutable BucketReef result to that system.

## Related pages

- [Billing Integration API v1](billing-integration-api.md)
- [Operations: API tokens](../security/api-tokens.md)
- [Operations: quota monitoring and history](quota-monitoring.md)
- [Operations: observability](observability.md)
