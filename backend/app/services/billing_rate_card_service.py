# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db import (
    BillingAssignment,
    BillingEntityRateAssignment,
    BillingRateCard,
    BillingRatePlan,
    StorageEndpoint,
)
from app.models.billing import (
    BillingRateCardAdminItem,
    BillingRateCardPayload,
    BillingRateCardVersionCreate,
)
from app.utils.time import utcnow


class BillingRateCardNotFoundError(ValueError):
    pass


class BillingRateCardConflictError(ValueError):
    pass


class BillingRateCardImmutableError(ValueError):
    pass


class BillingRateCardService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list(self) -> list[BillingRateCardAdminItem]:
        statement = (
            select(BillingRateCard)
            .join(BillingRateCard.rate_plan)
            .options(
                joinedload(BillingRateCard.rate_plan).joinedload(BillingRatePlan.storage_endpoint),
                joinedload(BillingRateCard.rate_plan).selectinload(BillingRatePlan.versions),
            )
            .order_by(
                BillingRatePlan.storage_endpoint_id.asc(),
                BillingRatePlan.name.asc(),
                BillingRateCard.effective_from.desc(),
            )
        )
        return [self._item(row) for row in self.db.scalars(statement).unique().all()]

    def get(self, rate_card_id: int) -> BillingRateCardAdminItem:
        return self._item(self._row(rate_card_id))

    def create(self, payload: BillingRateCardPayload) -> BillingRateCardAdminItem:
        self._require_endpoint(payload.storage_endpoint_id)
        if self._find_plan(payload.name, payload.storage_endpoint_id) is not None:
            raise BillingRateCardConflictError(
                "A rate plan with this name and scope already exists; create a new version instead"
            )

        now = utcnow()
        plan = BillingRatePlan(
            name=payload.name,
            storage_endpoint_id=payload.storage_endpoint_id,
            created_at=now,
            updated_at=now,
        )
        row = BillingRateCard(
            rate_plan=plan,
            currency=payload.currency,
            storage_charge_basis=payload.storage_charge_basis,
            storage_gb_month_price=self._decimal(payload.storage_gb_month_price),
            egress_gb_price=self._decimal(payload.egress_gb_price),
            ingress_gb_price=self._decimal(payload.ingress_gb_price),
            requests_per_1000_price=self._decimal(payload.requests_per_1000_price),
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self._commit_or_conflict("A rate plan with this name and scope already exists")
        return self._item(self._row(row.id))

    def update(
        self,
        rate_card_id: int,
        payload: BillingRateCardPayload,
    ) -> BillingRateCardAdminItem:
        row = self._row(rate_card_id)
        if self._status(row) != "future":
            raise BillingRateCardImmutableError("Only future rate cards can be edited")

        plan = row.rate_plan
        identity_changed = (
            payload.name != plan.name
            or payload.storage_endpoint_id != plan.storage_endpoint_id
        )
        if identity_changed:
            if not self._identity_editable(row):
                raise BillingRateCardImmutableError(
                    "Rate plan identity cannot change after another version exists or while the plan is assigned"
                )
            self._require_endpoint(payload.storage_endpoint_id)
            existing = self._find_plan(payload.name, payload.storage_endpoint_id)
            if existing is not None and existing.id != plan.id:
                raise BillingRateCardConflictError(
                    "A rate plan with this name and scope already exists"
                )

        self._require_no_overlap(
            plan.id,
            payload.effective_from,
            payload.effective_to,
            exclude_id=row.id,
        )

        now = utcnow()
        if identity_changed:
            plan.name = payload.name
            plan.storage_endpoint_id = payload.storage_endpoint_id
            plan.updated_at = now

        row.currency = payload.currency
        row.storage_charge_basis = payload.storage_charge_basis
        row.storage_gb_month_price = self._decimal(payload.storage_gb_month_price)
        row.egress_gb_price = self._decimal(payload.egress_gb_price)
        row.ingress_gb_price = self._decimal(payload.ingress_gb_price)
        row.requests_per_1000_price = self._decimal(payload.requests_per_1000_price)
        row.effective_from = payload.effective_from
        row.effective_to = payload.effective_to
        row.updated_at = now
        self._commit_or_conflict("Rate card period conflicts with an existing version")
        return self._item(self._row(row.id))

    def create_version(
        self,
        rate_card_id: int,
        payload: BillingRateCardVersionCreate,
    ) -> BillingRateCardAdminItem:
        source = self._row(rate_card_id)
        if self._status(source) != "active":
            raise BillingRateCardConflictError(
                "A new version can only be created from an active rate card"
            )
        if payload.effective_from <= utcnow().date():
            raise BillingRateCardConflictError("A new version must start in a future month")
        if payload.effective_from <= source.effective_from:
            raise BillingRateCardConflictError(
                "The new version must start after the current version"
            )

        self._require_no_overlap(
            source.rate_plan_id,
            payload.effective_from,
            None,
            exclude_id=source.id,
        )

        now = utcnow()
        source.effective_to = payload.effective_from - timedelta(days=1)
        source.updated_at = now
        row = BillingRateCard(
            rate_plan_id=source.rate_plan_id,
            currency=payload.currency,
            storage_charge_basis=payload.storage_charge_basis,
            storage_gb_month_price=self._decimal(payload.storage_gb_month_price),
            egress_gb_price=self._decimal(payload.egress_gb_price),
            ingress_gb_price=self._decimal(payload.ingress_gb_price),
            requests_per_1000_price=self._decimal(payload.requests_per_1000_price),
            effective_from=payload.effective_from,
            effective_to=None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self._commit_or_conflict("Rate card period conflicts with an existing version")
        return self._item(self._row(row.id))

    def delete(self, rate_card_id: int) -> None:
        row = self._row(rate_card_id)
        if self._status(row) != "future":
            raise BillingRateCardImmutableError("Only future rate cards can be deleted")

        plan = row.rate_plan
        version_count = self._version_count(plan.id)
        if version_count == 1 and self._plan_is_assigned(plan.id):
            raise BillingRateCardConflictError(
                "This rate plan is assigned and its only version cannot be deleted"
            )

        previous = self.db.scalar(
            select(BillingRateCard)
            .where(
                BillingRateCard.rate_plan_id == plan.id,
                BillingRateCard.id != row.id,
                BillingRateCard.effective_from < row.effective_from,
            )
            .order_by(BillingRateCard.effective_from.desc())
            .limit(1)
        )
        if (
            previous is not None
            and previous.effective_to == row.effective_from - timedelta(days=1)
        ):
            previous.effective_to = None
            previous.updated_at = utcnow()

        self.db.delete(row)
        if version_count == 1:
            self.db.delete(plan)
        self.db.commit()

    def _row(self, rate_card_id: int) -> BillingRateCard:
        statement = (
            select(BillingRateCard)
            .where(BillingRateCard.id == rate_card_id)
            .options(
                joinedload(BillingRateCard.rate_plan).joinedload(BillingRatePlan.storage_endpoint),
                joinedload(BillingRateCard.rate_plan).selectinload(BillingRatePlan.versions),
            )
        )
        row = self.db.scalar(statement)
        if row is None:
            raise BillingRateCardNotFoundError("Rate card not found")
        return row

    def _find_plan(
        self,
        name: str,
        endpoint_id: Optional[int],
    ) -> Optional[BillingRatePlan]:
        statement = select(BillingRatePlan).where(BillingRatePlan.name == name)
        if endpoint_id is None:
            statement = statement.where(BillingRatePlan.storage_endpoint_id.is_(None))
        else:
            statement = statement.where(BillingRatePlan.storage_endpoint_id == endpoint_id)
        return self.db.scalar(statement.limit(1))

    def _require_endpoint(self, endpoint_id: Optional[int]) -> None:
        if endpoint_id is None:
            return
        if self.db.scalar(
            select(StorageEndpoint.id).where(StorageEndpoint.id == endpoint_id)
        ) is None:
            raise ValueError("Endpoint not found")

    def _require_no_overlap(
        self,
        rate_plan_id: int,
        effective_from: date,
        effective_to: Optional[date],
        *,
        exclude_id: Optional[int] = None,
    ) -> None:
        statement = select(BillingRateCard.id).where(
            BillingRateCard.rate_plan_id == rate_plan_id
        )
        if exclude_id is not None:
            statement = statement.where(BillingRateCard.id != exclude_id)
        statement = statement.where(
            or_(
                BillingRateCard.effective_to.is_(None),
                BillingRateCard.effective_to >= effective_from,
            )
        )
        if effective_to is not None:
            statement = statement.where(BillingRateCard.effective_from <= effective_to)
        if self.db.scalar(statement.limit(1)) is not None:
            raise BillingRateCardConflictError(
                "Rate card period overlaps an existing version"
            )

    def _version_count(self, rate_plan_id: int) -> int:
        return int(
            self.db.scalar(
                select(func.count(BillingRateCard.id)).where(
                    BillingRateCard.rate_plan_id == rate_plan_id
                )
            )
            or 0
        )

    def _plan_is_assigned(self, rate_plan_id: int) -> bool:
        direct_assignment = self.db.scalar(
            select(BillingAssignment.id)
            .where(BillingAssignment.rate_plan_id == rate_plan_id)
            .limit(1)
        )
        if direct_assignment is not None:
            return True
        entity_assignment = self.db.scalar(
            select(BillingEntityRateAssignment.id)
            .where(BillingEntityRateAssignment.rate_plan_id == rate_plan_id)
            .limit(1)
        )
        return entity_assignment is not None

    def _identity_editable(self, row: BillingRateCard) -> bool:
        return self._future_mutability(row)[0]

    def _future_mutability(self, row: BillingRateCard) -> tuple[bool, bool]:
        if self._status(row) != "future":
            return False, False
        version_count = self._version_count(row.rate_plan_id)
        assigned = self._plan_is_assigned(row.rate_plan_id)
        identity_editable = version_count == 1 and not assigned
        deletable = version_count > 1 or not assigned
        return identity_editable, deletable

    def _commit_or_conflict(self, message: str) -> None:
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise BillingRateCardConflictError(message) from exc

    @staticmethod
    def _decimal(value: Optional[Decimal]) -> Optional[Decimal]:
        return value

    @staticmethod
    def _status(row: BillingRateCard) -> str:
        today = utcnow().date()
        if row.effective_from > today:
            return "future"
        if row.effective_to is not None and row.effective_to < today:
            return "expired"
        return "active"

    def _item(self, row: BillingRateCard) -> BillingRateCardAdminItem:
        status = self._status(row)
        plan = row.rate_plan
        identity_editable, deletable = self._future_mutability(row)
        return BillingRateCardAdminItem(
            id=row.id,
            rate_plan_id=plan.id,
            name=plan.name,
            currency=row.currency,
            storage_charge_basis=row.storage_charge_basis,
            storage_gb_month_price=row.storage_gb_month_price,
            egress_gb_price=row.egress_gb_price,
            ingress_gb_price=row.ingress_gb_price,
            requests_per_1000_price=row.requests_per_1000_price,
            effective_from=row.effective_from,
            effective_to=row.effective_to,
            storage_endpoint_id=plan.storage_endpoint_id,
            storage_endpoint_name=(
                plan.storage_endpoint.name
                if plan.storage_endpoint is not None
                else None
            ),
            status=status,
            editable=status == "future",
            identity_editable=identity_editable,
            deletable=deletable,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
