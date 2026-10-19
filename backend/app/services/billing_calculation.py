# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Literal, Optional


StorageChargeBasis = Literal["actual_usage", "allocated_quota"]
StorageQuantityStatus = Literal["complete", "partial", "blocked"]

GIB_BYTES = Decimal(1024**3)
REQUEST_UNIT = Decimal(1000)

# Quantities keep twelve fractional decimal places. Monetary component amounts
# and totals keep six fractional currency units. Rounding is always half-up and
# totals are the sum of already-rounded components.
QUANTITY_QUANTUM = Decimal("0.000000000001")
MONEY_QUANTUM = Decimal("0.000001")
COVERAGE_QUANTUM = Decimal("0.000001")


def _quantize(value: Decimal, quantum: Decimal) -> Decimal:
    return value.quantize(quantum, rounding=ROUND_HALF_UP)


def bytes_to_gib(value: Optional[int]) -> Optional[Decimal]:
    if value is None:
        return None
    return _quantize(Decimal(value) / GIB_BYTES, QUANTITY_QUANTUM)


def bytes_sum_to_average_gib_month(total_bytes: int, observed_days: int) -> Optional[Decimal]:
    if observed_days <= 0:
        return None
    return _quantize(
        Decimal(total_bytes) / Decimal(observed_days) / GIB_BYTES,
        QUANTITY_QUANTUM,
    )


def requests_to_thousands(value: int) -> Decimal:
    return _quantize(Decimal(value) / REQUEST_UNIT, QUANTITY_QUANTUM)


def coverage_ratio(days_collected: int, days_in_month: int) -> Decimal:
    if days_in_month <= 0:
        return Decimal("0").quantize(COVERAGE_QUANTUM)
    return _quantize(Decimal(days_collected) / Decimal(days_in_month), COVERAGE_QUANTUM)


def component_amount(unit_price: Optional[Decimal], quantity: Optional[Decimal]) -> Optional[Decimal]:
    if unit_price is None or quantity is None:
        return None
    return _quantize(unit_price * quantity, MONEY_QUANTUM)


def extrapolation_factor(observed: int, expected: int) -> Optional[Decimal]:
    if observed <= 0 or expected <= 0:
        return None
    return _quantize(Decimal(expected) / Decimal(observed), QUANTITY_QUANTUM)


def extrapolate_monetary_amount(
    amount: Optional[Decimal],
    *,
    observed: int,
    expected: int,
) -> Optional[Decimal]:
    if amount is None:
        return None
    factor = extrapolation_factor(observed, expected)
    if factor is None:
        return None
    return _quantize(amount * factor, MONEY_QUANTUM)


def extrapolate_quantity(
    quantity: Optional[Decimal],
    *,
    observed: int,
    expected: int,
) -> Optional[Decimal]:
    if quantity is None:
        return None
    factor = extrapolation_factor(observed, expected)
    if factor is None:
        return None
    return _quantize(quantity * factor, QUANTITY_QUANTUM)


def monetary_total(components: Iterable[Optional[Decimal]]) -> Optional[Decimal]:
    present = [value for value in components if value is not None]
    if not present:
        return None
    return _quantize(sum(present, Decimal("0")), MONEY_QUANTUM)


@dataclass(frozen=True)
class StorageQuantity:
    basis: StorageChargeBasis
    quantity_gib_month: Optional[Decimal]
    observations_collected: int
    observations_expected: int
    calendar_days: int
    coverage_ratio: Decimal
    status: StorageQuantityStatus
    issues: tuple[str, ...] = ()


def measured_storage_quantity(
    *,
    total_bytes: int,
    observed_days: int,
    days_in_month: int,
) -> StorageQuantity:
    quantity = bytes_sum_to_average_gib_month(total_bytes, observed_days)
    complete = observed_days == days_in_month and observed_days > 0
    issues: tuple[str, ...] = () if complete else ("missing_storage_observations",)
    return StorageQuantity(
        basis="actual_usage",
        quantity_gib_month=quantity,
        observations_collected=observed_days,
        observations_expected=days_in_month,
        calendar_days=days_in_month,
        coverage_ratio=coverage_ratio(observed_days, days_in_month),
        status="complete" if complete else "partial",
        issues=issues,
    )


def allocated_quota_storage_quantity(
    *,
    observations: Iterable[tuple[Optional[int], str]],
    days_in_month: int,
    expected_observations: int,
) -> StorageQuantity:
    valid_bytes = 0
    valid_days = 0
    observed_rows = 0
    issues: set[str] = set()
    for quota_size_bytes, quota_state in observations:
        observed_rows += 1
        if quota_state == "valid" and quota_size_bytes is not None and quota_size_bytes > 0:
            valid_bytes += quota_size_bytes
            valid_days += 1
            continue
        if quota_state == "disabled":
            issues.add("disabled_quota")
        elif quota_state == "unlimited":
            issues.add("unlimited_quota")
        elif quota_state == "invalid":
            issues.add("invalid_quota")
        else:
            issues.add("missing_quota_observation")

    if observed_rows < expected_observations:
        issues.add("missing_quota_observation")

    quantity = None
    if valid_days > 0 and days_in_month > 0:
        quantity = _quantize(
            Decimal(valid_bytes) / Decimal(days_in_month) / GIB_BYTES,
            QUANTITY_QUANTUM,
        )
    complete = valid_days == expected_observations and not issues and expected_observations > 0
    return StorageQuantity(
        basis="allocated_quota",
        quantity_gib_month=quantity,
        observations_collected=valid_days,
        observations_expected=expected_observations,
        calendar_days=days_in_month,
        coverage_ratio=coverage_ratio(valid_days, expected_observations),
        status="complete" if complete else "blocked",
        issues=tuple(sorted(issues)),
    )
