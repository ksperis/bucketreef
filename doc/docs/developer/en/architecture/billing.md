# Architecture: Billing calculation

BucketReef Billing keeps metering and charge calculation deterministic so that
the same historical inputs always produce the same monthly result. The month is
the canonical calculation period; longer reporting periods aggregate monthly
results instead of recalculating raw observations with a different formula.

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
future immutable Billing Statements must be explainable from the stored
historical observations without consulting mutable live RGW state.
