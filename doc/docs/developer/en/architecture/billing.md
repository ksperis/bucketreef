# Architecture: Billing calculation

BucketReef Billing keeps metering and charge calculation deterministic so that
the same historical inputs always produce the same monthly result. The month is
the canonical calculation period; longer reporting periods aggregate monthly
results instead of recalculating raw observations with a different formula.

## Product boundary

BucketReef is the source of truth for S3 metering, storage-specific pricing,
Billing Entity membership, finalized monthly Billing Statements, and the
versioned integration contract that exposes those results. It is suitable for
showback/chargeback and for feeding a commercial invoicing or accounting system.

BucketReef Billing Statements are technical cost records. They are not legal
commercial invoices and the Billing domain does not implement invoice numbering,
VAT/tax rules, payment terms or status, payment collection, dunning, accounting
ledgers, or commercial credit notes. Those responsibilities stay in the external
system consuming the finalized statement contract.

## Numeric contract

Canonical Billing calculations use `Decimal`. Binary floating point is not used
for prices, billable quantities, component amounts, or totals.

- byte quantities are converted using `1 GiB = 1024^3 bytes`;
- billable quantities retain 12 fractional decimal places;
- monetary component amounts retain 6 fractional currency units;
- rounding uses `ROUND_HALF_UP`;
- the total is the sum of the already-rounded component amounts;
- requests are priced in exact groups of 1,000 requests;
- decimal API values are serialized as JSON strings so callers can preserve the
  exact value. UI code may convert them to a JavaScript number only for final
  presentation formatting.

The implementation of this contract lives in
`backend/app/services/billing_calculation.py`.

## Storage charge basis

Each effective Rate Plan version chooses one storage charge basis.

### Actual usage

`actual_usage` prices the average measured storage quantity for the month. The
quantity is calculated from the sum of the collected daily byte observations,
divided by the number of collected storage days, then converted to GiB-month.

Missing storage days are never synthesized. The API marks the storage quantity
as `partial` and exposes its coverage so previews can be treated as provisional.

### Allocated quota

`allocated_quota` prices reserved storage capacity from the historical quota
observed for each Billing subject on each UTC day. The monthly quantity is:

`sum(daily quota GiB observations) / calendar days in the billing month`

This naturally prorates quota changes made during a month. The denominator is
always the number of calendar days in the month, so a missing observation does
not inflate the result by averaging only the days that are present.

Billing persists the quota observation alongside `BillingStorageDaily`. Quota
collection is part of the Billing daily collection path and does not depend on
quota alerting or quota usage-history settings. Historical billing therefore
never reads the current live quota to fill an older period.

Quota observations preserve their state:

- `valid`: positive finite byte quota and usable for pricing;
- `missing`: no trustworthy observation exists for the day;
- `disabled`: the RGW quota is disabled;
- `unlimited`: the quota has no positive finite capacity limit;
- `invalid`: RGW returned a quota value that cannot be interpreted safely.

Any non-`valid` observation, or a missing expected observation, makes allocated
quota storage pricing `blocked`. A preview may expose the amount represented by
the valid observations, but it also returns `complete=false`, the pricing
coverage, and issue codes. Later statement finalization must treat that state as
incomplete rather than as a zero allocation.

Ingress, egress, and request components always use measured usage regardless of
the storage charge basis.

## Provenance returned by Billing APIs

Billing cost responses include `storage_quantity` with the selected basis, the
exact GiB-month quantity, collected and expected observation counts, calendar
days, coverage ratio, status, and issue codes. Daily subject detail also exposes
the recorded quota value and quota state for each storage observation.

This provenance is part of the calculation contract: exports, previews, and
immutable Billing Statements must be explainable from the stored
historical observations without consulting mutable live RGW state.

## Billing Entities

Billing Entities add a business grouping layer above technical RGW subjects.
Each entity has one explicit subject level, either `account` or `s3_user`.
Account and S3 User consumption is never combined inside the same entity
membership calculation.

Membership reuses the existing Admin-managed tag catalog. BucketReef does not
maintain a second billing-only tag system. Resolution is deterministic:

1. include subjects matching any configured Admin-managed tag;
2. add explicit subject inclusions;
3. apply explicit exclusions last;
4. deduplicate members while retaining every inclusion/exclusion reason.

`BillingEntityService` is the canonical resolver. It returns resolved members
with their reasons, explicitly excluded matches, unassigned subjects, and
cross-entity conflicts. The Admin preview calls this backend resolver instead of
reimplementing membership rules in the frontend.

A subject that resolves to several active Billing Entities is reported as a
conflict. The resolver never silently chooses one entity or duplicates the
subject for billing. Later Billing Statement finalization uses this conflict as
a blocking condition.

### Rate Plan assignments

An entity can optionally carry month-effective Rate Plan assignments. Entity
assignments reference the stable Rate Plan identity rather than a single tariff
version. The effective Rate Plan version is selected later for the requested
billing month.

Entity assignments currently accept global Rate Plans. A Billing Entity may span
several S3 endpoints, so an endpoint-scoped plan would make the entity-level
assignment ambiguous. Endpoint pricing remains available as the lower-precedence
fallback in the canonical rate-resolution order.

Assignment periods cannot overlap and use month boundaries. Current and future
periods can be scheduled safely. Once a period is historical it is preserved
verbatim when other entity settings are edited; changing or removing that
historical assignment is rejected.

## Canonical Rate Plan resolution

`BillingRateResolutionService` is the only backend resolver for the effective
Rate Plan used by Billing calculations. For a priced Account or S3 User it
applies the following precedence for the requested billing month:

1. direct subject assignment;
2. resolved Billing Entity assignment;
3. endpoint `default` Rate Plan;
4. global `default` Rate Plan.

`BILLING_DEFAULT_RATE_CARD_NAME` may replace the conventional `default` plan
name used for endpoint/global fallback. Another arbitrarily named Rate Plan is
never selected merely because it happens to exist in that scope.

Assignments reference the stable Rate Plan. The resolver then selects the one
tariff version effective for the requested month. An explicit assignment with
no effective version is reported as `missing`; it does not silently fall
through to a lower-precedence tariff. Multiple active direct assignments,
multiple active entity assignments, overlapping effective versions, or a
subject resolving to several Billing Entities are reported as `conflict`.

Every resolution returns an explanation object containing the status, winning
layer, Rate Plan and version identifiers, effective dates, Billing Entity when
applicable, currency, storage charge basis, and machine-readable issues. Admin
summary/detail views and exports expose this provenance instead of inferring it
again in the frontend.

The exact resolved tariff version controls both its unit prices and the storage
charge basis (`actual_usage` or `allocated_quota`). Those two decisions must
never be resolved independently. Services combining several priced results must
also reject mixed resolved currencies instead of constructing an ambiguous
total.

## Billing Entity Groups

Billing Entity Groups form an analytical layer above Billing Entities. They are
designed for organizational questions such as the total cost of Research, DSI,
a region, or a programme. A group never participates in subject membership,
Rate Plan resolution, or statement generation.

Membership is explicit and historized through
`BillingEntityGroupMembership`. Each record links one Billing Entity to one
group with a month-aligned `effective_from` and optional `effective_to`.
Periods for the same entity/group pair cannot overlap. A Billing Entity may
belong to several different groups for the same month because these groups are
independent analytical classifications rather than billing-allocation owners.

The effective group membership for a month is resolved from the persisted
membership periods. Deactivating a group does not remove those periods, so the
group remains usable for historical analysis. Once immutable monthly Billing
Statements exist, statement-generating months become historical accounting
inputs and their effective group classification must not be edited in place.

### Aggregation contract

`BillingEntityGroupService.aggregate_preview()` deliberately accepts already
calculated Billing Entity amounts. It never resolves subjects, prices, quotas,
or Rate Plans itself. This keeps one canonical calculation path and prevents a
group-specific pricing implementation from drifting from Billing Entity
results.

The aggregation contract:

- resolves the group's member Billing Entity IDs for the requested month;
- keeps each currency in a separate total and performs no implicit FX
  conversion;
- reports missing Billing Entity results explicitly instead of treating them as
  zero;
- propagates incomplete entity results into the group completeness state;
- retains the contributing Billing Entity IDs needed for drill-down.

The Admin consolidated preview consumes the canonical monthly Billing Entity
analysis and the same `Direct > Entity > Endpoint > Global` resolver. It does
not implement a separate group pricing path.

Historical group aggregation uses the statement month and the group membership
effective for that month. It never uses today's group membership and does not
create or persist a duplicate `BillingGroupStatement`. The canonical entity
statement remains the source for historical monetary values.

## Monthly Billing Statements

`BillingStatementService` is the persistence boundary between mutable Billing
inputs and immutable historical results. Generation produces one draft per
Billing Entity, month, and currency. The database uniqueness constraint on that
triple, together with idempotent service behavior, prevents accidental duplicate
monthly statements.

Draft generation calls the canonical Billing analysis, membership, rate
resolution, and calculation services. Each `BillingStatementLine` snapshots the
technical subject and endpoint identity, membership reasons and tag labels,
measured usage/storage, storage charge basis and exact priced storage quantity,
coverage/provenance, Rate Plan/version resolution, unit prices, component
amounts, and line total. A source fingerprint records the inputs represented by
the draft.

Tag membership is deliberately evaluated at generation time. BucketReef does
not reconstruct historical tag changes inside a month. Regenerating a draft
uses the current membership rules for that requested month and replaces the
draft snapshot; finalization freezes the resulting membership reasons and tag
labels permanently.

### Lifecycle

The persisted lifecycle has two states:

```text
live monthly inputs
      |
      v
    draft  <---- explicit regenerate while still mutable
      |
      | revalidate membership, rates, coverage and source fingerprint
      v
  finalized  ---- immutable snapshot / API v1 source
```

Finalization locks and reloads the statement, recomputes the canonical candidate,
rejects stale or blocked drafts, then records the finalization timestamp and
actor. Repeating finalization for an already-finalized statement is idempotent.
A finalized statement is never regenerated or rewritten from later tags, quotas,
names, rates, or retained daily source rows.

Blocking conditions include unresolved cross-entity membership, missing or
ambiguous pricing, mixed/incompatible currency inputs, incomplete mandatory
source coverage, and missing/unusable historical quota observations when the
effective tariff uses `allocated_quota`.

### PDF presentation

`BillingStatementPdfService` is an optional server-side projection of a
finalized Billing Statement. It consumes the persisted
`BillingStatementItem` snapshot and never calls live membership, rate, quota,
or usage services. The Admin export route rejects drafts before rendering.

The PDF contains organization identity, optional embedded PNG/JPEG logo, accent
color, Billing Entity identifiers, period/currency/finalization metadata,
coverage, optional note/footer, line-level
subject/endpoint/storage-basis/Rate-Plan detail, and the finalized total. It
uses bundled ReportLab Vera fonts and invariant PDF output so the same
statement plus the same presentation settings produces reproducible bytes,
including multi-page tables.

Presentation settings are stored in the existing `AppSettings` JSON under
`billing_statement_pdf`; they are intentionally outside the immutable
financial snapshot. A later branding change can therefore change the visual
presentation of a re-export while the statement's business data and monetary
amounts remain unchanged. Settings audit metadata stores only a `has_logo`
flag rather than the embedded base64 image.

This PDF is an Admin convenience and is not part of Billing Integration API v1.
Every document states that it is a technical cost statement generated by
BucketReef and not a legal commercial invoice.

## Finalized period aggregation

`BillingPeriodService` derives month, calendar-year, and custom month-aligned
views from finalized monthly statements. It sums persisted monetary component
amounts without re-rating historical usage. Results retain contributing
statement IDs and report expected, finalized, missing, and unfinalized months so
an incomplete period can never look like a zero-cost month.

Currencies remain separate. Storage quantities also preserve their basis:
measured GiB-month and allocated-quota GiB-month may both contribute monetary
amounts to a period, but are never collapsed into one synthetic capacity
quantity. Billing Entity Group periods resolve the group's historized membership
independently for every contributing month.

## Monthly automation

`BillingStatementAutomationService` supports the three product workflows:
manual, automatic draft generation, and automatic draft plus finalization. The
automation path calls `BillingStatementService.generate()` and
`BillingStatementService.finalize()` rather than maintaining another calculation
or finalization implementation.

Each run persists its month, mode, trigger source, result counts, completion
state, and safe diagnostic codes. The same coverage, membership, pricing,
currency, stale-draft, and quota-history gates used interactively therefore
apply to automatic finalization. Per-month operational leases and idempotent
generation/finalization make retries safe across backend replicas.

## Billing Integration API v1

The supported external contract is rooted at
`/api/integrations/billing/v1`. Internal `/api/admin/billing/...` routes remain
an application contract for the matching BucketReef frontend and must not be
used as a third-party compatibility boundary.

API v1 is read-only and accepts API tokens carrying the exact `billing:read`
scope. It exposes Billing Entity and Group identities, finalized period costs,
paginated finalized statements, statement details, and JSON/CSV exports. Draft
statements are excluded. S3 credentials and browser-session authentication are
outside this integration boundary.

`BillingIntegrationService` projects only persisted finalized snapshots and
`BillingPeriodService` aggregates. The integration layer never recalculates a
statement, membership, or tariff independently. Decimal quantities and money
are serialized deterministically, currencies stay explicit, and line responses
retain storage charge-basis provenance.

Within v1, existing routes and fields are not removed or renamed, field types
and established semantics remain stable, and consumers must tolerate additive
optional fields or enum values. A change that requires a consumer to reinterpret
existing data requires a new API version.

The optional `billing.statement.finalized` webhook is a discovery primitive.
It carries statement/entity identifiers, period/currency metadata, finalization
time, and an API-v1 statement reference. It intentionally omits lines and
calculated totals so the versioned API remains the canonical statement schema.
Webhook queue or delivery failures never roll back or mutate the finalized
statement; the existing durable webhook worker owns signing, retry/backoff,
idempotent delivery identifiers, and diagnostics.

## Retention and schema

Raw `BillingUsageDaily` and `BillingStorageDaily` rows follow the configured
Billing daily retention policy. Finalized `BillingStatement` and
`BillingStatementLine` snapshots are retained independently, so purging raw
metering history does not remove the canonical historical result.

The generated database documentation contains the Billing tables, group
membership history, statement snapshots, and their foreign-key topology. See
[Database](database.md) and the **Observability, quota, and billing** schema
slice. Regenerate/check those diagrams with
`backend/scripts/generate_database_schema_docs.py` whenever the Billing ORM
schema changes.
