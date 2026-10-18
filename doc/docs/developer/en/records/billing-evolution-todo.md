# Billing evolution implementation TODO

Status: **planned**. This document is the implementation backlog for evolving
BucketReef Billing into a complete S3 metering, chargeback, consolidation, and
integration subsystem. It is intentionally **not** an ERP or accounting roadmap.

Each numbered objective below is intended to be implemented as a separate Codex
objective. Complete and validate one objective before starting the next one.
Do not silently fold later objectives into an earlier pass.

## Product boundary

BucketReef owns the storage-specific facts required to explain and price S3
consumption:

- collection of RGW usage and storage metrics;
- Account and S3 User billing subjects;
- rate plans and their effective versions;
- an explicit storage charge basis per effective Rate Plan version, using either
  measured storage consumption or allocated storage quota;
- Billing Entities used to group technical subjects into business units;
- Billing Entity Groups used to aggregate several business entities into
  historical analytical scopes such as Research, DSI, region, or programme;
- deterministic membership resolution from BucketReef tags plus explicit
  exceptions;
- rate resolution and cost calculation;
- consolidated monthly views plus derived multi-month/year analytical views;
- immutable monthly Billing Statements;
- stable exports and a supported, versioned Billing integration API.

BucketReef does **not** become the system of record for commercial invoicing or
accounting. The following remain outside the product boundary:

- legal invoice numbering and country-specific invoice compliance;
- customer accounting ledgers;
- VAT/tax engines and fiscal reporting;
- payment collection or bank reconciliation;
- reminders, dunning, payment status, and collections;
- commercial credit notes;
- arbitrary invoice workflow engines;
- general-purpose PDF invoice editors;
- ERP-specific business logic.

An external billing/accounting/ERP product consumes finalized BucketReef Billing
Statements and turns them into commercial invoices when required. A future PDF
inside BucketReef may only be an optional **cost statement/report**, never an
implicitly compliant legal invoice.

## Decisions already made

These decisions are requirements for the objectives below and should not be
re-opened during implementation unless a concrete technical blocker is found.

- Billing must support both internal chargeback/showback and integration with a
  real commercial invoicing system.
- A Billing Entity represents a business grouping such as a team, unit,
  laboratory, project, or customer cost center.
- Billing Entity membership uses a **hybrid model**:
  - include subjects dynamically by existing BucketReef tags;
  - include individual Accounts/S3 Users explicitly;
  - exclude individual Accounts/S3 Users explicitly.
- Reuse the normalized `TagDefinition`, `S3AccountTag`, and `S3UserTag` models.
  Do not create a second tag system or special billing-only copy of tags.
- Membership is evaluated when generating a statement and then snapshotted.
  Tag history is not reconstructed day by day in the first implementation.
- A statement has one explicit billing subject level: `account` or `s3_user`.
  Never sum Account and S3 User views of the same consumption into one statement.
- A subject resolving to multiple active Billing Entities is a conflict. Draft
  computation may expose the conflict, but finalization must be blocked until it
  is resolved. Never double bill silently.
- Billing Entity Groups are an **analytical layer above Billing Entities**, not a
  second billing-allocation layer. A Billing Entity may belong to several groups
  at the same time without creating a billing conflict.
- Billing Entity Group membership is explicit and time-bounded with month-aligned
  effective periods so historical organizational reporting remains stable after
  an entity moves between departments, programmes, or other scopes.
- Groups never change subject membership, rate resolution, or statement
  generation. Historical group costs are derived by aggregating the finalized
  Billing Statements of member entities for the requested period/currency.
- Do not create a persistent `GroupStatement` merely to duplicate entity
  statements. Group totals are derived analytical views over canonical entity
  statements.
- The **month is the canonical billing period**. Annual, quarterly, or custom
  month-aligned cost views are derived by aggregating canonical monthly results;
  they never create separate annual/quarterly billing statements.
- Multi-month aggregates must expose completeness explicitly (for example,
  finalized months vs expected months). Missing or unfinalized months are never
  silently interpreted as zero cost.
- One Billing Entity produces one monthly statement per currency, spanning all
  applicable storage endpoints. Endpoint detail remains visible in statement
  lines and drill-down views.
- Target rate precedence is:
  **direct subject assignment > Billing Entity > endpoint > global**.
- Rate changes are versioned and historical pricing is immutable.
- Each effective Rate Plan version defines an explicit storage charge basis:
  `actual_usage` or `allocated_quota`. Changing the basis is a tariff-version
  change and must never rewrite earlier months.
- `allocated_quota` applies only to the storage-capacity component in the first
  implementation. Ingress, egress, and request quantities continue to come from
  measured usage. Do not infer a billable object-capacity component from
  `quota_objects` unless a future Rate Plan explicitly introduces such a price.
- Quota-based storage uses historical quota observations, not the subject's
  current quota at preview/generation time. A quota change during a month is
  prorated from the recorded daily allocated quota for that month.
- A missing, disabled, unlimited, or otherwise non-billable storage quota is not
  zero capacity. In `allocated_quota` mode it is an explicit incomplete/blocking
  state unless a future documented policy defines another behavior.
- Monthly statement generation and finalization automation are configurable.
  Automatic finalization is allowed only after all safety/coverage/conflict
  gates pass; it must not bypass the same validation used by manual finalization.
- Billing configuration belongs to `/admin`. Keep Admin dense, auditable, and
  aligned with the existing BucketReef product-design and settings contracts.
- External integrations use a dedicated versioned contract. Existing `/admin`
  application routes must not accidentally become a supported third-party API.

## Cross-cutting invariants

Every objective must preserve these invariants.

### Accounting and numerical integrity

- Do not use binary floating-point arithmetic for monetary calculations.
- Persist prices and monetary amounts with `Numeric`/decimal semantics and keep
  Pydantic/service calculations on `Decimal`.
- Define and test an explicit rounding contract. Preserve sufficient internal
  precision for S3 quantities and rates; round presentation/final statement
  amounts deliberately rather than incidentally through `float` conversion.
- A finalized statement must always reproduce the same amounts from its
  snapshots even if tags, subject names, endpoints, or rate configuration later
  change.
- A statement with mixed currencies must never be finalized as one total.
- Multi-month, entity, and group aggregates must remain separated by currency
  unless a future explicit FX subsystem defines conversion semantics.
- Derived annual/quarterly/custom totals must sum canonical monthly results; they
  must not re-rate an entire long period using a current tariff.
- Storage quantity provenance is part of the monetary contract. A cost result
  must state whether its storage component used measured storage or allocated
  quota, and finalized statements must snapshot the chosen basis and quantity.

### Authorization and audit

- Billing administration remains a platform-governance concern in `/admin`.
- Configuration mutations and statement lifecycle mutations require explicit
  authorization and application audit events with non-sensitive metadata.
- External Billing API authentication must reuse or extend an explicit
  machine-to-machine credential contract; never expose browser/session secrets
  or storage credentials.
- No Billing API may reveal S3 secret keys, connection credentials, or unrelated
  private connection metadata.

### UX

- Reuse shared BucketReef primitives and the current Admin visual language.
- Use `PageHeader`, `PageTabs`, `ListPageSection`, `DataTableShell`, shared
  settings controls/dialogs, common badges, and existing confirmation patterns.
- Editable dialogs/forms protect unsaved changes on every close/navigation path.
- Loading, disabled, empty, incomplete coverage, conflict, and error states are
  explicit. Missing data must never be rendered as zero cost.
- Avoid introducing an ERP-style navigation tree, decorative dashboard, or
  invoice terminology for objects that are only technical cost statements.
- Meaningful visible route changes require targeted browser smoke/visual QA in
  addition to unit tests and type checks.

### Architecture

- Thin routers -> domain services -> persistence/integration clients.
- The Billing calculation engine must have one canonical implementation reused
  by Admin previews, statement generation, exports, and the integration API.
- Do not duplicate membership, rate-resolution, or cost-calculation logic in the
  frontend or in separate export paths.
- Persisted datetimes use `UTCDateTime` and timezone-aware UTC boundaries.
- Migrations must work on supported SQLite and PostgreSQL paths and maintain one
  Alembic head.

---

## Objective 1 — Finish and qualify Pricing Administration

### Goal

Finish the rate-card work already started and make pricing configuration a safe
foundation for all following Billing work. This objective must not add Billing
Entities or statements yet.

### Required work

- Audit the current `/admin/billing-settings` implementation and close its
  remaining quality gaps before building more features on it.
- Preserve the existing requirement that Billing settings remain accessible to
  authorized superadmins even when collection/analytics are disabled.
- Complete unsaved-change protection for create/edit/version dialogs using the
  shared settings close-guard pattern.
- Add the storage charge basis to Rate Plan version configuration with two
  explicit choices: **Actual usage** and **Allocated quota**. Default existing
  and migrated pricing to `actual_usage` so current behavior is preserved.
- Treat a storage charge-basis change like any other effective tariff change:
  active/expired versions are immutable and a future version is required for a
  future-month change.
- Complete API/service tests for:
  - list/detail;
  - create;
  - update of future pricing only;
  - active/expired immutability;
  - version creation;
  - overlapping-period conflicts;
  - delete rules;
  - endpoint validation;
  - authorization;
  - audit events and safe metadata.
- Validate the Alembic migration from an empty database and from the schema
  immediately preceding the Billing changes.
- Confirm the generated database-schema documentation stays synchronized.
- Verify the settings page at desktop/mobile widths and in both themes using the
  existing BucketReef Admin patterns.

### Rate-version identity hardening

Before relying on assignments in later objectives, introduce or confirm a stable
logical identity for a rate series. Assignments must not be pinned forever to a
single obsolete effective version.

Preferred target model:

- a stable logical Rate Plan/Rate Card Series identifies the tariff and scope;
- effective versions contain prices, currency, and effective dates;
- direct subject assignments reference the stable series/plan through explicit
  month-aligned effective periods;
- Billing Entity Rate Plan assignments introduced later follow the same
  month-aligned effective-period contract;
- period resolution selects the version effective for the requested month.

If the existing table is retained instead of adding a separate series table,
the service must still expose and enforce the same stable-series semantics. Do
not let a versioning implementation leave `BillingAssignment` pointing at an
expired version indefinitely.

Direct assignment history must also be deterministic. Replacing a subject's Rate
Plan for a future month must not change the plan resolved for earlier months.
Future assignment periods may be edited before they become effective;
assignment periods that contributed to finalized statements must not be
rewritten in place.

### Acceptance criteria

- Pricing can be fully administered through the current BucketReef settings UX.
- Historical/active versions cannot be edited in place.
- Future versions can be prepared safely.
- Direct assignments and their Rate Plan versions resolve the correct effective
  result by month.
- The settings UX makes the storage charge basis visible and unambiguous for
  every effective Rate Plan version.
- Targeted backend/frontend tests, typecheck, lint, migration checks, docs checks,
  and route smoke pass.
- No unrelated dirty work is modified or committed.

---

## Objective 2 — Make monetary calculation deterministic

### Goal

Turn the existing estimated-cost code into a calculation core suitable for
auditable monthly statements and external integrations, with deterministic
storage quantities for both measured-usage and allocated-quota charging.

### Required work

- Remove `float` conversion from monetary calculation paths.
- Introduce canonical decimal helpers/types for:
  - bytes -> GiB quantities;
  - measured storage GiB-month quantity;
  - allocated-quota GiB-month quantity;
  - ingress/egress quantities;
  - requests per 1,000;
  - unit prices;
  - component amounts;
  - totals.
- Define the rounding/precision contract in code and developer documentation.
- Keep raw quantities precise enough for recomputation and explanation.
- Extend the quota-history persistence needed by Billing so a daily subject
  record retains the effective observed storage quota (`quota_size_bytes`) for
  that day. The current hourly history already records quota values; Billing
  must not depend on short-lived hourly retention for monthly quota charging.
- Keep quota monitoring/notification enablement separate from Billing data
  requirements. If an effective Rate Plan uses `allocated_quota`, the Billing
  collection path must have a supported way to collect the required quota
  history even when quota-alert notifications are disabled.
- Define the canonical storage quantity contract:
  - `actual_usage`: use the existing measured average storage quantity for the
    month;
  - `allocated_quota`: for each subject/endpoint, sum the recorded daily storage
    quota expressed in GiB and divide by the number of calendar days in the
    billing month, producing a prorated allocated GiB-month quantity;
  - a mid-month quota increase/decrease therefore affects only the days on which
    the new allocation is observed;
  - missing daily quota observations reduce quota coverage and are never filled
    from the current live quota or silently assumed unchanged;
  - `None`, disabled, unlimited, or non-positive/unusable quota values are
    explicit non-billable quota states rather than zero allocation.
- Return storage quantity provenance and coverage alongside the calculated
  component so Admin previews, statement generation, exports, and integrations
  all explain which basis was used.
- Ensure API monetary values serialize without binary floating-point artifacts.
  Prefer decimal strings where necessary to preserve the contract.
- Add tests for very small prices, large usage values, zero quantities, missing
  price components, month length boundaries, quota changes during a month,
  missing quota days, unlimited/disabled quota, and deterministic recomputation.
- Verify current Admin Billing views keep their existing user-facing behavior.

### Acceptance criteria

- The same usage + effective rate inputs always produce the same exact persisted
  monetary result.
- The same historical quota observations + effective rate inputs always produce
  the same exact quota-based storage amount.
- No canonical Billing money calculation relies on Python/JavaScript binary
  floating-point arithmetic.
- Quota-based pricing never reads today's live quota to calculate a past month.
- Current summary/detail/export behavior remains compatible or is deliberately
  migrated with tests and documentation.

---

## Objective 3 — Introduce Billing Entities and hybrid membership

### Goal

Create the business grouping layer between technical RGW subjects and monthly
Billing Statements without turning tags into an accounting database.

### Domain model

Add a `BillingEntity` concept with at least:

- stable internal ID;
- display name;
- optional short code;
- optional `external_id` used to map the entity to an ERP, cost center, customer,
  or external billing system;
- billing subject level: `account` or `s3_user`;
- active/inactive state;
- optional Rate Plan assignment through separate month-effective assignment
  records rather than one mutable Rate Plan field;
- created/updated audit timestamps.

Do not add invoice address, VAT details, legal customer identity, payment terms,
or accounting-ledger fields merely because an external invoice system may need
them. Those belong to the external system unless BucketReef itself needs the
field to identify or group S3 consumption.

### Membership rules

Support three simple rule forms for the entity's chosen subject level:

1. include by standard Admin-managed tag;
2. explicitly include a specific Account/S3 User;
3. explicitly exclude a specific Account/S3 User.

Resolution semantics must be deterministic:

- start from all subjects matching any configured include tag;
- add explicit includes;
- apply explicit excludes last;
- deduplicate the result;
- preserve the reason(s) each subject matched so the UI can explain membership.

Do not implement arbitrary AND/OR expression trees in this objective.

Only use supported Admin-managed Account/User tag definitions. Do not allow
endpoint, connection, bucket UI, private-user, or object tags to become Billing
Entity selectors accidentally.

### Conflict detection

Build a canonical resolver able to return, for a given point in time:

- resolved members for every active Billing Entity;
- membership reason(s);
- unassigned billing subjects;
- subjects assigned to more than one active Billing Entity.

Cross-entity conflicts must be first-class results, not log-only warnings.

### Admin UX

Extend Billing settings with a **Billing Entities** section/tab that follows the
current compact Admin settings/listing patterns.

Required workflows:

- list/search Billing Entities;
- create/edit/deactivate;
- select `account` or `s3_user` billing level;
- select one or more existing allowed tags;
- add explicit includes/excludes;
- optionally configure current/future month-effective Rate Plan assignments;
- preview resolved members before save;
- show why each subject is included/excluded;
- show cross-entity conflicts prominently;
- protect unsaved changes;
- confirm destructive/deactivation operations where applicable.

### Audit

Audit create/update/deactivate and membership/rate-plan configuration changes.
Audit metadata should describe rule types and IDs/counts, not storage secrets.

Rate Plan assignment periods must follow the same temporal safety contract as
direct subject assignments: no overlap for the same entity, future changes are
scheduled on month boundaries, and periods that contributed to finalized
statements are not rewritten in place.

### Acceptance criteria

- One tag can group many Accounts or Users into one Billing Entity.
- Explicit include/exclude handles exceptions without creating special tags.
- Entity membership does not mix Account and S3 User usage levels.
- Conflicts are deterministic and visible before statement finalization exists.
- Existing generic tag administration remains the only tag source of truth.

---

## Objective 4 — Introduce Billing Entity Groups for analytical aggregation

### Goal

Allow administrators to answer questions such as **"What does all Research
cost?"** or **"What is the total cost of all DSI entities?"** without changing
the underlying billing allocation or duplicating statements.

### Domain model

Add a `BillingEntityGroup` concept with at least:

- stable internal ID;
- display name;
- optional short code;
- optional `external_id` for organizational/reporting-system correlation;
- optional description;
- active/inactive state;
- created/updated audit timestamps.

Add explicit group membership records linking Billing Entities to groups with:

- Billing Entity Group ID;
- Billing Entity ID;
- `effective_from` on the first day of a month;
- optional `effective_to` on the last day of a month;
- created/updated audit timestamps.

Membership periods for the same entity/group pair must not overlap. Historical
periods must remain queryable after an entity leaves a group.

Once a membership month contributes to finalized statements, its effective
classification must not be edited in place. Future membership changes are
scheduled on month boundaries. If an explicit historical correction mechanism is
ever added, it must be separately authorized/audited and make the correction
visible rather than silently rewriting analytical history.

### Semantics

- A Billing Entity may belong to zero, one, or many Billing Entity Groups at the
  same time.
- Overlapping membership across **different groups is valid**. For example, one
  entity may simultaneously belong to `Research`, `Brittany`, and
  `Agroecology Programme`.
- This is intentionally different from Account/User -> Billing Entity
  resolution: a technical subject in multiple Billing Entities is a billing
  conflict, while a Billing Entity in multiple groups is normal analytical
  classification.
- Group membership must never affect Rate Plan precedence or statement
  generation.
- A group has no independent currency conversion. Totals must remain separated
  by currency unless a later explicit FX subsystem is designed.
- Do not create a `BillingGroupStatement` or copy entity statement lines into a
  group-owned snapshot. The entity statement remains the canonical persisted
  monthly billing result.

### Cost aggregation

At this stage, implement the **current/month preview** aggregation by reusing the
canonical dynamic Billing Entity analysis. Define a stable aggregation service
contract that can later consume finalized statements, but do not fake
historical/finalized results from live mutable data before statements exist.

The finalized historical mode is completed after Objective 7 introduces
`BillingStatement`. It must use the group membership period effective for each
statement month, not current group membership. Moving an entity from `Research`
to `DSI` in a later month must not rewrite earlier Research totals.

The aggregation result must expose enough detail to drill down:

`Group -> Billing Entity -> Endpoint -> Account/S3 User -> usage/rate details`.

### Admin UX

Add a **Billing Groups** section/tab to Billing settings using the existing
compact Admin patterns.

Required workflows:

- list/search groups;
- create/edit/deactivate a group;
- manage Billing Entity memberships and their effective periods;
- show current members and scheduled future membership changes;
- validate month-aligned, non-overlapping periods;
- protect unsaved changes;
- audit create/update/deactivate/membership mutations.

Do not add a second tag engine for groups in the initial implementation. Entity
grouping is explicit and historized. If Billing Entity tags are later justified
for ad-hoc filtering, keep them separate from the authoritative group membership
periods defined here.

### Acceptance criteria

- An admin can create `Research` or `DSI` and attach several Billing Entities.
- One Billing Entity can belong to several groups without a conflict.
- Group membership can change on a future month boundary without changing past
  group totals.
- Preview group aggregation does not duplicate calculation logic or change
  pricing, and the service contract is ready to consume finalized statements in
  the later historical-analysis objective.
- Backend/service/API tests cover overlapping groups, invalid overlapping periods
  for one pair, historical membership, multiple currencies, and inactive groups.

---

## Objective 5 — Extend rate resolution with Billing Entity precedence

### Goal

Apply Billing Entity pricing consistently without creating a separate cost
calculation implementation.

### Required work

Implement and document the canonical precedence:

1. direct subject Rate Plan assignment;
2. resolved Billing Entity Rate Plan assignment;
3. endpoint Rate Plan;
4. global/default Rate Plan.

Requirements:

- Resolve the effective Rate Plan version for the billing period, never merely
  the latest database row.
- A conflicting Billing Entity membership must not choose a tariff arbitrarily.
  Surface an explicit conflict result.
- Ensure an entity spanning several endpoints can resolve rates correctly for
  each endpoint while remaining one consolidated monthly business entity.
- Preserve an explanation object indicating which layer won and which rate
  version was applied. This explanation is later snapshotted into statement
  lines and exposed in detail views/API responses.
- The resolved effective Rate Plan version also determines the storage charge
  basis. The calculation engine must resolve that basis from the same version as
  the unit prices; do not resolve pricing and quantity basis independently.
- Validate currency compatibility before totals are combined.
- Update current Admin Billing summary/subject detail to use the canonical
  resolver without changing unrelated collection behavior.

### Acceptance criteria

- Direct > Entity > Endpoint > Global is enforced by one backend service.
- The chosen plan/version is explainable for every priced line.
- The chosen storage charge basis and source quantity are explainable for every
  priced storage line.
- Conflicts or missing prices are explicit and cannot be mistaken for zero.
- Unit and service tests cover every precedence branch and effective-date edge.

---

## Objective 6 — Add consolidated Billing Entity and Group analysis in Admin

### Goal

Allow storage administrators to review monthly chargeback by business grouping
before introducing persistent statements.

### Required work

Evolve `/admin/billing` while preserving its existing operational character.
Use shared page tabs/sections rather than creating a second Billing workspace.

Add Entity- and Group-oriented views with:

- selected month;
- consolidated amount and coverage per Billing Entity;
- subject-level and endpoint-level drill-down;
- rate-resolution explanation;
- storage charge basis (`actual_usage` or `allocated_quota`) and the quantity
  used for pricing, while retaining measured storage as diagnostic context;
- conflict count;
- unassigned-subject count;
- incomplete storage/usage coverage warnings;
- incomplete quota coverage warnings when quota-based storage pricing applies;
- currency visibility;
- existing raw Account/User analysis still available for diagnosis.

The Group view must support:

- consolidated amount and coverage per Billing Entity Group;
- drill-down from group to member Billing Entities;
- continued drill-down to endpoint and Account/User;
- month-effective group membership;
- explicit separation of currencies.

The view must be derived dynamically from canonical membership and pricing
services. It is a preview, not yet a historical statement. Finalized historical
and multi-month/year analytics are added only after Objective 7 introduces
canonical persisted monthly statements.

### UX requirements

- Keep month/endpoint controls at the correct page scope. Entity consolidation
  may span endpoints, so do not force an endpoint filter into statement-like
  totals unless it is explicitly a drill-down filter.
- Reuse compact tables, `InlineSummary`, badges, and current Billing collection
  feedback patterns.
- Show conflicts/unassigned subjects as actionable operational states, not as
  decorative KPI cards.
- Mobile layouts must preserve the same information and actions without creating
  a separate simplified Billing implementation.

### Acceptance criteria

- An admin can explain a monthly entity total down to endpoint and Account/User.
- For quota-based storage, an admin can explain the monthly amount from the
  prorated historical quota and see missing/unusable quota observations.
- An admin can explain a monthly group total down to its member entities and the
  same endpoint/subject details.
- An entity belonging to several groups is represented independently in each
  analytical view without being billed twice.
- Membership/rate conflicts are visible before a statement is generated.
- Current Billing collection, subject drill-down, and CSV behavior regressions
  are covered by tests.

---

## Objective 7 — Introduce Monthly Billing Statements and immutable snapshots

### Goal

Persist the auditable monthly result that becomes the boundary between
BucketReef and external invoicing/accounting systems.

### Statement model

Introduce a monthly `BillingStatement` with at least:

- stable ID/public integration identifier;
- Billing Entity ID plus entity name/code/`external_id` snapshot;
- billing subject level snapshot;
- period start/end;
- currency;
- status: `draft` or `finalized`;
- coverage summary;
- subtotal/total according to the BucketReef cost model;
- generated timestamp;
- finalized timestamp/actor when applicable;
- revision/generation metadata needed for safe draft regeneration.

Do **not** call this object an Invoice in models, routes, or primary UI labels.

### Statement lines

Persist immutable-enough line data required to explain the total independently
of later mutable application state. Snapshot at least:

- subject type and internal ID;
- subject display/technical identity needed for explanation;
- membership reason(s) and relevant tag labels/IDs at generation time;
- endpoint ID/name snapshot;
- measured usage/storage quantities and source coverage;
- storage charge basis plus the exact storage quantity used for pricing;
- quota quantity/provenance and quota coverage when `allocated_quota` applies;
- logical Rate Plan and effective version identifiers/names;
- rate-resolution source (`direct`, `entity`, `endpoint`, `global`);
- unit prices;
- component amounts and total line amount.

Keep links to source IDs where useful for traceability, but finalized historical
rendering must not depend on successfully joining mutable live names/tags/rates.

### Draft generation

- Generate one draft per Billing Entity + month + currency.
- Resolve membership at generation time using the hybrid rules.
- Snapshot the resulting members; later tag changes affect only future draft
  regeneration/new statements.
- Detect and persist/report blockers:
  - cross-entity membership conflicts;
  - mixed currencies;
  - missing effective rate;
  - missing/unusable quota or insufficient quota-history coverage when the
    effective Rate Plan uses `allocated_quota`;
  - invalid subject-level mixing;
  - insufficient/missing source coverage according to policy.
- Allow safe regeneration of drafts. Regeneration must be explicit and must not
  mutate a finalized statement.
- Define idempotency so repeated generation requests do not create accidental
  duplicate monthly statements.

### Finalization

- Finalization performs all validation again transactionally.
- A finalized statement is immutable.
- No tag/rate/name/config change may rewrite finalized lines.
- Finalized statements remain readable after raw daily Billing retention removes
  source rows.
- If a finalized statement is wrong, do not edit it in place. The first release
  may require an explicit void/replacement administrative workflow only if that
  is necessary for BucketReef's own technical record keeping; commercial credit
  notes remain external-system responsibility.

### Retention

Define statement retention independently from raw daily Billing-data retention.
Never purge finalized statements merely because collection rows age out.

### Acceptance criteria

- A finalized statement is self-contained, reproducible, and auditable.
- A finalized quota-based statement remains reproducible even if the live quota
  is changed or removed later.
- Changing tags or rate versions after finalization does not change history.
- Draft generation is idempotent and conflicts cannot slip through finalization.
- Full migration, service, API, and lifecycle tests pass on supported databases.

---

## Objective 8 — Add statement review/finalization UX

### Goal

Make monthly statement preparation operationally safe in the existing Admin
Billing workspace.

### Required UX

Add a **Statements** view under `/admin/billing` with:

- month and status filtering;
- Billing Entity, currency, amount, coverage, generated/finalized timestamps;
- blocker/warning badges;
- draft generation/regeneration actions;
- detail view with subject and endpoint lines;
- membership/rate explanation;
- explicit review/finalize action;
- finalized immutable/read-only presentation;
- CSV/JSON download from the persisted statement snapshot rather than live
  recalculation.

### Finalized period analytics

Once finalized monthly statements exist, add one canonical finalized-period
aggregation service and Admin presentation for both Billing Entities and Billing
Entity Groups.

Supported periods must include at least:

- one month;
- one calendar year;
- a custom month-aligned range.

Quarterly views may be exposed as a convenience over the same range contract;
they must not introduce a separate persistence model.

Rules:

- monthly `BillingStatement` rows remain the sole canonical persisted billing
  results;
- annual/quarterly/custom totals sum the finalized monthly statement amounts and
  their component amounts without re-rating historical usage;
- Entity Group aggregation evaluates the historized group membership effective
  independently for each contributing month;
- results stay separated by currency;
- return the contributing statement IDs/months so every aggregate remains
  traceable;
- expose `expected_months`, `finalized_months`, missing/unfinalized months, and a
  clear completeness/partial state;
- a missing month is not zero cost;
- a current/incomplete year may be shown as partial, but its total must be
  labelled accordingly.

The Admin Billing analytics UX should allow the operator to switch cleanly
between monthly and yearly/range analysis without creating a second page family.
Yearly detail must retain a per-month breakdown and support drill-down:

`Period -> Group (optional) -> Billing Entity -> Month -> Endpoint -> Account/S3 User`.

### Safety

- Finalize requires explicit confirmation and backend validation.
- The confirmation summarizes entity, month, amount, currency, coverage, and any
  non-blocking warnings.
- Blocking conflicts, missing prices, or policy failures disable finalization
  with an actionable reason.
- Pending generation/finalization locks duplicate actions and navigation paths as
  appropriate.
- All mutations emit audit events.

### Acceptance criteria

- An operator can Generate -> Review -> Finalize without leaving Admin Billing.
- The UI renders snapshots for finalized statements and never silently
  recalculates them from current tags/rates.
- An operator can obtain a calendar-year cost for one Billing Entity or Billing
  Entity Group, see the monthly contribution, and identify incomplete months.
- Changing later Rate Plans or group memberships does not rewrite a finalized
  historical annual total for earlier months.
- Desktop/mobile, light/dark, failure states, and unsaved/pending behavior are
  covered by targeted tests and browser QA.

---

## Objective 9 — Add configurable monthly statement automation

### Goal

Support unattended monthly operations without making automation less safe than
manual operation.

### Configuration

Add Billing settings for predefined automation modes rather than an arbitrary
workflow engine. At minimum support:

- manual generation + manual finalization;
- automatic draft generation + manual finalization;
- automatic draft generation + automatic finalization when all gates pass.

Configuration should include the execution schedule/day offset needed to ensure
the previous month's usage collection is complete.

### Automation gates

Automatic finalization must call the same canonical finalization service and
must refuse to finalize when any blocker exists. Define explicit policies for:

- minimum acceptable usage/storage coverage;
- minimum acceptable quota coverage when any priced line uses
  `allocated_quota`;
- unresolved membership conflicts;
- unassigned subjects when policy requires assignment;
- missing pricing;
- mixed currencies;
- failed or incomplete collection.

Do not create a second calculation/finalization implementation in a cron path.

### Operations

- Use the existing operational lease/concurrency patterns to prevent duplicate
  runs across application instances.
- Record run results and safe diagnostics suitable for operators.
- Audit automatic finalization with an explicit automation actor/workflow
  identity.
- Make retries idempotent.
- Document recovery from failed monthly runs.

### Acceptance criteria

- All three predefined modes work.
- Automatic finalization can never bypass a blocker accepted by neither manual
  nor API finalization.
- Multi-backend/concurrent execution cannot generate duplicate finalized
  statements.

---

## Objective 10 — Establish the supported Billing Integration API v1

### Goal

Provide external invoicing/ERP/accounting tools with a stable machine-readable
contract without promoting BucketReef's internal `/admin` APIs to public APIs.

### API boundary

Create a dedicated, explicitly versioned integration surface. Preferred route
family:

`/api/integrations/billing/v1/...`

Equivalent repository-standard routing is acceptable only if it preserves a
clearly separate external contract and explicit versioning.

The initial API should expose read-only operations for:

- Billing Entities and their stable/external identifiers;
- Billing Entity Groups, their stable/external identifiers, and month-effective
  memberships;
- finalized period cost aggregation for Billing Entities and Billing Entity
  Groups, derived from finalized monthly entity statements and separated by
  currency;
- finalized statements, filterable by period/entity and paginated;
- one finalized statement;
- statement lines/details;
- machine-readable CSV and JSON exports derived from statement snapshots.

Draft statements must not be exposed by default to external invoice consumers.
If draft access is later needed, make it an explicit permission/scope.

### Contract design

- Publish a dedicated schema/version contract and examples.
- Use stable identifiers and ISO-8601 dates.
- Use an explicit period contract supporting at least `month`, calendar `year`,
  and custom month-aligned ranges without inventing annual statement resources.
- Serialize decimal monetary and quantity values deterministically.
- Include currency on every monetary aggregate boundary.
- Include `external_id` and the technical BucketReef statement ID so consumers
  can correlate records idempotently.
- For entity/group period aggregates, expose the requested period, effective
  member entities where applicable, contributing finalized statement IDs/months,
  currencies, totals, and completeness so consumers can trace an aggregate back
  to canonical monthly statements.
- Include enough line metadata for an external system to either:
  - trust BucketReef's calculated amounts; or
  - consume quantities/rates and apply additional commercial logic itself.
- Expose the storage charge basis and the exact priced storage quantity so an
  integration can distinguish consumed-capacity billing from allocated-capacity
  billing without reverse engineering the amount.
- Do not leak internal ORM structure or unrelated Admin response payloads.
- Define backwards-compatibility rules for v1 before calling it supported.

### Authentication and authorization

- Use an explicit machine credential with narrowly scoped Billing-read access.
- Prefer reuse/extension of BucketReef's existing API-token infrastructure if it
  can provide the necessary scope safely.
- Document token issuance, rotation, revocation, and least privilege.
- Never require an S3 access key for this application-level integration API.

### Acceptance criteria

- A third-party tool can enumerate finalized monthly statements and ingest every
  line without using the BucketReef frontend or `/admin` APIs.
- A third-party tool can retrieve a finalized monthly cost aggregate for a
  Billing Entity Group without treating it as a new invoice/statement object.
- A third-party tool can retrieve a calendar-year or custom-range cost aggregate
  for one Billing Entity or Group and identify missing/unfinalized months.
- API replay/pagination produces stable results.
- Contract tests protect v1 response compatibility.
- Security tests prove a Billing integration token cannot reach unrelated Admin
  or storage-secret surfaces.

---

## Objective 11 — Add integration delivery primitives, not ERP connectors

### Goal

Make the integration practical in production while keeping BucketReef vendor
neutral.

### Required work

Start with pull-based API integration as the source of truth. Add only generic
delivery primitives that materially help external systems, for example:

- optional webhook/event when a statement becomes finalized;
- statement-finalized event payload containing IDs and a link/reference to fetch
  the canonical statement through API v1;
- retry/backoff and delivery diagnostics using the application's existing
  webhook/outbound integration patterns where appropriate.

Do not embed SAP, Sage, Odoo, Pennylane, Chorus, Stripe, or another vendor's
business model directly into the Billing core in this objective.

If a vendor-specific adapter is later justified, implement it as a separate
integration layer consuming the same Billing API/domain contract.

### Acceptance criteria

- External systems can reliably discover newly finalized statements.
- Delivery failures do not mutate or invalidate the statement itself.
- Webhook retries are idempotent and observable.
- The canonical statement remains the API resource, not the webhook payload.

---

## Objective 12 — Complete documentation and operational guidance

### Goal

Document the Billing subsystem according to its final product boundary and make
the distinction between chargeback statements and invoices unambiguous.

### Required documentation

Update Admin and operations documentation for:

- rate plan configuration/versioning;
- actual-usage vs allocated-quota storage charging, including mid-month quota
  changes, quota-history coverage, and unlimited/disabled quota behavior;
- Billing Entity creation and membership rules;
- Billing Entity Group creation, historized membership, overlapping analytical
  groups, and group cost drill-down;
- tag behavior and snapshot semantics;
- conflict resolution;
- rate precedence;
- consolidated Billing review;
- finalized monthly, annual, and custom-range analytical views, including partial
  period/completeness semantics;
- draft/finalized statements;
- coverage and finalization blockers;
- automation modes and recovery;
- statement retention;
- external Billing API authentication and use;
- integration examples using generic HTTP/JSON/CSV, not a vendor-specific ERP.

Developer documentation must cover:

- Billing domain boundaries;
- calculation precision/rounding;
- storage quantity provenance and quota-proration semantics;
- membership/rate resolution;
- Billing Entity Group aggregation and historical membership semantics;
- canonical monthly statement vs derived multi-month/year aggregation semantics;
- snapshot immutability;
- supported external API compatibility policy;
- database schema diagrams and lifecycle states.

Explicitly state that BucketReef statements are not automatically legal
commercial invoices and that invoice/tax/payment workflows belong to the
external system.

### Acceptance criteria

- User/admin docs match the shipped UI.
- Ops docs cover normal and failed monthly runs.
- Developer docs are sufficient to maintain API v1 without reading historical
  implementation conversations.
- Strict MkDocs builds and documentation link checks pass.

---

## Objective 13 — Optional internal cost-statement PDF

Status: **optional / defer unless there is a concrete user need**.

### Goal

If operators need a human-readable attachment without an external billing
system, allow a finalized BucketReef statement to be rendered as a cost report.

### Boundaries

- Label it **Billing Statement**, **Cost Statement**, or equivalent; do not call
  it a legal invoice.
- Generate exclusively from the finalized statement snapshot.
- Allow restrained structured branding only: logo, organization display name,
  colors, footer/notes, and statement metadata.
- Do not add invoice numbering, VAT calculation, payment terms, payment status,
  credit notes, or a WYSIWYG template editor.
- Prefer a deterministic server-side renderer with reproducible output.

### Acceptance criteria

- Regenerating a PDF for the same finalized statement produces the same business
  content even after live tags/rates change.
- PDF generation failure never affects statement finalization or external API
  availability.
- Accessibility/readability and multi-page tables are validated.

---

## Objective 14 — Final end-to-end audit and corrective pass

### Goal

Audit the finished Billing feature as a complete subsystem, not merely as the
sum of passing incremental objectives, and correct every issue found before
considering the evolution complete.

### Architecture audit

Verify:

- one canonical calculation engine;
- one canonical membership resolver;
- one canonical rate resolver;
- no duplicated Admin/export/integration calculations;
- group aggregation is derived from canonical Billing Entity results/statements
  and does not introduce duplicated billing allocations or `GroupStatement`
  persistence;
- external API v1 is separated from internal application routes;
- no ERP/accounting scope leaked into the core domain;
- migrations and schema remain coherent on SQLite/PostgreSQL;
- finalized statements are truly independent of mutable live configuration.

### Data-integrity audit

Exercise at least:

- multiple endpoints for one Billing Entity;
- multiple Accounts sharing one tag;
- explicit include and exclude exceptions;
- tag changes before/after statement generation;
- subject belonging to two entities;
- one Billing Entity belonging to multiple Billing Entity Groups;
- Billing Entity Group membership changing on a month boundary while historical
  group totals remain unchanged;
- group aggregation over several entities/endpoints and multiple currencies;
- annual aggregation for one Billing Entity from 12 finalized monthly statements;
- annual Billing Entity Group aggregation across a membership change between
  months;
- partial current-year aggregation with missing/unfinalized months clearly
  reported rather than counted as zero;
- custom month-aligned range aggregation with traceable contributing statement
  IDs;
- direct vs entity vs endpoint vs global price precedence;
- actual-usage storage charging;
- allocated-quota storage charging with a stable quota for the whole month;
- allocated-quota storage charging with a mid-month quota increase/decrease;
- quota-based charging with missing daily quota observations;
- quota-based charging with disabled/unlimited quota, which must block rather
  than silently price zero capacity;
- a Rate Plan version changing storage charge basis on a month boundary while
  earlier finalized months remain unchanged;
- rate version boundary at month changes;
- missing price;
- incomplete collection;
- zero usage;
- very large usage;
- decimal precision edge cases;
- raw Billing retention after statement finalization;
- draft regeneration and concurrent generation;
- automatic generation/finalization retry;
- external API pagination/replay.

### Security/audit audit

Verify:

- Admin authorization on every control-plane mutation;
- integration-token least privilege and revocation;
- no storage secrets in Billing responses, logs, exports, or audit metadata;
- all important configuration/finalization mutations are audited;
- automation actor/workflow identity is traceable;
- destructive/deactivation actions use backend safeguards, not only UI gating.

### UX audit

Review `/admin/billing` and `/admin/billing-settings` together for:

- consistency with current Admin navigation and shared components;
- compact desktop density;
- mobile usability and touch targets;
- light/dark themes;
- loading/error/empty/disabled states;
- conflict and coverage messaging;
- unsaved-change protection;
- immutable finalized-state presentation;
- terminology that clearly distinguishes statements from invoices.

Do not accept local page-specific styling or components where a current shared
BucketReef primitive already solves the problem.

### Validation baseline

Run the relevant full/targeted validation suites after corrective changes,
including as applicable:

- backend Billing/unit/API/service tests;
- migration upgrade checks from empty and representative prior schemas;
- frontend Billing tests;
- frontend typecheck and lint;
- listing/settings presentation checks;
- authenticated Admin browser smoke;
- desktop/mobile light/dark visual QA;
- integration API contract/security tests;
- concurrency/idempotency tests;
- strict documentation build;
- `git diff --check` and repository-specific generated-schema checks.

Record the final validation evidence in the developer records. Fix issues found
by this audit in the same final corrective objective rather than documenting
known regressions as acceptable completion.

### Final acceptance criteria

The Billing evolution is complete only when BucketReef can reliably answer:

1. **What S3 resources did this business entity consume?**
2. **Why does this subject belong to this entity?**
3. **Which tariff and version priced each quantity, and why?**
4. **What exact monthly amount was finalized, with what coverage?**
5. **Can that finalized result be reproduced and audited later?**
6. **Can an external invoicing/accounting system ingest it through a stable,
   secure contract without understanding Ceph RGW internals?**
7. **Can an administrator aggregate those costs across stable organizational
   groups such as Research or DSI without changing or duplicating the underlying
   billing records?**
8. **Can an administrator obtain a trustworthy annual or custom-range cost from
   canonical monthly statements and immediately see whether the period is
   complete?**

If all eight answers are yes, BucketReef provides a complete enterprise-grade S3
Billing/chargeback boundary while deliberately remaining outside ERP and legal
invoice responsibilities.
