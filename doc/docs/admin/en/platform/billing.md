# Feature: Billing in Admin

## When to use

Use this page when you need a monthly usage and estimated cost overview for Ceph-backed tenants.

## Prerequisites

- `ui_admin` or `ui_superadmin` role.
- `billing_enabled=true` in general settings.
- At least one Ceph endpoint with billing data collected for the selected month.
- A configured billing rate card if you need estimated costs, not only usage totals.

## Before you start

Pick the month and subject type you want to explain. Billing views are most useful when you compare the summary cards, subject table, and selected subject charts together.

## Configure Billing

Superadmins configure tariff versions, Billing Entities, and Billing Groups in **Settings → Billing** (`/admin/billing-settings`). The settings page is available even when Billing collection is disabled, so pricing and business grouping can be prepared before enabling collection.

### Rate Plans

Use the **Rate Plans** tab to manage tariff versions. Rate Plans can be global or scoped to one S3 endpoint. Pricing periods are month-aligned: `effective_from` is the first day of a month and an optional `effective_to` is the last day of a month. Future versions can be edited or deleted. Once a version becomes effective it is immutable; use **Create new version** to start replacement pricing on a future month while preserving historical estimates.

Each tariff version also defines how the storage component is charged. **Actual usage** uses measured storage consumption. **Allocated quota** prices the storage capacity reserved by the subject. The charge basis is versioned with the tariff, so changing it for a future month requires a new version. Traffic and request components continue to use measured activity in both modes.

Quota-based calculation uses the historical daily quota observations recorded for the same Billing subject level. A missing, disabled, unlimited, or invalid quota observation makes quota-based storage pricing incomplete instead of treating the capacity as zero. Past months are never recalculated from the subject's current live quota.

### Billing Entities

Use the **Billing Entities** tab to group technical Accounts or S3 Users into business units such as teams, laboratories, projects, or cost centers. Each entity uses one subject level only.

Membership uses the existing Admin-managed tag catalog plus explicit exceptions:

1. matching any selected tag includes a subject;
2. an explicit include adds a subject even without a matching tag;
3. an explicit exclude wins last.

The editor can preview the resolved members before saving. The preview explains why each subject matched and highlights subjects that would belong to more than one active Billing Entity. Resolve these conflicts before relying on the entity for statement generation; BucketReef does not silently choose an entity or double bill a conflicting subject.

An entity may optionally receive a global Rate Plan through month-effective assignment periods. Current and future periods must not overlap. Historical assignment periods are read-only so later edits to names or membership cannot rewrite prior pricing intent.

### Effective pricing

For an Account or S3 User, BucketReef resolves pricing in this order: **Direct assignment → Billing Entity → Endpoint → Global**. The effective tariff version is selected for the requested month, and that same version determines both the unit prices and whether storage uses **Actual usage** or **Allocated quota**.

The Billing page shows the winning source, Rate Plan, and effective version for resolved costs. A missing effective version is shown as missing pricing. Ambiguous assignments or membership in several Billing Entities are shown as rate-resolution conflicts; BucketReef does not silently fall back to another tariff or treat the missing cost as zero.

### Billing Groups

Use the **Billing Groups** tab to organize Billing Entities into analytical scopes such as Research, DSI, a region, or a programme. Groups are reporting classifications only: they do not change which Accounts or S3 Users belong to an entity, which Rate Plan applies, or how monthly costs are calculated.

Membership is explicit and month-effective. For each Billing Entity in a group, choose a start month and optionally an end month. The editor shows current, scheduled, and historical memberships and rejects overlapping periods for the same entity/group pair. One Billing Entity may belong to several groups at the same time; this is expected for analytical classifications and is not a billing conflict.

Deactivating a group hides it from active administration without deleting its membership history. Historical periods remain available so later reporting can keep the organizational classification that applied for the requested month.

Billing Groups do not convert currencies or create independent billing statements. Group costs are derived from the canonical Billing Entity results and remain separated by currency. Multi-month and annual reporting reads finalized monthly Billing Entity statements and applies the group membership that was effective for each contributing month.

### Statement automation

Use the **Automation** tab to choose how a completed month becomes Billing
Statements. BucketReef provides three predefined workflows rather than a custom
workflow engine:

- **Manual generation and finalization** leaves all statement lifecycle actions
  to an administrator in `/admin/billing`.
- **Automatic draft, manual finalization** creates the monthly drafts on the
  configured day and leaves final review/finalization to an administrator.
- **Automatic draft and finalization** generates drafts and finalizes only the
  statements that pass the same canonical validation as a manual finalization.

The configured **Run on day of month** applies to the previous completed month
and uses UTC calendar dates. Automatic finalization always requires complete
storage and usage coverage, complete historical quota coverage for any
`allocated_quota` line, resolved entity membership, usable pricing, and the
normal immutable-statement checks. These safety gates are deliberately not
configurable to a weaker policy.

The optional **Require every Billing subject to be assigned** policy adds a
global gate: if any Account or S3 User in the monthly analysis belongs to no
active Billing Entity, automatic finalization stops for the month. The recent
runs table records generated, finalized, blocked, failed, and unassigned counts
without exposing storage credentials or other secret material.

## Review monthly Billing

`/admin/billing` keeps the operational Account/User view and adds consolidated
business views under the same page:

- **Subjects** keeps the endpoint-scoped Account/User analysis, daily charts,
  manual collection, and CSV export. The endpoint selector applies only here.
- **Billing Entities** consolidates the selected month across every endpoint
  represented by the entity. It shows totals per currency, source coverage,
  membership conflicts, unassigned subjects, and the effective storage charge
  basis. Open an entity to drill down by endpoint and Account/S3 User.
- **Billing Groups** aggregates the Billing Entities whose memberships are
  effective for the selected month. Currencies remain separate, and opening a
  group preserves the drill-down from entity to endpoint and technical subject.
- **Statements** prepares persistent monthly Billing Entity snapshots. Drafts
  can be generated or regenerated, reviewed down to endpoint and Account/S3
  User, exported as CSV/JSON, and finalized after an explicit confirmation.
  Finalized statements are immutable historical results and can also be
  downloaded as human-readable PDF cost statements.

These Entity and Group views are live monthly previews. They resolve current
membership rules and the tariff version effective for the selected month; they
are distinct from persisted historical statements. The Statements view consumes
the persisted snapshot instead of recalculating a finalized result from current
tags, quotas, or Rate Plans. Conflicted subjects stay visible but are excluded
from consolidated totals so ambiguity cannot silently become double billing.

The Statements view also includes finalized-period analysis for a Billing Entity
or Billing Group. Choose the selected month, a calendar year, or a custom
month-aligned range. Totals remain separated by currency and list missing or
unfinalized months explicitly. The monthly breakdown shows which Billing Entity
contributed each amount and links back to its persisted statement snapshot.

For **Actual usage**, the storage quantity used for pricing is measured storage.
For **Allocated quota**, the detail keeps measured storage visible for context
and shows the prorated historical quota separately as the billed quantity. An
incomplete quota history is reported as incomplete pricing rather than as zero
capacity.

## Steps

1. Open `/admin/billing`.
2. Choose the month. It applies to Subjects, Billing Entities, Billing Groups, and monthly Statement preparation.
3. In **Subjects**, choose the Ceph endpoint, subject type, and ordering. Review storage, traffic, requests, source coverage, estimated cost, and Rate Plan provenance.
4. If scheduler data is stale, run **Collect daily** for one UTC day and check the collection result. Partial collection errors are listed below the action.
5. Select a subject to open daily charts, or export the endpoint-scoped CSV after billing data is available.
6. In **Billing Entities**, review consolidated totals and coverage, then open an entity to explain its amount down to endpoint and Account/S3 User. For quota-based pricing, compare measured storage with the billed quota quantity.
7. In **Billing Groups**, review month-effective organizational totals and open a group to trace each currency total through its member entities and technical subjects.
8. In **Statements**, generate the required Billing Entity draft, review its persisted lines and blockers, then finalize it explicitly. Use CSV/JSON when an external process needs the exact snapshot.
9. In **Finalized period analysis**, choose an Entity or Group and switch between month, calendar year, and custom range. Treat any listed missing or unfinalized month as incomplete coverage rather than zero cost.
10. In **Settings → Billing → Automation**, choose whether the next completed month should remain manual, generate drafts automatically, or generate and finalize eligible statements automatically. Review the recent run history after the configured day.
11. In **Settings → Billing → Statement PDF**, configure the organization name,
    optional PNG/JPEG logo, accent color, statement note, and footer. Use
    **Generate preview** to inspect the server-rendered format before saving.

The PDF always identifies itself as a technical cost statement, not a legal
commercial invoice. Presentation settings are independent from the immutable
financial snapshot: changing the logo, color, note, or footer later can change
the appearance of a re-export, but never its persisted amounts or line data.

## Expected result

You can compare monthly billing exposure at the technical subject, Billing Entity,
and Billing Group levels and explain a consolidated amount down to its endpoint,
subject, Rate Plan provenance, and storage charge basis.

## You are done when

The selected month shows enough storage, usage, and quota coverage to support the
effective pricing mode; consolidated entity/group totals are traceable to their
technical subjects; and membership, collection, or Rate Plan gaps are understood.

## If you do not see this action

Check `billing_enabled`, billing collection status, Ceph endpoint selection, rate-card configuration, and your Admin role.

## Limits / feature flags

!!! note
    Billing analytics are available only when the Billing feature is enabled and billing collection is configured.

!!! note
    Estimated costs depend on configured rate cards. `/admin/billing` remains a consultation page; create and version pricing in **Settings → Billing**. Explicit account/user rate-card assignments are not managed by that settings page.

## Related pages

- [Workspace: Admin](index.md)
- [Ops / Operations: billing](../operations/billing.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/admin-billing.light.png" alt="Admin Billing page showing a consolidated Billing Entity with endpoint, subject, coverage, and quota-based pricing details" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/admin-billing.dark.png" alt="Admin Billing page showing a consolidated Billing Entity with endpoint, subject, coverage, and quota-based pricing details" loading="lazy">
</div>
