# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.db import (
    BillingEntity,
    BillingRateCard,
    BillingStatement,
    BillingStatementLine,
    User,
)
from app.models.billing import (
    BillingAnalysisCoverage,
    BillingEntityAnalysisLine,
    BillingEntityAnalysisPreview,
    BillingStatementComponentAmounts,
    BillingStatementGenerationResult,
    BillingStatementItem,
    BillingStatementLineItem,
    BillingStatementLineSnapshot,
    BillingStatementUnitPrices,
)
from app.services.billing_analysis_service import BillingAnalysisService
from app.services.billing_calculation import monetary_total
from app.services.billing_service import _parse_month
from app.services.webhook_catalog import BILLING_STATEMENT_FINALIZED_EVENT_TYPE
from app.services.webhook_service import WebhookEventPublisher
from app.utils.time import utcnow


logger = logging.getLogger(__name__)


class BillingStatementNotFoundError(ValueError):
    pass


class BillingStatementImmutableError(ValueError):
    pass


class BillingStatementBlockedError(ValueError):
    pass


class BillingStatementStaleError(ValueError):
    pass


@dataclass(frozen=True)
class _StatementCandidate:
    billing_entity_id: int
    billing_entity_name: str
    billing_entity_code: str | None
    billing_entity_external_id: str | None
    subject_type: str
    period_start: date
    period_end: date
    currency: str
    member_count: int
    coverage: BillingAnalysisCoverage
    blockers: tuple[str, ...]
    storage_charge_bases: tuple[str, ...]
    subtotal: Decimal
    total: Decimal
    lines: tuple[BillingStatementLineSnapshot, ...]
    source_fingerprint: str


class BillingStatementService:
    """Persist auditable monthly snapshots from canonical Billing analysis."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list(
        self,
        *,
        month: str | None = None,
        billing_entity_id: int | None = None,
        status: str | None = None,
    ) -> list[BillingStatementItem]:
        statement = select(BillingStatement).options(selectinload(BillingStatement.lines))
        if month is not None:
            period = _parse_month(month)
            statement = statement.where(BillingStatement.period_start == period.start)
        if billing_entity_id is not None:
            statement = statement.where(BillingStatement.billing_entity_id == billing_entity_id)
        if status is not None:
            normalized_status = status.strip().lower()
            if normalized_status not in {"draft", "finalized"}:
                raise ValueError("status must be 'draft' or 'finalized'")
            statement = statement.where(BillingStatement.status == normalized_status)
        rows = self.db.scalars(
            statement.order_by(
                BillingStatement.period_start.desc(),
                BillingStatement.billing_entity_name.asc(),
                BillingStatement.currency.asc(),
                BillingStatement.id.asc(),
            )
        ).unique().all()
        return [self._item(row) for row in rows]

    def get(self, statement_id: int) -> BillingStatementItem:
        return self._item(self._row(statement_id))

    def export_json(self, statement_id: int) -> tuple[str, str]:
        item = self.get(statement_id)
        filename = f"billing-statement-{item.public_id}.json"
        return filename, item.model_dump_json(indent=2)

    def export_csv(self, statement_id: int) -> tuple[str, str]:
        item = self.get(statement_id)
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(
            [
                "statement_id",
                "statement_public_id",
                "status",
                "period_start",
                "period_end",
                "billing_entity_id",
                "billing_entity_name",
                "billing_entity_code",
                "billing_entity_external_id",
                "currency",
                "statement_total",
                "line_index",
                "subject_type",
                "subject_id",
                "subject_name",
                "rgw_identifier",
                "endpoint_id",
                "endpoint_name",
                "membership_reasons",
                "membership_conflict",
                "included_in_total",
                "storage_charge_basis",
                "priced_storage_gib_month",
                "measured_storage_gib_month",
                "bytes_in",
                "bytes_out",
                "requests",
                "rate_resolution_source",
                "rate_plan_id",
                "rate_plan_name",
                "rate_card_id",
                "storage_unit_price",
                "egress_unit_price",
                "ingress_unit_price",
                "requests_per_1000_unit_price",
                "storage_cost",
                "egress_cost",
                "ingress_cost",
                "requests_cost",
                "line_total",
                "complete",
                "issues",
            ]
        )
        for line in item.lines:
            snapshot = line.snapshot
            quantity = snapshot.priced_storage_quantity
            resolution = snapshot.rate_resolution
            writer.writerow(
                [
                    item.id,
                    item.public_id,
                    item.status,
                    item.period_start.isoformat(),
                    item.period_end.isoformat(),
                    item.billing_entity_id,
                    item.billing_entity_name,
                    item.billing_entity_code or "",
                    item.billing_entity_external_id or "",
                    item.currency,
                    str(item.total),
                    line.line_index,
                    snapshot.subject_type,
                    snapshot.subject_id,
                    snapshot.subject_name,
                    snapshot.rgw_identifier,
                    snapshot.storage_endpoint_id,
                    snapshot.storage_endpoint_name,
                    json.dumps(
                        [reason.model_dump(mode="json") for reason in snapshot.membership_reasons],
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                    snapshot.membership_conflict,
                    snapshot.included_in_total,
                    snapshot.storage_charge_basis or "",
                    str(quantity.quantity_gib_month) if quantity and quantity.quantity_gib_month is not None else "",
                    str(snapshot.storage.avg_gb_month) if snapshot.storage.avg_gb_month is not None else "",
                    snapshot.usage.bytes_in,
                    snapshot.usage.bytes_out,
                    snapshot.usage.ops_total,
                    resolution.layer or "",
                    resolution.rate_plan_id or "",
                    resolution.rate_plan_name or "",
                    resolution.rate_card_id or "",
                    str(snapshot.unit_prices.storage_gb_month_price)
                    if snapshot.unit_prices.storage_gb_month_price is not None
                    else "",
                    str(snapshot.unit_prices.egress_gb_price)
                    if snapshot.unit_prices.egress_gb_price is not None
                    else "",
                    str(snapshot.unit_prices.ingress_gb_price)
                    if snapshot.unit_prices.ingress_gb_price is not None
                    else "",
                    str(snapshot.unit_prices.requests_per_1000_price)
                    if snapshot.unit_prices.requests_per_1000_price is not None
                    else "",
                    str(snapshot.amounts.storage_cost) if snapshot.amounts.storage_cost is not None else "",
                    str(snapshot.amounts.egress_cost) if snapshot.amounts.egress_cost is not None else "",
                    str(snapshot.amounts.ingress_cost) if snapshot.amounts.ingress_cost is not None else "",
                    str(snapshot.amounts.requests_cost) if snapshot.amounts.requests_cost is not None else "",
                    str(snapshot.amounts.total_cost) if snapshot.amounts.total_cost is not None else "",
                    snapshot.complete,
                    json.dumps(snapshot.issues, ensure_ascii=False, separators=(",", ":")),
                ]
            )
        return f"billing-statement-{item.public_id}.csv", output.getvalue()

    def generate(
        self,
        *,
        month: str,
        billing_entity_id: int,
        regenerate: bool = False,
    ) -> BillingStatementGenerationResult:
        period = _parse_month(month)
        existing = self._rows_for_entity_period(
            billing_entity_id,
            period.start,
            for_update=regenerate,
        )
        if existing and not regenerate:
            return BillingStatementGenerationResult(
                month=period.month,
                billing_entity_id=billing_entity_id,
                blockers=sorted({blocker for row in existing for blocker in self._json_list(row.blockers_json)}),
                statements=[self._item(row) for row in existing],
            )
        if regenerate and any(row.status == "finalized" for row in existing):
            raise BillingStatementImmutableError("A finalized Billing Statement cannot be regenerated")

        entity_row, entity_preview = self._entity_preview(period.month, billing_entity_id)
        candidates, generation_blockers = self._candidates(
            entity_row=entity_row,
            entity_preview=entity_preview,
            month=period.month,
        )

        now = utcnow()
        existing_by_currency = {row.currency: row for row in existing}
        candidate_currencies = {candidate.currency for candidate in candidates}
        if regenerate:
            for row in existing:
                if row.currency not in candidate_currencies:
                    self.db.delete(row)

        persisted: list[BillingStatement] = []
        for candidate in candidates:
            row = existing_by_currency.get(candidate.currency)
            if row is None:
                row = BillingStatement(
                    public_id=str(uuid4()),
                    billing_entity_id=candidate.billing_entity_id,
                    period_start=candidate.period_start,
                    currency=candidate.currency,
                    revision=1,
                    created_at=now,
                )
                self.db.add(row)
            else:
                row.revision += 1
                row.lines = []
                self.db.flush()
            self._apply_candidate(row, candidate, generated_at=now)
            persisted.append(row)

        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            # A concurrent generator may have won the entity/month/currency
            # uniqueness race. Returning that canonical row keeps retries
            # idempotent without inventing a second statement.
            concurrent = self._rows_for_entity_period(billing_entity_id, period.start)
            if concurrent and not regenerate:
                return BillingStatementGenerationResult(
                    month=period.month,
                    billing_entity_id=billing_entity_id,
                    blockers=sorted({blocker for row in concurrent for blocker in self._json_list(row.blockers_json)}),
                    statements=[self._item(row) for row in concurrent],
                )
            raise BillingStatementImmutableError("Billing Statement generation conflicted with another update") from exc

        refreshed = self._rows_for_entity_period(billing_entity_id, period.start)
        result_blockers = sorted(
            {
                blocker
                for candidate in candidates
                for blocker in candidate.blockers
            }
            | set(generation_blockers)
        )
        return BillingStatementGenerationResult(
            month=period.month,
            billing_entity_id=billing_entity_id,
            blockers=result_blockers,
            statements=[self._item(row) for row in refreshed],
        )

    def finalize(self, statement_id: int, *, actor: User) -> BillingStatementItem:
        row = self.db.scalar(
            select(BillingStatement)
            .where(BillingStatement.id == statement_id)
            .options(selectinload(BillingStatement.lines))
            .with_for_update()
        )
        if row is None:
            raise BillingStatementNotFoundError("Billing Statement not found")
        if row.status == "finalized":
            return self._item(row)

        month = row.period_start.strftime("%Y-%m")
        entity_row, entity_preview = self._entity_preview(month, row.billing_entity_id)
        candidates, _ = self._candidates(
            entity_row=entity_row,
            entity_preview=entity_preview,
            month=month,
        )
        candidate = next((item for item in candidates if item.currency == row.currency), None)
        if candidate is None or candidate.source_fingerprint != row.source_fingerprint:
            raise BillingStatementStaleError(
                "Billing Statement inputs changed after draft generation; regenerate the draft before finalization"
            )
        if candidate.blockers:
            raise BillingStatementBlockedError(
                "Billing Statement cannot be finalized: " + ", ".join(candidate.blockers)
            )

        now = utcnow()
        row.status = "finalized"
        row.finalized_at = now
        row.finalized_by_user_id = actor.id if getattr(actor, "id", None) else None
        row.finalized_by_user_email = actor.email
        row.updated_at = now
        api_prefix = str(get_settings().api_v1_prefix or "/api").rstrip("/")
        try:
            WebhookEventPublisher(self.db).publish_event_in_current_transaction(
                event_type=BILLING_STATEMENT_FINALIZED_EVENT_TYPE,
                data={
                    "statement_id": int(row.id),
                    "statement_public_id": row.public_id,
                    "billing_entity_id": int(row.billing_entity_id),
                    "billing_entity_external_id": row.billing_entity_external_id,
                    "period_start": row.period_start.isoformat(),
                    "period_end": row.period_end.isoformat(),
                    "currency": row.currency,
                    "finalized_at": now.isoformat(),
                    "statement_api_reference": (
                        f"{api_prefix}/integrations/billing/v1/statements/{row.public_id}"
                    ),
                },
                occurred_at=now,
            )
        except Exception as exc:  # noqa: BLE001 - notification failure must not invalidate finalization
            logger.warning(
                "Failed to queue Billing statement finalized webhook statement=%s: %s",
                row.id,
                exc,
            )
        self.db.commit()
        return self.get(statement_id)

    def _entity_preview(
        self,
        month: str,
        billing_entity_id: int,
    ) -> tuple[BillingEntity, BillingEntityAnalysisPreview]:
        entity_row = self.db.get(BillingEntity, billing_entity_id)
        if entity_row is None:
            raise BillingStatementNotFoundError("Billing Entity not found")
        # Build a fresh analysis service for every lifecycle operation. Its rate
        # resolver intentionally caches membership within one preview, but a
        # later generation/finalization must observe membership changes.
        analysis = BillingAnalysisService(self.db).preview(month)
        preview = next(
            (item for item in analysis.entities if item.billing_entity_id == billing_entity_id),
            None,
        )
        if preview is None:
            raise BillingStatementNotFoundError("Billing Entity has no active analysis for this month")
        return entity_row, preview

    def _candidates(
        self,
        *,
        entity_row: BillingEntity,
        entity_preview: BillingEntityAnalysisPreview,
        month: str,
    ) -> tuple[list[_StatementCandidate], list[str]]:
        period = _parse_month(month)
        currencies = sorted(
            {
                line.cost.currency.upper()
                for line in entity_preview.lines
                if line.cost is not None and line.cost.currency
            }
        )
        generation_blockers = self._entity_blockers(entity_preview) + self._line_blockers(
            [
                line
                for line in entity_preview.lines
                if line.cost is None or not line.cost.currency
            ]
        )
        if not currencies:
            return [], sorted(
                set(
                    generation_blockers
                    + self._line_blockers(entity_preview.lines)
                    + ["no_priced_currency"]
                )
            )

        candidates: list[_StatementCandidate] = []
        for currency in currencies:
            source_lines = [
                line
                for line in entity_preview.lines
                if line.cost is not None
                and line.cost.currency
                and line.cost.currency.upper() == currency
            ]
            snapshots = tuple(self._snapshot_line(line) for line in source_lines)
            line_blockers = self._line_blockers(source_lines)
            blockers = tuple(sorted(set(generation_blockers + line_blockers)))
            coverage = BillingAnalysisService.coverage_for_lines(
                source_lines,
                period.days_in_month,
                len(source_lines),
            )
            storage_bases = tuple(
                sorted(
                    {
                        snapshot.storage_charge_basis
                        for snapshot in snapshots
                        if snapshot.storage_charge_basis is not None
                    }
                )
            )
            included_amounts = [
                line.cost.total_cost
                for line in source_lines
                if line.included_in_total
                and line.cost is not None
                and line.cost.total_cost is not None
            ]
            total = monetary_total(included_amounts)
            fingerprint_payload = {
                "billing_entity_id": entity_row.id,
                "billing_entity_name": entity_row.name,
                "billing_entity_code": entity_row.code,
                "billing_entity_external_id": entity_row.external_id,
                "subject_type": entity_row.subject_type,
                "period_start": period.start.isoformat(),
                "period_end": (period.end - timedelta(days=1)).isoformat(),
                "currency": currency,
                "coverage": coverage.model_dump(mode="json"),
                "blockers": blockers,
                "storage_charge_bases": storage_bases,
                "total": str(total),
                "lines": [snapshot.model_dump(mode="json") for snapshot in snapshots],
            }
            source_fingerprint = hashlib.sha256(
                json.dumps(
                    fingerprint_payload,
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode("utf-8")
            ).hexdigest()
            candidates.append(
                _StatementCandidate(
                    billing_entity_id=entity_row.id,
                    billing_entity_name=entity_row.name,
                    billing_entity_code=entity_row.code,
                    billing_entity_external_id=entity_row.external_id,
                    subject_type=entity_row.subject_type,
                    period_start=period.start,
                    period_end=period.end - timedelta(days=1),
                    currency=currency,
                    member_count=len(source_lines),
                    coverage=coverage,
                    blockers=blockers,
                    storage_charge_bases=storage_bases,
                    subtotal=total,
                    total=total,
                    lines=snapshots,
                    source_fingerprint=source_fingerprint,
                )
            )
        return candidates, sorted(set(generation_blockers))

    def _snapshot_line(self, line: BillingEntityAnalysisLine) -> BillingStatementLineSnapshot:
        rate_card = (
            self.db.get(BillingRateCard, line.rate_resolution.rate_card_id)
            if line.rate_resolution.rate_card_id is not None
            else None
        )
        cost = line.cost
        return BillingStatementLineSnapshot(
            subject_type=line.subject_type,
            subject_id=line.subject_id,
            subject_name=line.subject_name,
            rgw_identifier=line.rgw_identifier,
            membership_reasons=line.membership_reasons,
            membership_conflict=line.membership_conflict,
            included_in_total=line.included_in_total,
            storage_endpoint_id=line.storage_endpoint_id,
            storage_endpoint_name=line.storage_endpoint_name,
            usage=line.usage,
            storage=line.storage,
            coverage=line.coverage,
            storage_charge_basis=(
                cost.storage_quantity.basis
                if cost is not None and cost.storage_quantity is not None
                else line.rate_resolution.storage_charge_basis
            ),
            priced_storage_quantity=(cost.storage_quantity if cost is not None else None),
            rate_resolution=line.rate_resolution,
            unit_prices=BillingStatementUnitPrices(
                storage_gb_month_price=rate_card.storage_gb_month_price if rate_card is not None else None,
                egress_gb_price=rate_card.egress_gb_price if rate_card is not None else None,
                ingress_gb_price=rate_card.ingress_gb_price if rate_card is not None else None,
                requests_per_1000_price=rate_card.requests_per_1000_price if rate_card is not None else None,
            ),
            amounts=BillingStatementComponentAmounts(
                storage_cost=cost.storage_cost if cost is not None else None,
                egress_cost=cost.egress_cost if cost is not None else None,
                ingress_cost=cost.ingress_cost if cost is not None else None,
                requests_cost=cost.requests_cost if cost is not None else None,
                total_cost=cost.total_cost if cost is not None else None,
            ),
            complete=line.complete,
            issues=line.issues,
        )

    @staticmethod
    def _entity_blockers(entity: BillingEntityAnalysisPreview) -> list[str]:
        line_issues = {issue for line in entity.lines for issue in line.issues}
        blockers = [
            f"entity:{entity.billing_entity_id}:{issue}"
            for issue in entity.issues
            if issue not in line_issues
        ]
        if not entity.lines:
            blockers.append(f"entity:{entity.billing_entity_id}:no_members")
        return blockers

    @staticmethod
    def _line_blockers(lines: list[BillingEntityAnalysisLine]) -> list[str]:
        blockers: list[str] = []
        for line in lines:
            for issue in line.issues:
                blockers.append(f"subject:{line.subject_type}:{line.subject_id}:{issue}")
            if not line.complete and not line.issues:
                blockers.append(f"subject:{line.subject_type}:{line.subject_id}:incomplete")
        return blockers

    def _apply_candidate(
        self,
        row: BillingStatement,
        candidate: _StatementCandidate,
        *,
        generated_at,
    ) -> None:
        row.billing_entity_name = candidate.billing_entity_name
        row.billing_entity_code = candidate.billing_entity_code
        row.billing_entity_external_id = candidate.billing_entity_external_id
        row.subject_type = candidate.subject_type
        row.period_end = candidate.period_end
        row.status = "draft"
        row.member_count = candidate.member_count
        row.coverage_json = candidate.coverage.model_dump_json()
        row.blockers_json = json.dumps(list(candidate.blockers), separators=(",", ":"))
        row.storage_charge_bases_json = json.dumps(list(candidate.storage_charge_bases), separators=(",", ":"))
        row.subtotal = candidate.subtotal
        row.total = candidate.total
        row.source_fingerprint = candidate.source_fingerprint
        row.generated_at = generated_at
        row.finalized_at = None
        row.finalized_by_user_id = None
        row.finalized_by_user_email = None
        row.updated_at = generated_at
        row.lines = [
            BillingStatementLine(
                line_index=index,
                subject_type=snapshot.subject_type,
                subject_id=snapshot.subject_id,
                subject_name=snapshot.subject_name,
                rgw_identifier=snapshot.rgw_identifier,
                storage_endpoint_id=snapshot.storage_endpoint_id,
                storage_endpoint_name=snapshot.storage_endpoint_name,
                currency=candidate.currency,
                storage_charge_basis=snapshot.storage_charge_basis,
                total_cost=snapshot.amounts.total_cost,
                complete=snapshot.complete,
                snapshot_json=snapshot.model_dump_json(),
                created_at=generated_at,
            )
            for index, snapshot in enumerate(candidate.lines, start=1)
        ]

    def _row(self, statement_id: int) -> BillingStatement:
        row = self.db.scalar(
            select(BillingStatement)
            .where(BillingStatement.id == statement_id)
            .options(selectinload(BillingStatement.lines))
        )
        if row is None:
            raise BillingStatementNotFoundError("Billing Statement not found")
        return row

    def _rows_for_entity_period(
        self,
        billing_entity_id: int,
        period_start,
        *,
        for_update: bool = False,
    ) -> list[BillingStatement]:
        statement = (
            select(BillingStatement)
            .where(
                BillingStatement.billing_entity_id == billing_entity_id,
                BillingStatement.period_start == period_start,
            )
            .options(selectinload(BillingStatement.lines))
            .order_by(BillingStatement.currency.asc(), BillingStatement.id.asc())
        )
        if for_update:
            statement = statement.with_for_update()
        return list(
            self.db.scalars(statement).unique().all()
        )

    @staticmethod
    def _json_list(raw: str) -> list[str]:
        value = json.loads(raw)
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise ValueError("Persisted Billing Statement list payload is invalid")
        return value

    @staticmethod
    def _item(row: BillingStatement) -> BillingStatementItem:
        return BillingStatementItem(
            id=row.id,
            public_id=row.public_id,
            billing_entity_id=row.billing_entity_id,
            billing_entity_name=row.billing_entity_name,
            billing_entity_code=row.billing_entity_code,
            billing_entity_external_id=row.billing_entity_external_id,
            subject_type=row.subject_type,
            period_start=row.period_start,
            period_end=row.period_end,
            currency=row.currency,
            status=row.status,
            member_count=row.member_count,
            coverage=BillingAnalysisCoverage.model_validate_json(row.coverage_json),
            blockers=BillingStatementService._json_list(row.blockers_json),
            storage_charge_bases=BillingStatementService._json_list(row.storage_charge_bases_json),
            subtotal=row.subtotal,
            total=row.total,
            revision=row.revision,
            generated_at=row.generated_at,
            finalized_at=row.finalized_at,
            finalized_by_user_id=row.finalized_by_user_id,
            finalized_by_user_email=row.finalized_by_user_email,
            lines=[
                BillingStatementLineItem(
                    id=line.id,
                    line_index=line.line_index,
                    currency=line.currency,
                    snapshot=BillingStatementLineSnapshot.model_validate_json(line.snapshot_json),
                )
                for line in row.lines
            ],
        )
