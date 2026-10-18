# Billing Integration API v1

BucketReef exposes a versioned, read-only Billing integration contract for
invoicing, ERP, accounting, reporting, or chargeback systems. The integration
API reads canonical finalized Billing Statements and period aggregates; it does
not expose the internal `/admin` Billing API as a supported external contract.

The v1 base path is:

```text
/api/integrations/billing/v1
```

## Authentication

Create a dedicated Admin API token with only the `billing:read` scope from
**Profile -> API tokens**. The integration API requires an
`Authorization: Bearer <token>` header. Browser/UI sessions and S3 access keys
are not accepted as integration credentials.

Example:

```bash
curl -H 'Authorization: Bearer <token>' \
  https://bucketreef.example/api/integrations/billing/v1/entities
```

Token expiry, rotation, and revocation use the standard BucketReef API-token
lifecycle. Revoke a token immediately when an integration is retired or its
credential may have been exposed.

## Resources

The initial v1 contract exposes these read-only resources:

| Route | Purpose |
| --- | --- |
| `GET /entities` | Billing Entity identities and external IDs |
| `GET /groups` | Billing Entity Groups and historized memberships |
| `GET /entities/{id}/costs` | Finalized Entity cost over a requested period |
| `GET /groups/{id}/costs` | Finalized Group cost over a requested period |
| `GET /statements` | Paginated finalized Billing Statements |
| `GET /statements/{public_id}` | One finalized statement and all snapshot lines |
| `GET /statements/{public_id}/export.json` | Versioned JSON snapshot export |
| `GET /statements/{public_id}/export.csv` | Flat CSV snapshot export |

Draft statements are deliberately absent from the integration API. A draft
`public_id` returns `404` until the statement is finalized.

### Billing Entity Groups

`GET /groups` returns the historized membership ranges. Add `?month=YYYY-MM` to
return only memberships effective for that month. A Billing Entity may appear
in several analytical groups; this does not create another statement or bill
the entity twice.

## Period costs

Entity and Group cost endpoints use an explicit period contract:

```text
?period=month&month=2026-09
?period=year&year=2026
?period=range&start_month=2026-01&end_month=2026-06
```

Do not mix parameters from different period modes. Results are derived from
finalized monthly statements and include:

- expected, finalized, missing, and unfinalized months;
- `complete` state;
- totals separated by currency;
- contributing statement IDs, public IDs, and months;
- storage charge bases present in the contributing lines;
- per-month Entity contributions and month-effective Group membership.

A missing or unfinalized month is never interpreted as zero cost. Annual and
custom-range results do not re-rate historical usage.

## Statement pagination and filtering

`GET /statements` returns only finalized statements in descending month/order.
Supported filters are:

- `start_month=YYYY-MM`;
- `end_month=YYYY-MM`;
- `billing_entity_id=<id>`;
- `billing_entity_external_id=<external-id>`;
- `currency=EUR` (or another three-letter currency);
- `limit=1..200`;
- `cursor=<opaque-cursor>`.

When `has_more` is true, send the returned `next_cursor` unchanged in the next
request. The cursor is opaque and must not be parsed or modified by consumers.

## Statement and line semantics

The statement payload uses the persisted finalized snapshot. It contains both
BucketReef's technical `statement_id` and stable `statement_public_id`, plus the
Billing Entity `external_id` when configured.

Each line exposes the information needed to explain or reprocess the charge:

- subject and endpoint identity snapshots;
- membership reasons captured at generation time;
- measured usage/storage quantities and coverage;
- `storage_charge_basis` (`actual_usage` or `allocated_quota`);
- the exact `priced_storage_quantity` used by the calculation;
- Rate Plan/Card resolution and effective version dates;
- unit prices;
- component amounts and total.

Measured GiB-month and allocated-quota GiB-month remain distinct. An aggregate
can list both storage charge bases, but BucketReef never publishes one synthetic
storage quantity that combines them.

JSON decimal monetary and quantity values are serialized as decimal strings so
consumers do not need to depend on binary floating-point behavior. Dates use
ISO-8601 formats.

## CSV and JSON exports

Exports are produced from the same finalized snapshot as the detail endpoint.
They do not recalculate current tags, quotas, rates, or memberships. Use the
JSON export when the complete structured provenance is needed; use CSV for
flat accounting/reporting ingestion.

## v1 compatibility policy

The `/v1` contract is a supported external boundary. Within v1 BucketReef will
not remove or rename existing routes/fields, change an existing field's type,
or silently redefine Billing semantics. New optional fields, new read-only
routes, and new enum values may be added when they preserve existing consumer
behavior. Consumers should ignore unknown response fields.

Any change that requires consumers to rename fields, change request structure,
reinterpret existing values, or adopt incompatible authentication semantics
requires a new API version. Security fixes may reject requests that were never
valid under the documented v1 contract.

## Product boundary

Billing Statements are BucketReef technical cost/chargeback records. This API
does not provide legal invoice numbering, VAT/tax logic, payment status,
payment terms, credit notes, or accounting-ledger workflows. Those belong to
the external invoicing/accounting system consuming this API.

## Related pages

- [Billing operations](billing.md)
- [API tokens](../security/api-tokens.md)
- [Billing platform](../platform/billing.md)
