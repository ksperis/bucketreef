# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from pydantic import ValidationError

from app.models.bucket import BucketQuotaUpdate
from app.models.portal_requests import PortalAccountQuotaChangeRequestCreate
from app.models.s3_account import S3AccountCreate, S3AccountUpdate
from app.models.s3_user import S3UserCreate, S3UserUpdate


VALID_QUOTA_UNITS = ("MiB", "GiB", "TiB")


def _validate_all_quota_writes(unit: str) -> None:
    S3AccountCreate(
        name="quota-account",
        rgw_tenant="",
        quota_max_size_gb=1,
        quota_max_size_unit=unit,
        storage_endpoint_id=1,
    )
    S3AccountUpdate(quota_max_size_gb=1, quota_max_size_unit=unit)
    S3UserCreate(
        name="quota-user",
        rgw_tenant="",
        quota_max_size_gb=1,
        quota_max_size_unit=unit,
        storage_endpoint_id=1,
    )
    S3UserUpdate(quota_max_size_gb=1, quota_max_size_unit=unit)
    BucketQuotaUpdate(enabled=True, max_size_gb=1, max_size_unit=unit)
    PortalAccountQuotaChangeRequestCreate(
        request_type="account_quota_change",
        direction="increase",
        target_quota_value=1,
        target_quota_unit=unit,
    )


@pytest.mark.parametrize("unit", VALID_QUOTA_UNITS)
def test_quota_write_models_accept_canonical_size_units(unit: str) -> None:
    _validate_all_quota_writes(unit)


@pytest.mark.parametrize("unit", ("B", "GB", "gib"))
def test_quota_write_models_reject_noncanonical_size_units(unit: str) -> None:
    validators = (
        lambda: S3AccountCreate(
            name="quota-account",
            rgw_tenant="",
            quota_max_size_gb=1,
            quota_max_size_unit=unit,
            storage_endpoint_id=1,
        ),
        lambda: S3AccountUpdate(quota_max_size_gb=1, quota_max_size_unit=unit),
        lambda: S3UserCreate(
            name="quota-user",
            rgw_tenant="",
            quota_max_size_gb=1,
            quota_max_size_unit=unit,
            storage_endpoint_id=1,
        ),
        lambda: S3UserUpdate(quota_max_size_gb=1, quota_max_size_unit=unit),
        lambda: BucketQuotaUpdate(enabled=True, max_size_gb=1, max_size_unit=unit),
        lambda: PortalAccountQuotaChangeRequestCreate(
            request_type="account_quota_change",
            direction="increase",
            target_quota_value=1,
            target_quota_unit=unit,
        ),
    )

    for validate in validators:
        with pytest.raises(ValidationError):
            validate()
