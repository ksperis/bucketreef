# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    BillingAssignment,
    BillingEntityRateAssignment,
    BillingRateCard,
    BillingRatePlan,
)
from app.models.billing import BillingRateResolutionExplanation, BillingRateResolutionLayer
from app.services.billing_entity_service import BillingEntityService


@dataclass(frozen=True)
class BillingResolvedRate:
    rate_card: Optional[BillingRateCard]
    explanation: BillingRateResolutionExplanation


class BillingRateCurrencyConflictError(ValueError):
    pass


class BillingRateResolutionService:
    """Resolve one canonical effective Rate Plan version for a billing scope."""

    def __init__(self, db: Session, *, default_plan_name: Optional[str] = None) -> None:
        self.db = db
        configured = get_settings().billing_default_rate_card_name
        self.default_plan_name = (default_plan_name or configured or "default").strip()
        self._entity_memberships: Optional[dict[tuple[str, int], list[tuple[int, str]]]] = None

    def resolve(
        self,
        *,
        endpoint_id: Optional[int],
        period_start: date,
        subject_type: Optional[str] = None,
        subject_id: Optional[int] = None,
    ) -> BillingResolvedRate:
        if endpoint_id is None:
            return self._missing(issue="storage_endpoint_required")

        has_subject = subject_type is not None or subject_id is not None
        if has_subject:
            if subject_type not in {"account", "s3_user"} or subject_id is None:
                raise ValueError("subject_type and subject_id must identify an account or s3_user")

            direct = self._direct_assignments(
                endpoint_id=endpoint_id,
                subject_type=subject_type,
                subject_id=subject_id,
                period_start=period_start,
            )
            if len(direct) > 1:
                return self._conflict(
                    layer="direct",
                    issue="multiple_direct_rate_assignments",
                )
            if direct:
                assignment = direct[0]
                return self._resolve_assigned_plan(
                    assignment.rate_plan_id,
                    period_start=period_start,
                    layer="direct",
                    source_assignment_id=assignment.id,
                    endpoint_id=endpoint_id,
                )

            entities = self._entities_for_subject(subject_type, subject_id)
            if len(entities) > 1:
                return self._conflict(
                    layer="billing_entity",
                    issue="billing_entity_membership_conflict",
                    entities=entities,
                )
            if entities:
                entity_id, entity_name = entities[0]
                assignments = list(
                    self.db.scalars(
                        select(BillingEntityRateAssignment)
                        .where(
                            BillingEntityRateAssignment.billing_entity_id == entity_id,
                            BillingEntityRateAssignment.effective_from <= period_start,
                            (BillingEntityRateAssignment.effective_to.is_(None))
                            | (BillingEntityRateAssignment.effective_to >= period_start),
                        )
                        .order_by(
                            BillingEntityRateAssignment.effective_from.desc(),
                            BillingEntityRateAssignment.id.desc(),
                        )
                    ).all()
                )
                if len(assignments) > 1:
                    return self._conflict(
                        layer="billing_entity",
                        issue="multiple_billing_entity_rate_assignments",
                        entities=entities,
                    )
                if assignments:
                    assignment = assignments[0]
                    return self._resolve_assigned_plan(
                        assignment.rate_plan_id,
                        period_start=period_start,
                        layer="billing_entity",
                        source_assignment_id=assignment.id,
                        endpoint_id=endpoint_id,
                        billing_entity_id=entity_id,
                        billing_entity_name=entity_name,
                    )

        endpoint_result = self._resolve_scope(
            endpoint_id=endpoint_id,
            period_start=period_start,
            layer="endpoint",
        )
        if endpoint_result is not None:
            return endpoint_result

        global_result = self._resolve_scope(
            endpoint_id=None,
            period_start=period_start,
            layer="global",
        )
        if global_result is not None:
            return global_result
        return self._missing(issue="no_effective_rate_plan")

    @staticmethod
    def require_compatible_currency(resolutions: Iterable[BillingResolvedRate]) -> Optional[str]:
        currencies = {
            resolution.explanation.currency
            for resolution in resolutions
            if resolution.explanation.status == "resolved"
            and resolution.explanation.currency is not None
        }
        if len(currencies) > 1:
            raise BillingRateCurrencyConflictError(
                "Billing totals cannot combine resolved rates with different currencies"
            )
        return next(iter(currencies), None)

    def _direct_assignments(
        self,
        *,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
        period_start: date,
    ) -> list[BillingAssignment]:
        statement = select(BillingAssignment).where(
            BillingAssignment.storage_endpoint_id == endpoint_id,
            BillingAssignment.effective_from <= period_start,
            (BillingAssignment.effective_to.is_(None))
            | (BillingAssignment.effective_to >= period_start),
        )
        if subject_type == "account":
            statement = statement.where(BillingAssignment.s3_account_id == subject_id)
        else:
            statement = statement.where(BillingAssignment.s3_user_id == subject_id)
        return list(
            self.db.scalars(
                statement.order_by(
                    BillingAssignment.effective_from.desc(),
                    BillingAssignment.id.desc(),
                )
            ).all()
        )

    def _entities_for_subject(self, subject_type: str, subject_id: int) -> list[tuple[int, str]]:
        if self._entity_memberships is None:
            memberships: dict[tuple[str, int], list[tuple[int, str]]] = {}
            resolution = BillingEntityService(self.db).resolve_all()
            for entity in resolution.entities:
                if entity.entity_id is None:
                    continue
                for member in entity.members:
                    memberships.setdefault((member.subject_type, member.subject_id), []).append(
                        (entity.entity_id, entity.entity_name)
                    )
            self._entity_memberships = memberships
        return list(self._entity_memberships.get((subject_type, subject_id), []))

    def _resolve_assigned_plan(
        self,
        rate_plan_id: int,
        *,
        period_start: date,
        layer: BillingRateResolutionLayer,
        source_assignment_id: int,
        endpoint_id: int,
        billing_entity_id: Optional[int] = None,
        billing_entity_name: Optional[str] = None,
    ) -> BillingResolvedRate:
        plan = self.db.get(BillingRatePlan, rate_plan_id)
        if plan is None:
            return self._missing(
                layer=layer,
                issue="assigned_rate_plan_not_found",
                rate_plan_id=rate_plan_id,
                source_assignment_id=source_assignment_id,
                billing_entity_id=billing_entity_id,
                billing_entity_name=billing_entity_name,
            )
        if layer == "billing_entity" and plan.storage_endpoint_id is not None:
            return self._conflict(
                layer="billing_entity",
                issue="billing_entity_rate_plan_must_be_global",
                rate_plan=plan,
                source_assignment_id=source_assignment_id,
                entities=(
                    [(billing_entity_id, billing_entity_name)]
                    if billing_entity_id is not None and billing_entity_name is not None
                    else None
                ),
            )
        if plan.storage_endpoint_id not in {None, endpoint_id}:
            return self._conflict(
                layer=layer,
                issue="assigned_rate_plan_endpoint_mismatch",
                rate_plan=plan,
                source_assignment_id=source_assignment_id,
                entities=(
                    [(billing_entity_id, billing_entity_name)]
                    if billing_entity_id is not None and billing_entity_name is not None
                    else None
                ),
            )
        versions = self._effective_versions(plan.id, period_start)
        if not versions:
            return self._missing(
                layer=layer,
                issue="assigned_rate_plan_has_no_effective_version",
                rate_plan_id=plan.id,
                rate_plan_name=plan.name,
                source_assignment_id=source_assignment_id,
                billing_entity_id=billing_entity_id,
                billing_entity_name=billing_entity_name,
            )
        if len(versions) > 1:
            return self._conflict(
                layer=layer,
                issue="multiple_effective_rate_plan_versions",
                rate_plan=plan,
                source_assignment_id=source_assignment_id,
                entities=(
                    [(billing_entity_id, billing_entity_name)]
                    if billing_entity_id is not None and billing_entity_name is not None
                    else None
                ),
            )
        return self._resolved(
            versions[0],
            layer=layer,
            source_assignment_id=source_assignment_id,
            billing_entity_id=billing_entity_id,
            billing_entity_name=billing_entity_name,
        )

    def _resolve_scope(
        self,
        *,
        endpoint_id: Optional[int],
        period_start: date,
        layer: BillingRateResolutionLayer,
    ) -> Optional[BillingResolvedRate]:
        statement = (
            select(BillingRateCard)
            .join(BillingRatePlan)
            .where(
                BillingRateCard.effective_from <= period_start,
                (BillingRateCard.effective_to.is_(None))
                | (BillingRateCard.effective_to >= period_start),
            )
        )
        if endpoint_id is None:
            statement = statement.where(BillingRatePlan.storage_endpoint_id.is_(None))
        else:
            statement = statement.where(BillingRatePlan.storage_endpoint_id == endpoint_id)
        statement = statement.where(BillingRatePlan.name == self.default_plan_name)
        cards = list(
            self.db.scalars(
                statement.order_by(
                    BillingRatePlan.name.asc(),
                    BillingRateCard.effective_from.desc(),
                    BillingRateCard.id.desc(),
                )
            ).all()
        )
        if not cards:
            return None
        plan_ids = {card.rate_plan_id for card in cards}
        if len(plan_ids) > 1:
            return self._conflict(layer=layer, issue="ambiguous_effective_rate_plans")
        if len(cards) > 1:
            return self._conflict(
                layer=layer,
                issue="multiple_effective_rate_plan_versions",
                rate_plan=cards[0].rate_plan,
            )
        return self._resolved(cards[0], layer=layer)

    def _effective_versions(self, rate_plan_id: int, period_start: date) -> list[BillingRateCard]:
        return list(
            self.db.scalars(
                select(BillingRateCard)
                .where(
                    BillingRateCard.rate_plan_id == rate_plan_id,
                    BillingRateCard.effective_from <= period_start,
                    (BillingRateCard.effective_to.is_(None))
                    | (BillingRateCard.effective_to >= period_start),
                )
                .order_by(BillingRateCard.effective_from.desc(), BillingRateCard.id.desc())
            ).all()
        )

    @staticmethod
    def _resolved(
        rate_card: BillingRateCard,
        *,
        layer: BillingRateResolutionLayer,
        source_assignment_id: Optional[int] = None,
        billing_entity_id: Optional[int] = None,
        billing_entity_name: Optional[str] = None,
    ) -> BillingResolvedRate:
        return BillingResolvedRate(
            rate_card=rate_card,
            explanation=BillingRateResolutionExplanation(
                status="resolved",
                layer=layer,
                rate_plan_id=rate_card.rate_plan_id,
                rate_plan_name=rate_card.rate_plan.name,
                rate_card_id=rate_card.id,
                rate_card_effective_from=rate_card.effective_from,
                rate_card_effective_to=rate_card.effective_to,
                source_assignment_id=source_assignment_id,
                billing_entity_id=billing_entity_id,
                billing_entity_name=billing_entity_name,
                currency=rate_card.currency,
                storage_charge_basis=rate_card.storage_charge_basis,
            ),
        )

    @staticmethod
    def _missing(
        *,
        issue: str,
        layer: Optional[BillingRateResolutionLayer] = None,
        rate_plan_id: Optional[int] = None,
        rate_plan_name: Optional[str] = None,
        source_assignment_id: Optional[int] = None,
        billing_entity_id: Optional[int] = None,
        billing_entity_name: Optional[str] = None,
    ) -> BillingResolvedRate:
        return BillingResolvedRate(
            rate_card=None,
            explanation=BillingRateResolutionExplanation(
                status="missing",
                layer=layer,
                rate_plan_id=rate_plan_id,
                rate_plan_name=rate_plan_name,
                source_assignment_id=source_assignment_id,
                billing_entity_id=billing_entity_id,
                billing_entity_name=billing_entity_name,
                issues=[issue],
            ),
        )

    @staticmethod
    def _conflict(
        *,
        layer: BillingRateResolutionLayer,
        issue: str,
        rate_plan: Optional[BillingRatePlan] = None,
        source_assignment_id: Optional[int] = None,
        entities: Optional[list[tuple[int, str]]] = None,
    ) -> BillingResolvedRate:
        entities = entities or []
        return BillingResolvedRate(
            rate_card=None,
            explanation=BillingRateResolutionExplanation(
                status="conflict",
                layer=layer,
                rate_plan_id=rate_plan.id if rate_plan is not None else None,
                rate_plan_name=rate_plan.name if rate_plan is not None else None,
                source_assignment_id=source_assignment_id,
                billing_entity_id=entities[0][0] if len(entities) == 1 else None,
                billing_entity_name=entities[0][1] if len(entities) == 1 else None,
                conflicting_billing_entity_ids=[entity_id for entity_id, _ in entities],
                conflicting_billing_entity_names=[entity_name for _, entity_name in entities],
                issues=[issue],
            ),
        )
