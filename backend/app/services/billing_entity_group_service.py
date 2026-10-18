from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db import BillingEntity, BillingEntityGroup, BillingEntityGroupMembership
from app.models.billing import (
    BillingEntityGroupAdminItem,
    BillingEntityGroupMembershipInput,
    BillingEntityGroupMembershipItem,
    BillingEntityGroupPayload,
    BillingEntityGroupPreviewAggregation,
    BillingEntityGroupPreviewAmount,
    BillingEntityGroupPreviewCurrencyTotal,
)
from app.utils.time import utcnow


class BillingEntityGroupNotFoundError(ValueError):
    pass


class BillingEntityGroupConflictError(ValueError):
    pass


class BillingEntityGroupService:
    """Manage historized analytical groupings of Billing Entities.

    Groups never resolve subjects or prices. Their preview aggregation consumes
    already-calculated Billing Entity amounts so there remains one canonical
    membership/rate/cost pipeline outside this service.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def list(self, *, search: str = "", include_inactive: bool = True) -> list[BillingEntityGroupAdminItem]:
        rows = self._group_rows(include_inactive=include_inactive)
        needle = search.strip().casefold()
        if needle:
            rows = [
                row
                for row in rows
                if needle in row.name.casefold()
                or needle in (row.code or "").casefold()
                or needle in (row.external_id or "").casefold()
                or needle in (row.description or "").casefold()
            ]
        return [self._item(row) for row in rows]

    def get(self, group_id: int) -> BillingEntityGroupAdminItem:
        return self._item(self._group_row(group_id))

    def create(self, payload: BillingEntityGroupPayload) -> BillingEntityGroupAdminItem:
        self._validate_payload(payload)
        now = utcnow()
        row = BillingEntityGroup(
            name=payload.name,
            code=payload.code,
            external_id=payload.external_id,
            description=payload.description,
            active=True,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self._flush_or_conflict("A Billing Group with this name, code, or external ID already exists")
        self._replace_memberships(row, payload.memberships, now=now)
        self._commit_or_conflict("A Billing Group with this name, code, or external ID already exists")
        return self.get(row.id)

    def update(self, group_id: int, payload: BillingEntityGroupPayload) -> BillingEntityGroupAdminItem:
        row = self._group_row(group_id)
        self._validate_payload(payload)
        now = utcnow()
        row.name = payload.name
        row.code = payload.code
        row.external_id = payload.external_id
        row.description = payload.description
        row.updated_at = now
        self._replace_memberships(row, payload.memberships, now=now)
        self._commit_or_conflict("A Billing Group with this name, code, or external ID already exists")
        return self.get(row.id)

    def deactivate(self, group_id: int) -> BillingEntityGroupAdminItem:
        row = self._group_row(group_id)
        if row.active:
            row.active = False
            row.updated_at = utcnow()
            self.db.commit()
        return self.get(group_id)

    def member_entity_ids(self, group_id: int, *, month: date) -> list[int]:
        row = self._group_row(group_id)
        month_start = month.replace(day=1)
        return sorted(
            {
                membership.billing_entity_id
                for membership in row.memberships
                if membership.effective_from <= month_start
                and (membership.effective_to is None or membership.effective_to >= month_start)
            }
        )

    def aggregate_preview(
        self,
        group_id: int,
        *,
        month: str,
        entity_amounts: list[BillingEntityGroupPreviewAmount],
    ) -> BillingEntityGroupPreviewAggregation:
        month_start = self._parse_month(month)
        row = self._group_row(group_id)
        member_ids = self.member_entity_ids(group_id, month=month_start)
        member_set = set(member_ids)
        relevant = [amount for amount in entity_amounts if amount.billing_entity_id in member_set]
        represented_ids = {amount.billing_entity_id for amount in relevant}
        missing_ids = sorted(member_set - represented_ids)

        totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
        entity_ids_by_currency: dict[str, set[int]] = defaultdict(set)
        complete_by_currency: dict[str, bool] = defaultdict(lambda: True)
        for amount in relevant:
            totals[amount.currency] += amount.total_cost
            entity_ids_by_currency[amount.currency].add(amount.billing_entity_id)
            complete_by_currency[amount.currency] = complete_by_currency[amount.currency] and amount.complete

        currency_totals = [
            BillingEntityGroupPreviewCurrencyTotal(
                currency=currency,
                total_cost=totals[currency],
                billing_entity_ids=sorted(entity_ids_by_currency[currency]),
                complete=complete_by_currency[currency] and not missing_ids,
            )
            for currency in sorted(totals)
        ]
        complete = not missing_ids and all(amount.complete for amount in relevant)
        return BillingEntityGroupPreviewAggregation(
            billing_entity_group_id=row.id,
            billing_entity_group_name=row.name,
            month=month_start.strftime("%Y-%m"),
            member_entity_ids=member_ids,
            currency_totals=currency_totals,
            missing_entity_ids=missing_ids,
            complete=complete,
        )

    def _group_rows(self, *, include_inactive: bool) -> list[BillingEntityGroup]:
        statement = (
            select(BillingEntityGroup)
            .options(
                selectinload(BillingEntityGroup.memberships).joinedload(BillingEntityGroupMembership.entity)
            )
            .order_by(BillingEntityGroup.name.asc(), BillingEntityGroup.id.asc())
        )
        if not include_inactive:
            statement = statement.where(BillingEntityGroup.active.is_(True))
        return list(self.db.scalars(statement).unique().all())

    def _group_row(self, group_id: int) -> BillingEntityGroup:
        statement = (
            select(BillingEntityGroup)
            .where(BillingEntityGroup.id == group_id)
            .options(
                selectinload(BillingEntityGroup.memberships).joinedload(BillingEntityGroupMembership.entity)
            )
        )
        row = self.db.scalar(statement)
        if row is None:
            raise BillingEntityGroupNotFoundError("Billing Group not found")
        return row

    def _validate_payload(self, payload: BillingEntityGroupPayload) -> None:
        entity_ids = sorted({membership.billing_entity_id for membership in payload.memberships})
        if entity_ids:
            existing_ids = set(
                self.db.scalars(select(BillingEntity.id).where(BillingEntity.id.in_(entity_ids))).all()
            )
            missing = [entity_id for entity_id in entity_ids if entity_id not in existing_ids]
            if missing:
                raise ValueError(f"Unknown Billing Entity IDs: {', '.join(str(item) for item in missing)}")

        by_entity: dict[int, list[BillingEntityGroupMembershipInput]] = defaultdict(list)
        for membership in payload.memberships:
            by_entity[membership.billing_entity_id].append(membership)
        for memberships in by_entity.values():
            ordered = sorted(memberships, key=lambda item: item.effective_from)
            for index in range(1, len(ordered)):
                previous = ordered[index - 1]
                current = ordered[index]
                if previous.effective_to is None or previous.effective_to >= current.effective_from:
                    raise BillingEntityGroupConflictError(
                        "Billing Group membership periods for the same entity must not overlap"
                    )

    def _replace_memberships(
        self,
        row: BillingEntityGroup,
        requested: list[BillingEntityGroupMembershipInput],
        *,
        now,
    ) -> None:
        existing_by_key = {
            (membership.billing_entity_id, membership.effective_from, membership.effective_to): membership
            for membership in row.memberships
        }
        requested_keys = {
            (membership.billing_entity_id, membership.effective_from, membership.effective_to)
            for membership in requested
        }
        for membership in list(row.memberships):
            key = (membership.billing_entity_id, membership.effective_from, membership.effective_to)
            if key not in requested_keys:
                row.memberships.remove(membership)

        for membership in requested:
            key = (membership.billing_entity_id, membership.effective_from, membership.effective_to)
            if key in existing_by_key:
                continue
            row.memberships.append(
                BillingEntityGroupMembership(
                    billing_entity_id=membership.billing_entity_id,
                    effective_from=membership.effective_from,
                    effective_to=membership.effective_to,
                    created_at=now,
                    updated_at=now,
                )
            )

    def _item(self, row: BillingEntityGroup) -> BillingEntityGroupAdminItem:
        month_start = utcnow().date().replace(day=1)
        memberships = [
            BillingEntityGroupMembershipItem(
                id=membership.id,
                billing_entity_id=membership.billing_entity_id,
                billing_entity_name=membership.entity.name,
                billing_entity_code=membership.entity.code,
                billing_entity_active=bool(membership.entity.active),
                effective_from=membership.effective_from,
                effective_to=membership.effective_to,
                status=self._membership_status(membership, month_start),
                created_at=membership.created_at,
                updated_at=membership.updated_at,
            )
            for membership in row.memberships
        ]
        current_member_count = len(
            {
                membership.billing_entity_id
                for membership in row.memberships
                if membership.effective_from <= month_start
                and (membership.effective_to is None or membership.effective_to >= month_start)
            }
        )
        scheduled_membership_count = sum(
            1 for membership in row.memberships if membership.effective_from > month_start
        )
        return BillingEntityGroupAdminItem(
            id=row.id,
            name=row.name,
            code=row.code,
            external_id=row.external_id,
            description=row.description,
            active=bool(row.active),
            memberships=memberships,
            current_member_count=current_member_count,
            scheduled_membership_count=scheduled_membership_count,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _membership_status(membership: BillingEntityGroupMembership, month_start: date) -> str:
        if membership.effective_from > month_start:
            return "future"
        if membership.effective_to is not None and membership.effective_to < month_start:
            return "historical"
        return "current"

    @staticmethod
    def _parse_month(value: str) -> date:
        try:
            parsed = date.fromisoformat(value + "-01")
        except ValueError as exc:
            raise ValueError("month must use YYYY-MM") from exc
        if parsed.strftime("%Y-%m") != value:
            raise ValueError("month must use YYYY-MM")
        return parsed

    def _commit_or_conflict(self, message: str) -> None:
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise BillingEntityGroupConflictError(message) from exc

    def _flush_or_conflict(self, message: str) -> None:
        try:
            self.db.flush()
        except IntegrityError as exc:
            self.db.rollback()
            raise BillingEntityGroupConflictError(message) from exc
