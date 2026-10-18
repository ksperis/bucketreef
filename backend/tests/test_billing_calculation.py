# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from decimal import Decimal

import pytest

from app.services.billing_calculation import (
    allocated_quota_storage_quantity,
    bytes_sum_to_average_gib_month,
    bytes_to_gib,
    component_amount,
    measured_storage_quantity,
    monetary_total,
    requests_to_thousands,
)


GIB = 1024**3


def test_decimal_quantity_helpers_are_exact_and_deterministic():
    assert bytes_to_gib(GIB) == Decimal("1.000000000000")
    assert bytes_to_gib(GIB * 9_876_543_210) == Decimal("9876543210.000000000000")
    assert requests_to_thousands(1) == Decimal("0.001000000000")
    assert requests_to_thousands(9_876_543_210_123) == Decimal("9876543210.123000000000")
    assert bytes_sum_to_average_gib_month(3 * GIB, 2) == Decimal("1.500000000000")


def test_money_uses_explicit_half_up_rounding_and_rounded_component_sum():
    tiny = component_amount(Decimal("0.000001"), Decimal("0.500000000000"))
    large = component_amount(Decimal("123456.123456"), Decimal("9876543210.123456789012"))

    assert tiny == Decimal("0.000001")
    assert large == Decimal("1219319737867520.030346")
    assert monetary_total((tiny, large, None)) == Decimal("1219319737867520.030347")


def test_zero_quantity_and_missing_price_components_remain_exact():
    assert component_amount(Decimal("12.345678"), Decimal("0")) == Decimal("0.000000")
    assert component_amount(None, Decimal("999999999.999999999999")) is None
    assert monetary_total((Decimal("0.000000"), None)) == Decimal("0.000000")


def test_recomputation_with_same_decimal_inputs_is_identical():
    price = Decimal("0.000123")
    quantity = bytes_to_gib(9_876_543_210_123_456)

    first = component_amount(price, quantity)
    second = component_amount(price, bytes_to_gib(9_876_543_210_123_456))

    assert first == second == Decimal("1131.384461")


@pytest.mark.parametrize("days", [28, 29, 30, 31])
def test_measured_storage_quantity_handles_all_month_lengths(days):
    quantity = measured_storage_quantity(
        total_bytes=days * 2 * GIB,
        observed_days=days,
        days_in_month=days,
    )

    assert quantity.quantity_gib_month == Decimal("2.000000000000")
    assert quantity.coverage_ratio == Decimal("1.000000")
    assert quantity.status == "complete"


def test_measured_storage_quantity_reports_partial_coverage_without_filling_days():
    quantity = measured_storage_quantity(
        total_bytes=30 * GIB,
        observed_days=30,
        days_in_month=31,
    )

    assert quantity.quantity_gib_month == Decimal("1.000000000000")
    assert quantity.coverage_ratio == Decimal("0.967742")
    assert quantity.status == "partial"
    assert quantity.issues == ("missing_storage_observations",)


def test_allocated_quota_prorates_mid_month_change_by_calendar_day():
    observations = [(100 * GIB, "valid")] * 15 + [(200 * GIB, "valid")] * 16

    quantity = allocated_quota_storage_quantity(
        observations=observations,
        days_in_month=31,
        expected_observations=31,
    )

    assert quantity.quantity_gib_month == Decimal("151.612903225806")
    assert quantity.coverage_ratio == Decimal("1.000000")
    assert quantity.status == "complete"
    assert quantity.issues == ()


def test_allocated_quota_missing_day_is_blocking_and_not_backfilled():
    quantity = allocated_quota_storage_quantity(
        observations=[(100 * GIB, "valid")] * 30,
        days_in_month=31,
        expected_observations=31,
    )

    assert quantity.quantity_gib_month == Decimal("96.774193548387")
    assert quantity.coverage_ratio == Decimal("0.967742")
    assert quantity.status == "blocked"
    assert quantity.issues == ("missing_quota_observation",)


@pytest.mark.parametrize(
    ("state", "issue"),
    [
        ("disabled", "disabled_quota"),
        ("unlimited", "unlimited_quota"),
        ("invalid", "invalid_quota"),
        ("missing", "missing_quota_observation"),
    ],
)
def test_allocated_quota_non_billable_states_block_storage_pricing(state, issue):
    quantity = allocated_quota_storage_quantity(
        observations=[(None, state)],
        days_in_month=31,
        expected_observations=1,
    )

    assert quantity.quantity_gib_month is None
    assert quantity.coverage_ratio == Decimal("0.000000")
    assert quantity.status == "blocked"
    assert quantity.issues == (issue,)
