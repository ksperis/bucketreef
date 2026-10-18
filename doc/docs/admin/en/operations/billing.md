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
are built later from finalized Billing Statements, rather than from repeated live
recalculation of this preview.

## Scheduler integration

- Compose scheduler calls daily collection with configurable day offset.
- Helm supports `billingCronJob` values (`schedule`, `dayOffset`, token).

## Retention

Billing daily tables are purged by the shared `DataRetentionService` (used by billing and quota jobs).

- `BILLING_DAILY_RETENTION_DAYS` (default `365`)
- `0` disables billing purge

## Related pages

- [Operations: API tokens](../security/api-tokens.md)
- [Operations: quota monitoring and history](quota-monitoring.md)
- [Operations: observability](observability.md)
