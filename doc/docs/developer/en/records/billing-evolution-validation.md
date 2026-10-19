# Billing evolution final validation

Status: **completed** on 2026-10-19.

This record closes the Billing evolution backlog. The implementation now covers
S3 metering and chargeback, Billing Entities and analytical groups, deterministic
pricing, immutable monthly statements, finalized period aggregation, automation,
the versioned Billing Integration API, and optional human-readable cost-statement
PDFs. BucketReef remains outside ERP, payment, tax, and legal-invoice scope.

## Final architecture review

The final audit confirmed these invariants:

- monetary calculation stays in the canonical Billing calculation path and uses
  decimal semantics;
- Billing Entity membership is resolved by the canonical hybrid tag plus
  explicit include/exclude model, with cross-entity conflicts blocking
  finalization;
- Rate Plan resolution remains `Direct > Entity > Endpoint > Global`, and the
  resolved effective version owns both prices and the storage charge basis;
- storage pricing supports `actual_usage` and `allocated_quota` per effective
  Rate Plan version, including historical daily quota proration and explicit
  incomplete quota coverage;
- monthly Billing Statements are the canonical persisted billing result;
  annual and custom-range views aggregate finalized monthly statements without
  re-rating history;
- Billing Entity Groups remain an analytical aggregation layer. There is no
  duplicated group billing allocation or `GroupStatement` persistence;
- the Billing Integration API v1 reuses finalized statement and period services
  instead of duplicating calculation logic or exposing internal Admin routes;
- finalized statements remain self-contained after mutable tags, quotas, rates,
  names, or raw collection data change;
- the optional PDF is a technical Billing Statement generated from finalized
  snapshots, not a legal invoice.

## Corrective pass

The final audit found and corrected three PDF/settings edge cases:

- the persistent Statement PDF editor now protects unsaved changes when leaving
  the route or switching Billing settings tabs;
- embedded logos are validated as readable PNG/JPEG images, bounded to 512 KiB
  and 4096 x 4096 pixels, rather than accepting arbitrary base64 with a matching
  media type;
- long PDF footers wrap in the reserved page footer area instead of being
  silently truncated. The multipage deterministic-render test also exercises
  non-ASCII content.

No additional Billing-domain gap was found in the final architecture, data
integrity, authorization, integration, or aggregation review.

## User workflow and UX audit

A final user-centered pass exercised Billing as the person responsible for
storage sales reporting and monthly chargeback. It covered subject costs,
Billing Entity and Group consolidation, statement review/finalization, period
analysis, Rate Plans, customer allocation, automation, and PDF presentation.

The pass corrected the remaining product-facing gaps:

- the static demo now implements the current Billing read contracts and offers
  representative multi-endpoint subjects, entity/group consolidation, drafts,
  finalized statements, period totals, automation history, and settings;
- the statement action selector is labelled `Generate for` so it is not
  mistaken for a list filter;
- demo-only PDF preview is disabled consistently with the read-only settings;
- the settings introduction now describes pricing, customer allocation,
  automation, and statement presentation rather than only the first two tabs.

The desktop flow remained compact and task-oriented. At 390 px, the Billing
overview and responsive subject cards had no horizontal document overflow.

## Validation evidence

Final validation from the repository checkout included:

- backend Billing service/API suite: **105 passed**;
- PDF/API focused suite before the final edge-case hardening: **7 passed**;
- PDF renderer/settings suite after the final hardening: **3 passed**;
- Alembic Billing/current-schema coverage plus the full empty-database migration
  chain round trip: **9 passed**;
- generated database schema documentation matches SQLAlchemy metadata;
- `pip check`: no broken requirements;
- frontend Billing suite: **33 passed** across Billing, demo read models,
  settings, automation, statements, and PDF settings;
- frontend typecheck, lint, and production build: passed;
- static demo production build: passed;
- strict documentation build: passed;
- `git diff --check`: passed.

The authenticated Billing-specific browser smoke used a fresh isolated Admin
session from the repository harness and verified:

- `/admin/billing-settings` renders with the normal Admin shell;
- Statement PDF settings load successfully;
- server-side PDF preview returns HTTP 200;
- a dirty PDF settings draft is preserved when **Keep editing** is chosen;
- switching tabs requires explicit discard and succeeds after confirmation;
- at 390 x 844 in dark mode, `innerWidth`, document width, and body width all
  remained 390 px;
- no browser `pageerror` or console error was produced during the Billing smoke.

A supplementary run of the repository-wide authenticated Admin/Browser harness
also exercised unrelated settings and Browser scenarios. It exposed session or
general-settings failures outside Billing; none of those failures targeted the
Billing routes or the Billing-specific smoke above, so they are not part of this
feature closure.

## Completion criteria

BucketReef can now answer, from canonical and auditable data, what a Billing
Entity consumed, why a technical subject belongs to it, which effective tariff
and storage basis priced each line, what monthly amount was finalized, and how
that result contributes to entity/group annual or custom-period costs. External
accounting systems can ingest finalized results through the dedicated Billing
Integration API without needing Ceph RGW internals.

The implementation backlog that led to this state has therefore been removed;
this validation record is the maintained closure artifact.
