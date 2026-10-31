# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional, TypeAlias, TypeVar

from sqlalchemy import func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.db import (
    CostEndpointOverride,
    CostModel,
    CostStorageDaily,
    CostUsageDaily,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
)
from app.services.cost_calculations import (
    CostPeriod,
    CostTotals,
    EffectiveCostModel,
    bytes_to_gb,
)

CostSubject: TypeAlias = S3Account | S3User
_CostDailyRow = TypeVar("_CostDailyRow", CostUsageDaily, CostStorageDaily)


def _cost_subject_model(subject_type: str) -> type[S3Account] | type[S3User]:
    if subject_type == "account":
        return S3Account
    if subject_type == "s3_user":
        return S3User
    raise ValueError("Invalid subject type")


def _daily_subject_column(
    model: type[_CostDailyRow],
    subject_type: str,
) -> InstrumentedAttribute[Optional[int]]:
    if subject_type == "account":
        return model.s3_account_id
    if subject_type == "s3_user":
        return model.s3_user_id
    raise ValueError("Invalid subject type")


class CostQueryService:
    """Read persisted cost inputs and aggregate them for cost reporting."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def resolve_model(self, endpoint_id: Optional[int]) -> Optional[EffectiveCostModel]:
        global_model = self.db.get(CostModel, 1)
        if global_model is None:
            return None
        override = None
        if endpoint_id is not None:
            override = self.db.scalar(
                select(CostEndpointOverride).where(
                    CostEndpointOverride.storage_endpoint_id == endpoint_id
                )
            )
        rates = override or global_model
        return EffectiveCostModel(
            currency=global_model.currency,
            storage_gb_month_price=rates.storage_gb_month_price,
            egress_gb_price=rates.egress_gb_price,
            ingress_gb_price=rates.ingress_gb_price,
            requests_per_1000_price=rates.requests_per_1000_price,
            pricing_source="endpoint_override" if override is not None else "global",
        )

    def subject(
        self,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> CostSubject | None:
        subject_model = _cost_subject_model(subject_type)
        return self.db.scalar(
            select(subject_model).where(
                subject_model.id == subject_id,
                subject_model.storage_endpoint_id == endpoint_id,
            )
        )

    def ceph_endpoints(self, endpoint_id: Optional[int]) -> list[StorageEndpoint]:
        statement = select(StorageEndpoint).where(
            StorageEndpoint.provider == StorageProvider.CEPH.value
        )
        if endpoint_id is not None:
            statement = statement.where(StorageEndpoint.id == endpoint_id)
        return self.db.scalars(
            statement.order_by(StorageEndpoint.name.asc(), StorageEndpoint.id.asc())
        ).all()

    def load_subjects(self, endpoint_id: int, subject_type: str) -> list[CostSubject]:
        subject_model = _cost_subject_model(subject_type)
        return self.db.scalars(
            select(subject_model)
            .where(subject_model.storage_endpoint_id == endpoint_id)
            .order_by(subject_model.name.asc())
        ).all()

    def endpoint_ids_with_data(
        self,
        period: CostPeriod,
        subject_type: Optional[str] = None,
    ) -> list[int]:
        usage_statement = (
            select(CostUsageDaily.storage_endpoint_id)
            .join(StorageEndpoint, StorageEndpoint.id == CostUsageDaily.storage_endpoint_id)
            .where(
                CostUsageDaily.day >= period.start,
                CostUsageDaily.day < period.end,
                StorageEndpoint.provider == StorageProvider.CEPH.value,
            )
        )
        storage_statement = (
            select(CostStorageDaily.storage_endpoint_id)
            .join(StorageEndpoint, StorageEndpoint.id == CostStorageDaily.storage_endpoint_id)
            .where(
                CostStorageDaily.day >= period.start,
                CostStorageDaily.day < period.end,
                StorageEndpoint.provider == StorageProvider.CEPH.value,
            )
        )
        if subject_type == "account":
            usage_statement = usage_statement.where(CostUsageDaily.s3_account_id.isnot(None))
            storage_statement = storage_statement.where(CostStorageDaily.s3_account_id.isnot(None))
        elif subject_type == "s3_user":
            usage_statement = usage_statement.where(CostUsageDaily.s3_user_id.isnot(None))
            storage_statement = storage_statement.where(CostStorageDaily.s3_user_id.isnot(None))
        usage_ids = self.db.scalars(usage_statement.distinct()).all()
        storage_ids = self.db.scalars(storage_statement.distinct()).all()
        return sorted({int(value) for value in [*usage_ids, *storage_ids]})

    def aggregate_totals(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: Optional[str] = None,
    ) -> CostTotals:
        usage_statement = select(
            func.sum(CostUsageDaily.bytes_in),
            func.sum(CostUsageDaily.bytes_out),
            func.sum(CostUsageDaily.ops_total),
            func.count(func.distinct(CostUsageDaily.day)),
        ).where(
            CostUsageDaily.day >= period.start,
            CostUsageDaily.day < period.end,
        )
        usage_statement = self._scope_daily_cost_statement(
            usage_statement,
            endpoint_column=CostUsageDaily.storage_endpoint_id,
            account_column=CostUsageDaily.s3_account_id,
            user_column=CostUsageDaily.s3_user_id,
            endpoint_id=endpoint_id,
            subject_type=subject_type,
        )
        usage_row = self.db.execute(usage_statement).one()
        bytes_in = int(usage_row[0] or 0)
        bytes_out = int(usage_row[1] or 0)
        ops_total = int(usage_row[2] or 0)
        days_with_usage = int(usage_row[3] or 0)

        storage_statement = select(
            func.sum(CostStorageDaily.total_bytes),
            func.sum(CostStorageDaily.total_objects),
            func.count(func.distinct(CostStorageDaily.day)),
        ).where(
            CostStorageDaily.day >= period.start,
            CostStorageDaily.day < period.end,
        )
        storage_statement = self._scope_daily_cost_statement(
            storage_statement,
            endpoint_column=CostStorageDaily.storage_endpoint_id,
            account_column=CostStorageDaily.s3_account_id,
            user_column=CostStorageDaily.s3_user_id,
            endpoint_id=endpoint_id,
            subject_type=subject_type,
        )
        storage_row = self.db.execute(storage_statement).one()
        total_bytes = storage_row[0] or 0
        total_objects = storage_row[1]
        days_with_storage = int(storage_row[2] or 0)
        avg_storage_bytes = int(total_bytes / days_with_storage) if days_with_storage else None

        return CostTotals(
            bytes_in=bytes_in,
            bytes_out=bytes_out,
            ops_total=ops_total,
            ops_breakdown=None,
            avg_storage_bytes=avg_storage_bytes,
            avg_storage_gb_month=bytes_to_gb(avg_storage_bytes) if avg_storage_bytes is not None else None,
            total_objects=int(total_objects) if total_objects is not None else None,
            days_with_data=max(days_with_storage, days_with_usage),
            storage_days_with_data=days_with_storage,
            usage_days_with_data=days_with_usage,
        )

    @staticmethod
    def _scope_daily_cost_statement(
        statement,
        *,
        endpoint_column,
        account_column,
        user_column,
        endpoint_id: Optional[int],
        subject_type: Optional[str],
    ):
        if endpoint_id is not None:
            statement = statement.where(endpoint_column == endpoint_id)
        else:
            statement = statement.join(
                StorageEndpoint,
                StorageEndpoint.id == endpoint_column,
            ).where(StorageEndpoint.provider == StorageProvider.CEPH.value)
        if subject_type == "account":
            return statement.where(account_column.isnot(None))
        if subject_type == "s3_user":
            return statement.where(user_column.isnot(None))
        return statement

    def usage_totals_by_subject(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> dict[int, tuple[int, int, int]]:
        column = _daily_subject_column(CostUsageDaily, subject_type)
        rows = self.db.execute(
            select(
                column,
                func.sum(CostUsageDaily.bytes_in),
                func.sum(CostUsageDaily.bytes_out),
                func.sum(CostUsageDaily.ops_total),
            )
            .where(
                CostUsageDaily.storage_endpoint_id == endpoint_id,
                CostUsageDaily.day >= period.start,
                CostUsageDaily.day < period.end,
                column.isnot(None),
            )
            .group_by(column)
        ).all()
        return {
            int(row[0]): (int(row[1] or 0), int(row[2] or 0), int(row[3] or 0))
            for row in rows
            if row[0] is not None
        }

    def storage_totals_by_subject(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> dict[int, tuple[Optional[int], Optional[int], int]]:
        column = _daily_subject_column(CostStorageDaily, subject_type)
        rows = self.db.execute(
            select(
                column,
                func.sum(CostStorageDaily.total_bytes),
                func.sum(CostStorageDaily.total_objects),
                func.count(func.distinct(CostStorageDaily.day)),
            )
            .where(
                CostStorageDaily.storage_endpoint_id == endpoint_id,
                CostStorageDaily.day >= period.start,
                CostStorageDaily.day < period.end,
                column.isnot(None),
            )
            .group_by(column)
        ).all()
        results: dict[int, tuple[Optional[int], Optional[int], int]] = {}
        for row in rows:
            subject_id = row[0]
            if subject_id is None:
                continue
            total_bytes = row[1]
            total_objects = row[2]
            days = int(row[3] or 0)
            avg_bytes = int(total_bytes / days) if (total_bytes is not None and days) else None
            results[int(subject_id)] = (
                avg_bytes,
                int(total_objects) if total_objects is not None else None,
                days,
            )
        return results

    def _daily_rows_for_subject(
        self,
        model: type[_CostDailyRow],
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[_CostDailyRow]:
        column = _daily_subject_column(model, subject_type)
        return self.db.scalars(
            select(model)
            .where(
                model.storage_endpoint_id == endpoint_id,
                model.day >= period.start,
                model.day < period.end,
                column == subject_id,
            )
            .order_by(model.day.asc())
        ).all()

    def usage_rows_for_subject(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[CostUsageDaily]:
        return self._daily_rows_for_subject(
            CostUsageDaily,
            period,
            endpoint_id,
            subject_type,
            subject_id,
        )

    def storage_rows_for_subject(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[CostStorageDaily]:
        return self._daily_rows_for_subject(
            CostStorageDaily,
            period,
            endpoint_id,
            subject_type,
            subject_id,
        )
