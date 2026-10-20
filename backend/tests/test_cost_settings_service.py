# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.db import CostEndpointOverride, CostModel, StorageEndpoint
from app.models.cost import CostEndpointOverride as CostEndpointOverridePayload
from app.models.cost import CostGlobalModel, CostSettings
from app.services.cost_settings_service import CostSettingsService


def _endpoint(db_session, name: str = "ceph-cost") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _global_model() -> CostGlobalModel:
    return CostGlobalModel(
        currency="eur",
        storage_gb_month_price=Decimal("0.020000"),
        egress_gb_price=Decimal("0.030000"),
        ingress_gb_price=Decimal("0.010000"),
        requests_per_1000_price=Decimal("0.004000"),
    )


def test_cost_settings_round_trip_global_model_and_complete_endpoint_override(db_session):
    endpoint = _endpoint(db_session)
    service = CostSettingsService(db_session)

    saved = service.save_settings(
        CostSettings(
            model=_global_model(),
            endpoint_overrides=[
                CostEndpointOverridePayload(
                    storage_endpoint_id=endpoint.id,
                    storage_gb_month_price=Decimal("0.100000"),
                    egress_gb_price=Decimal("0.200000"),
                    ingress_gb_price=Decimal("0.300000"),
                    requests_per_1000_price=Decimal("0.400000"),
                )
            ],
        )
    )

    assert saved.model is not None
    assert saved.model.currency == "EUR"
    assert saved.model.storage_gb_month_price == Decimal("0.020000")
    assert saved.endpoint_overrides[0].storage_endpoint_id == endpoint.id
    assert saved.endpoint_overrides[0].requests_per_1000_price == Decimal("0.400000")
    assert db_session.get(CostModel, 1) is not None
    assert db_session.query(CostEndpointOverride).count() == 1


def test_cost_settings_remove_override_falls_back_to_global_configuration(db_session):
    endpoint = _endpoint(db_session)
    service = CostSettingsService(db_session)
    service.save_settings(
        CostSettings(
            model=_global_model(),
            endpoint_overrides=[
                CostEndpointOverridePayload(
                    storage_endpoint_id=endpoint.id,
                    storage_gb_month_price=1,
                    egress_gb_price=1,
                    ingress_gb_price=1,
                    requests_per_1000_price=1,
                )
            ],
        )
    )

    saved = service.save_settings(CostSettings(model=_global_model(), endpoint_overrides=[]))

    assert saved.model is not None
    assert saved.endpoint_overrides == []
    assert db_session.query(CostEndpointOverride).count() == 0


def test_cost_settings_clear_model_also_clears_endpoint_overrides(db_session):
    endpoint = _endpoint(db_session)
    service = CostSettingsService(db_session)
    service.save_settings(
        CostSettings(
            model=_global_model(),
            endpoint_overrides=[
                CostEndpointOverridePayload(
                    storage_endpoint_id=endpoint.id,
                    storage_gb_month_price=1,
                    egress_gb_price=1,
                    ingress_gb_price=1,
                    requests_per_1000_price=1,
                )
            ],
        )
    )

    saved = service.save_settings(CostSettings(model=None, endpoint_overrides=[]))

    assert saved.model is None
    assert saved.endpoint_overrides == []
    assert db_session.get(CostModel, 1) is None
    assert db_session.query(CostEndpointOverride).count() == 0


def test_cost_settings_reject_unknown_endpoint(db_session):
    service = CostSettingsService(db_session)
    payload = CostSettings(
        model=_global_model(),
        endpoint_overrides=[
            CostEndpointOverridePayload(
                storage_endpoint_id=999,
                storage_gb_month_price=1,
                egress_gb_price=1,
                ingress_gb_price=1,
                requests_per_1000_price=1,
            )
        ],
    )

    with pytest.raises(ValueError, match="Unknown storage endpoint id: 999"):
        service.save_settings(payload)


def test_cost_settings_require_global_model_and_complete_nonnegative_prices():
    with pytest.raises(ValidationError, match="Endpoint overrides require a global cost model"):
        CostSettings(
            model=None,
            endpoint_overrides=[
                CostEndpointOverridePayload(
                    storage_endpoint_id=1,
                    storage_gb_month_price=0,
                    egress_gb_price=0,
                    ingress_gb_price=0,
                    requests_per_1000_price=0,
                )
            ],
        )

    with pytest.raises(ValidationError):
        CostGlobalModel(
            currency="EUR",
            storage_gb_month_price=-1,
            egress_gb_price=0,
            ingress_gb_price=0,
            requests_per_1000_price=0,
        )
