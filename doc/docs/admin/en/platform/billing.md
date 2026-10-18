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

Superadmins configure tariff versions and Billing Entities in **Settings → Billing** (`/admin/billing-settings`). The settings page is available even when Billing collection is disabled, so pricing and business grouping can be prepared before enabling collection.

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

## Steps

1. Open `/admin/billing`.
2. Choose the month, Ceph endpoint, subject type, and ordering used for the analysis.
3. Review the summary cards for storage, traffic, request volume, source coverage, and estimated cost.
4. If scheduler data is stale, run **Collect daily** for one UTC day and check the collection result. Partial collection errors are listed below the action.
5. Inspect the paginated subjects table to identify the account or user that drives the highest usage.
6. Select a subject to open daily charts and review storage, traffic, requests, source coverage, and rate-card status over time.
7. Export CSV only after the selected endpoint and month have billing data.

## Expected result

You can compare monthly billing exposure across tenants and drill into the subjects that explain the current totals.

## You are done when

The selected month shows enough storage and usage source coverage to support the estimate, the highest-cost subject can be traced to storage, traffic, or request volume, and any collection or rate-card gaps are understood.

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
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/admin-billing.light.png" alt="Admin Billing page with scope controls, manual collection, monthly summary, and subject totals" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/admin-billing.dark.png" alt="Admin Billing page with scope controls, manual collection, monthly summary, and subject totals" loading="lazy">
</div>
