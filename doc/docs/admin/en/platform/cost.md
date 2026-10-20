# Feature: Cost in Admin

## When to use

Use this page when you need a monthly usage and estimated cost overview for Ceph-backed tenants.

## Prerequisites

- `ui_admin` or `ui_superadmin` role.
- `cost_enabled=true` in general settings.
- At least one Ceph endpoint with cost data collected for the selected month.
- A configured Cost model if you need estimated costs, not only usage totals.

## Before you start

Pick the month and subject type you want to explain. Cost views are most useful when you compare the summary cards, subject table, and selected subject charts together.

## Steps

1. Open `/admin/cost`.
2. Choose the month, Ceph endpoint, subject type, and ordering used for the analysis.
3. Review the summary cards for storage, traffic, request volume, source coverage, and estimated cost.
4. If scheduler data is stale, run **Collect daily** for one UTC day and check the collection result. Partial collection errors are listed below the action.
5. Inspect the paginated subjects table to identify the account or user that drives the highest usage.
6. Select a subject to open daily charts and review storage, traffic, requests, source coverage, and the effective pricing source.
7. Export CSV only after the selected endpoint and month have cost data.

## Expected result

You can compare monthly cost exposure across tenants and drill into the subjects that explain the current totals.

## You are done when

The selected month shows enough storage and usage source coverage to support the estimate, the highest-cost subject can be traced to storage, traffic, or request volume, and any collection or Cost-model gaps are understood.

## If you do not see this action

Check `cost_enabled`, cost collection status, Ceph endpoint selection, Cost settings, and your Admin role.

## Limits / feature flags

!!! note
    Cost analytics are available only when the Cost feature is enabled and cost collection is configured.

!!! note
    Estimated costs use the global Cost model, with a complete per-endpoint override when one is configured. Without a Cost model, usage and coverage remain visible while estimated cost is unavailable.

Configure pricing from **Admin > Settings > Cost** or directly at `/admin/cost-settings`. Cost settings remain available while the Cost feature is disabled so pricing can be prepared before activation.

## Related pages

- [Workspace: Admin](index.md)
- [Ops / Operations: cost](../operations/cost.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/admin-cost.light.png" alt="Admin Cost page with scope controls, manual collection, monthly summary, and subject totals" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/admin-cost.dark.png" alt="Admin Cost page with scope controls, manual collection, monthly summary, and subject totals" loading="lazy">
</div>
