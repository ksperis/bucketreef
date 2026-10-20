# Operations: Cost

Cost collection is disabled by default and must be enabled explicitly.

## Enablement model

Cost uses the `cost_enabled` application setting as its master switch.
Administrators can change it in general settings; deployments can force it
with `FEATURE_COST_ENABLED=true` or `false`.

Manager and Portal exposure use separate feature policies and both default to
**Targeted activation**. In Manager, enable **Cost estimation** for an eligible
persisted RGW Account or RGW User. S3 Connection contexts do not expose cost
estimation. In Portal, enable **Cost estimation** for the project through its
Portal settings override.

The **Costs** tab in **Usage & Metrics** is shown only when the global Cost
switch and the effective Manager resource or Portal project setting are both
enabled. When it is hidden, that workspace does not call its cost endpoint.

Cost settings remain available at `/admin/cost-settings` even while the
feature is disabled, so the model can be prepared before activation.

## Cost model

Cost estimates use one optional global model with four unit prices:

- storage per GB-month;
- egress per GB;
- ingress per GB;
- requests per 1,000 operations.

The global model also defines the shared three-letter currency.

An endpoint can have one complete override containing all four prices. When an
override exists, it replaces the global prices for that endpoint. Endpoints
without an override use the global model.

Endpoint overrides require a global model. Removing the global model also
removes its endpoint overrides. Without a Cost model, Admin, Manager and Portal
still show storage, traffic, request, and coverage data where Cost is exposed,
but estimated costs are unavailable.

There are no subject assignments, effective-date tariffs, statements, or
invoice-generation concepts in the Cost model.

## Manual daily collection

```bash
curl -X POST "http://localhost:8000/api/internal/cost/collect/daily?day=YYYY-MM-DD" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

Admins can also trigger one UTC day from `/admin/cost`. The result reports
endpoint count, storage records, usage records, and structured partial-collection
errors (`stage`, endpoint, and subject identifiers when applicable). Exception
details stay in backend logs instead of being returned by the API.

## Coverage

Cost coverage is tracked separately for storage snapshots and RGW usage logs.
The UI shows both source counts when they differ, because a month can have storage data without usage traffic, or usage traffic without a storage snapshot.
Treat estimated costs as provisional when coverage is low or source counts do not match.

## Scheduler integration

- Compose scheduler calls daily collection with configurable day offset.
- Helm supports `costCronJob` values (`schedule`, `dayOffset`, token).

## Retention

Cost daily tables are purged by the shared `DataRetentionService` (used by cost and quota jobs).

- `COST_DAILY_RETENTION_DAYS` (default `365`)
- `0` disables cost purge

## Related pages

- [Operations: API tokens](../security/api-tokens.md)
- [Operations: quota monitoring and history](quota-monitoring.md)
- [Operations: observability](observability.md)
