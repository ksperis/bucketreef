# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db import (
    BillingEntity,
    BillingEntityRateAssignment,
    BillingEntitySubjectRule,
    BillingEntityTagRule,
    BillingRatePlan,
    S3Account,
    S3AccountTag,
    S3User,
    S3UserTag,
    TagDefinition,
)
from app.models.billing import (
    BillingEntityAdminItem,
    BillingEntityConflict,
    BillingEntityConflictEntity,
    BillingEntityMembershipReason,
    BillingEntityPayload,
    BillingEntityRateAssignmentItem,
    BillingEntityResolution,
    BillingEntityResolutionResult,
    BillingEntityResolvedSubject,
    BillingEntitySubjectReference,
)
from app.models.tagging import TagDefinitionSummary
from app.utils.rgw_payloads import rgw_qualified_uid
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED
from app.utils.time import utcnow


class BillingEntityNotFoundError(ValueError):
    pass


class BillingEntityConflictError(ValueError):
    pass


@dataclass(frozen=True)
class _EntitySpec:
    entity_id: Optional[int]
    name: str
    subject_type: str
    tag_labels: dict[int, str]
    explicit_include_ids: frozenset[int]
    explicit_exclude_ids: frozenset[int]


class BillingEntityService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list(self, *, search: str = "", include_inactive: bool = True) -> list[BillingEntityAdminItem]:
        rows = self._entity_rows(include_inactive=include_inactive)
        needle = search.strip().casefold()
        if needle:
            rows = [
                row
                for row in rows
                if needle in row.name.casefold()
                or needle in (row.code or "").casefold()
                or needle in (row.external_id or "").casefold()
            ]
        resolution = self.resolve_all()
        member_counts = {
            item.entity_id: len(item.members)
            for item in resolution.entities
            if item.entity_id is not None
        }
        conflict_counts: dict[int, int] = {}
        for conflict in resolution.conflicts:
            for entity in conflict.entities:
                if entity.entity_id is not None:
                    conflict_counts[entity.entity_id] = conflict_counts.get(entity.entity_id, 0) + 1
        return [
            self._item(
                row,
                member_count=member_counts.get(row.id, 0),
                conflict_count=conflict_counts.get(row.id, 0),
            )
            for row in rows
        ]

    def get(self, entity_id: int) -> BillingEntityAdminItem:
        row = self._entity_row(entity_id)
        resolution = self.resolve_all()
        entity_resolution = next(
            (item for item in resolution.entities if item.entity_id == entity_id),
            None,
        )
        conflict_count = sum(
            1
            for conflict in resolution.conflicts
            if any(item.entity_id == entity_id for item in conflict.entities)
        )
        return self._item(
            row,
            member_count=len(entity_resolution.members) if entity_resolution else 0,
            conflict_count=conflict_count,
        )

    def create(self, payload: BillingEntityPayload) -> BillingEntityAdminItem:
        self._validate_payload(payload)
        now = utcnow()
        row = BillingEntity(
            name=payload.name,
            code=payload.code,
            external_id=payload.external_id,
            subject_type=payload.subject_type,
            active=True,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self._flush_or_conflict("A Billing Entity with this name, code, or external ID already exists")
        self._replace_rules(row, payload, now=now)
        self._commit_or_conflict("A Billing Entity with this name, code, or external ID already exists")
        return self.get(row.id)

    def update(self, entity_id: int, payload: BillingEntityPayload) -> BillingEntityAdminItem:
        row = self._entity_row(entity_id)
        self._validate_payload(payload, existing_entity=row)
        now = utcnow()
        row.tag_rules = []
        row.subject_rules = []
        self.db.flush()
        row.name = payload.name
        row.code = payload.code
        row.external_id = payload.external_id
        row.subject_type = payload.subject_type
        row.updated_at = now
        self._replace_rules(row, payload, now=now, preserve_historical_rate_assignments=True)
        self._commit_or_conflict("A Billing Entity with this name, code, or external ID already exists")
        return self.get(row.id)

    def deactivate(self, entity_id: int) -> BillingEntityAdminItem:
        row = self._entity_row(entity_id)
        if not row.active:
            return self._item(row, member_count=0, conflict_count=0)
        row.active = False
        row.updated_at = utcnow()
        self.db.commit()
        return self.get(entity_id)

    def preview(
        self,
        payload: BillingEntityPayload,
        *,
        entity_id: Optional[int] = None,
    ) -> BillingEntityResolutionResult:
        self._validate_payload(payload)
        rows = self._entity_rows(include_inactive=False)
        if entity_id is not None:
            self._entity_row(entity_id)
            rows = [row for row in rows if row.id != entity_id]
        specs = [self._spec_from_row(row) for row in rows]
        specs.append(self._spec_from_payload(payload, entity_id=entity_id))
        return self._resolve_specs(specs)

    def resolve_all(self) -> BillingEntityResolutionResult:
        specs = [
            self._spec_from_row(row)
            for row in self._entity_rows(include_inactive=False)
        ]
        return self._resolve_specs(specs)

    def search_subjects(
        self,
        *,
        subject_type: str,
        search: str = "",
        limit: int = 20,
    ) -> list[BillingEntitySubjectReference]:
        if subject_type not in {"account", "s3_user"}:
            raise ValueError("subject_type must be 'account' or 's3_user'")
        needle = search.strip()
        if subject_type == "account":
            statement = select(S3Account).order_by(S3Account.name.asc(), S3Account.id.asc())
            if needle:
                pattern = f"%{needle}%"
                statement = statement.where(
                    or_(S3Account.name.ilike(pattern), S3Account.rgw_account_id.ilike(pattern))
                )
            rows: Iterable[S3Account | S3User] = self.db.scalars(statement.limit(limit)).all()
        else:
            statement = select(S3User).order_by(S3User.name.asc(), S3User.id.asc())
            if needle:
                pattern = f"%{needle}%"
                statement = statement.where(
                    or_(
                        S3User.name.ilike(pattern),
                        S3User.rgw_user_uid.ilike(pattern),
                        S3User.rgw_tenant.ilike(pattern),
                    )
                )
            rows = self.db.scalars(statement.limit(limit)).all()
        return [self._subject_reference(row, subject_type=subject_type) for row in rows]

    def _entity_rows(self, *, include_inactive: bool) -> list[BillingEntity]:
        statement = (
            select(BillingEntity)
            .options(
                selectinload(BillingEntity.tag_rules).joinedload(BillingEntityTagRule.tag_definition),
                selectinload(BillingEntity.subject_rules).joinedload(BillingEntitySubjectRule.account),
                selectinload(BillingEntity.subject_rules).joinedload(BillingEntitySubjectRule.s3_user),
                selectinload(BillingEntity.rate_assignments).joinedload(BillingEntityRateAssignment.rate_plan),
            )
            .order_by(BillingEntity.name.asc(), BillingEntity.id.asc())
        )
        if not include_inactive:
            statement = statement.where(BillingEntity.active.is_(True))
        return list(self.db.scalars(statement).unique().all())

    def _entity_row(self, entity_id: int) -> BillingEntity:
        row = self.db.scalar(
            select(BillingEntity)
            .where(BillingEntity.id == entity_id)
            .options(
                selectinload(BillingEntity.tag_rules).joinedload(BillingEntityTagRule.tag_definition),
                selectinload(BillingEntity.subject_rules).joinedload(BillingEntitySubjectRule.account),
                selectinload(BillingEntity.subject_rules).joinedload(BillingEntitySubjectRule.s3_user),
                selectinload(BillingEntity.rate_assignments).joinedload(BillingEntityRateAssignment.rate_plan),
            )
        )
        if row is None:
            raise BillingEntityNotFoundError("Billing Entity not found")
        return row

    def _validate_payload(
        self,
        payload: BillingEntityPayload,
        *,
        existing_entity: Optional[BillingEntity] = None,
    ) -> None:
        tag_ids = set(payload.include_tag_ids)
        if tag_ids:
            definitions = self.db.scalars(
                select(TagDefinition).where(
                    TagDefinition.id.in_(tag_ids),
                    TagDefinition.domain_kind == TAG_DOMAIN_ADMIN_MANAGED,
                    TagDefinition.owner_user_id.is_(None),
                )
            ).all()
            if {row.id for row in definitions} != tag_ids:
                raise ValueError("Billing Entity tags must come from the Admin-managed tag catalog")

        subject_ids = set(payload.explicit_include_ids) | set(payload.explicit_exclude_ids)
        if subject_ids:
            subject_model = S3Account if payload.subject_type == "account" else S3User
            existing_ids = set(
                self.db.scalars(select(subject_model.id).where(subject_model.id.in_(subject_ids))).all()
            )
            missing = sorted(subject_ids - existing_ids)
            if missing:
                raise ValueError(
                    f"Unknown {payload.subject_type} Billing subject IDs: {missing}"
                )

        assignments = sorted(payload.rate_assignments, key=lambda item: item.effective_from)
        current_month = utcnow().date().replace(day=1)
        incoming_historical = {
            (assignment.rate_plan_id, assignment.effective_from, assignment.effective_to)
            for assignment in assignments
            if assignment.effective_from < current_month
        }
        existing_historical = {
            (assignment.rate_plan_id, assignment.effective_from, assignment.effective_to)
            for assignment in (existing_entity.rate_assignments if existing_entity is not None else [])
            if assignment.effective_from < current_month
        }
        if existing_entity is None and incoming_historical:
            raise ValueError("Billing Entity Rate Plan assignments cannot start before the current month")
        if existing_entity is not None and incoming_historical != existing_historical:
            raise ValueError("Historical Billing Entity Rate Plan assignments cannot be changed")
        for assignment in assignments:
            plan = self.db.get(BillingRatePlan, assignment.rate_plan_id)
            if plan is None:
                raise ValueError(f"Rate Plan {assignment.rate_plan_id} not found")
            if plan.storage_endpoint_id is not None:
                raise ValueError("Billing Entity Rate Plan assignments must use a global Rate Plan")
        for previous, current in zip(assignments, assignments[1:]):
            if previous.effective_to is None or previous.effective_to >= current.effective_from:
                raise BillingEntityConflictError("Billing Entity Rate Plan assignment periods overlap")

    def _replace_rules(
        self,
        row: BillingEntity,
        payload: BillingEntityPayload,
        *,
        now,
        preserve_historical_rate_assignments: bool = False,
    ) -> None:
        definitions = []
        if payload.include_tag_ids:
            definitions = list(
                self.db.scalars(
                    select(TagDefinition)
                    .where(TagDefinition.id.in_(payload.include_tag_ids))
                    .order_by(TagDefinition.label_key.asc(), TagDefinition.id.asc())
                ).all()
            )
        row.tag_rules = [
            BillingEntityTagRule(tag_definition=definition, created_at=now)
            for definition in definitions
        ]
        row.subject_rules = [
            self._subject_rule(row.subject_type, subject_id, "include", now=now)
            for subject_id in payload.explicit_include_ids
        ] + [
            self._subject_rule(row.subject_type, subject_id, "exclude", now=now)
            for subject_id in payload.explicit_exclude_ids
        ]
        current_month = utcnow().date().replace(day=1)
        if preserve_historical_rate_assignments:
            row.rate_assignments = [
                assignment
                for assignment in row.rate_assignments
                if assignment.effective_from < current_month
            ]
            self.db.flush()
        else:
            row.rate_assignments = []
        row.rate_assignments.extend(
            BillingEntityRateAssignment(
                rate_plan_id=assignment.rate_plan_id,
                effective_from=assignment.effective_from,
                effective_to=assignment.effective_to,
                created_at=now,
                updated_at=now,
            )
            for assignment in payload.rate_assignments
            if not preserve_historical_rate_assignments or assignment.effective_from >= current_month
        )
        self.db.add(row)

    @staticmethod
    def _subject_rule(
        subject_type: str,
        subject_id: int,
        rule_type: str,
        *,
        now,
    ) -> BillingEntitySubjectRule:
        return BillingEntitySubjectRule(
            rule_type=rule_type,
            s3_account_id=subject_id if subject_type == "account" else None,
            s3_user_id=subject_id if subject_type == "s3_user" else None,
            created_at=now,
        )

    def _spec_from_row(self, row: BillingEntity) -> _EntitySpec:
        tag_labels = {
            rule.tag_definition_id: rule.tag_definition.label
            for rule in row.tag_rules
            if rule.tag_definition is not None
        }
        include_ids: set[int] = set()
        exclude_ids: set[int] = set()
        for rule in row.subject_rules:
            subject_id = rule.s3_account_id if row.subject_type == "account" else rule.s3_user_id
            if subject_id is None:
                continue
            (include_ids if rule.rule_type == "include" else exclude_ids).add(subject_id)
        return _EntitySpec(
            entity_id=row.id,
            name=row.name,
            subject_type=row.subject_type,
            tag_labels=tag_labels,
            explicit_include_ids=frozenset(include_ids),
            explicit_exclude_ids=frozenset(exclude_ids),
        )

    def _spec_from_payload(self, payload: BillingEntityPayload, *, entity_id: Optional[int]) -> _EntitySpec:
        tag_labels: dict[int, str] = {}
        if payload.include_tag_ids:
            tag_labels = {
                row.id: row.label
                for row in self.db.scalars(
                    select(TagDefinition).where(TagDefinition.id.in_(payload.include_tag_ids))
                ).all()
            }
        return _EntitySpec(
            entity_id=entity_id,
            name=payload.name,
            subject_type=payload.subject_type,
            tag_labels=tag_labels,
            explicit_include_ids=frozenset(payload.explicit_include_ids),
            explicit_exclude_ids=frozenset(payload.explicit_exclude_ids),
        )

    def _resolve_specs(self, specs: list[_EntitySpec]) -> BillingEntityResolutionResult:
        accounts = list(
            self.db.scalars(
                select(S3Account)
                .options(selectinload(S3Account.tag_links).joinedload(S3AccountTag.tag_definition))
                .order_by(S3Account.name.asc(), S3Account.id.asc())
            ).unique().all()
        )
        users = list(
            self.db.scalars(
                select(S3User)
                .options(selectinload(S3User.tag_links).joinedload(S3UserTag.tag_definition))
                .order_by(S3User.name.asc(), S3User.id.asc())
            ).unique().all()
        )
        subjects_by_type: dict[str, list[S3Account | S3User]] = {
            "account": accounts,
            "s3_user": users,
        }
        resolutions: list[BillingEntityResolution] = []
        memberships: dict[tuple[str, int], list[BillingEntityConflictEntity]] = {}

        for spec in specs:
            members: list[BillingEntityResolvedSubject] = []
            excluded: list[BillingEntityResolvedSubject] = []
            for subject in subjects_by_type[spec.subject_type]:
                tag_ids = {int(link.tag_definition_id) for link in subject.tag_links}
                reasons = [
                    BillingEntityMembershipReason(
                        kind="tag",
                        tag_definition_id=tag_id,
                        label=spec.tag_labels[tag_id],
                    )
                    for tag_id in sorted(tag_ids & set(spec.tag_labels))
                ]
                if subject.id in spec.explicit_include_ids:
                    reasons.append(BillingEntityMembershipReason(kind="explicit_include"))
                matched = bool(reasons)
                if subject.id in spec.explicit_exclude_ids:
                    if matched:
                        reasons.append(BillingEntityMembershipReason(kind="explicit_exclude"))
                        excluded.append(
                            self._resolved_subject(subject, spec.subject_type, reasons)
                        )
                    continue
                if not matched:
                    continue
                resolved = self._resolved_subject(subject, spec.subject_type, reasons)
                members.append(resolved)
                memberships.setdefault((spec.subject_type, subject.id), []).append(
                    BillingEntityConflictEntity(
                        entity_id=spec.entity_id,
                        entity_name=spec.name,
                    )
                )
            resolutions.append(
                BillingEntityResolution(
                    entity_id=spec.entity_id,
                    entity_name=spec.name,
                    subject_type=spec.subject_type,
                    members=members,
                    excluded=excluded,
                )
            )

        conflicts: list[BillingEntityConflict] = []
        assigned_keys = set(memberships)
        subject_indexes = {
            "account": {row.id: row for row in accounts},
            "s3_user": {row.id: row for row in users},
        }
        for key, entities in sorted(memberships.items()):
            if len(entities) < 2:
                continue
            subject_type, subject_id = key
            conflicts.append(
                BillingEntityConflict(
                    subject=self._subject_reference(
                        subject_indexes[subject_type][subject_id],
                        subject_type=subject_type,
                    ),
                    entities=entities,
                )
            )

        unassigned = [
            self._subject_reference(subject, subject_type=subject_type)
            for subject_type, subjects in subjects_by_type.items()
            for subject in subjects
            if (subject_type, subject.id) not in assigned_keys
        ]
        return BillingEntityResolutionResult(
            entities=resolutions,
            unassigned=unassigned,
            conflicts=conflicts,
        )

    def _item(
        self,
        row: BillingEntity,
        *,
        member_count: int,
        conflict_count: int,
    ) -> BillingEntityAdminItem:
        tag_rules = sorted(
            (rule for rule in row.tag_rules if rule.tag_definition is not None),
            key=lambda rule: (rule.tag_definition.label_key, rule.tag_definition_id),
        )
        include_refs: list[BillingEntitySubjectReference] = []
        exclude_refs: list[BillingEntitySubjectReference] = []
        for rule in row.subject_rules:
            subject = rule.account if row.subject_type == "account" else rule.s3_user
            if subject is None:
                continue
            ref = self._subject_reference(subject, subject_type=row.subject_type)
            (include_refs if rule.rule_type == "include" else exclude_refs).append(ref)
        return BillingEntityAdminItem(
            id=row.id,
            name=row.name,
            code=row.code,
            external_id=row.external_id,
            subject_type=row.subject_type,
            active=bool(row.active),
            include_tags=[
                TagDefinitionSummary(
                    id=rule.tag_definition.id,
                    label=rule.tag_definition.label,
                    color_key=rule.tag_definition.color_key,
                    scope=rule.tag_definition.scope,
                )
                for rule in tag_rules
            ],
            explicit_includes=sorted(include_refs, key=lambda item: (item.name.casefold(), item.subject_id)),
            explicit_excludes=sorted(exclude_refs, key=lambda item: (item.name.casefold(), item.subject_id)),
            rate_assignments=[
                BillingEntityRateAssignmentItem(
                    id=assignment.id,
                    rate_plan_id=assignment.rate_plan_id,
                    rate_plan_name=assignment.rate_plan.name,
                    effective_from=assignment.effective_from,
                    effective_to=assignment.effective_to,
                    created_at=assignment.created_at,
                    updated_at=assignment.updated_at,
                )
                for assignment in row.rate_assignments
            ],
            member_count=member_count,
            conflict_count=conflict_count,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _subject_reference(
        subject: S3Account | S3User,
        *,
        subject_type: str,
    ) -> BillingEntitySubjectReference:
        if subject_type == "account":
            identifier = subject.rgw_account_id
        else:
            identifier = rgw_qualified_uid(subject.rgw_user_uid, subject.rgw_tenant)
        return BillingEntitySubjectReference(
            subject_type=subject_type,
            subject_id=subject.id,
            name=subject.name,
            rgw_identifier=identifier,
            storage_endpoint_id=subject.storage_endpoint_id,
            storage_endpoint_name=subject.storage_endpoint.name,
        )

    def _resolved_subject(
        self,
        subject: S3Account | S3User,
        subject_type: str,
        reasons: list[BillingEntityMembershipReason],
    ) -> BillingEntityResolvedSubject:
        reference = self._subject_reference(subject, subject_type=subject_type)
        return BillingEntityResolvedSubject(
            **reference.model_dump(),
            reasons=reasons,
        )

    def _commit_or_conflict(self, message: str) -> None:
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise BillingEntityConflictError(message) from exc

    def _flush_or_conflict(self, message: str) -> None:
        try:
            self.db.flush()
        except IntegrityError as exc:
            self.db.rollback()
            raise BillingEntityConflictError(message) from exc
