# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import AccountIAMUser, PortalIAMRevocation, S3Account, User
from app.services.effective_access_service import EffectiveAccessService
from app.services.portal.iam_revocation import PortalIAMRevocationPreparation
from app.services.portal_ownership import require_no_private_storage_space_ownership
from app.utils.account_roles import (
    PortalAccountRoleValue,
    portal_account_role_rank,
)


PortalRoleMap = dict[tuple[int, int], PortalAccountRoleValue | None]
logger = logging.getLogger(__name__)


def effective_portal_account_ids(db: Session, user: User) -> list[int]:
    """Return accounts where persisted direct/group grants provide a Portal role."""
    resolved = EffectiveAccessService(db).resolve_user(user)
    return sorted(
        int(link.account_id)
        for link in resolved.account_links
        if link.portal_role is not None
    )


@dataclass(frozen=True)
class _PortalRoleDowngradeEffect:
    user_id: int
    account_id: int
    previous_role: PortalAccountRoleValue
    next_role: PortalAccountRoleValue | None
    revocation: Optional[PortalIAMRevocationPreparation] = None


def capture_effective_portal_roles(
    db: Session,
    *,
    user_ids: Iterable[int],
    account_ids: Iterable[int],
) -> PortalRoleMap:
    normalized_account_ids = sorted(set(account_ids))
    users = db.scalars(select(User).where(User.id.in_(sorted(set(user_ids))))).all()
    access_service = EffectiveAccessService(db)
    roles: PortalRoleMap = {}
    for user in users:
        user_id = int(user.id)
        resolved = access_service.resolve_user(user) if user.is_active else None
        for account_id in normalized_account_ids:
            link = resolved.account_link_for(account_id) if resolved is not None else None
            roles[(user_id, account_id)] = link.portal_role if link else None
    return roles


def _apply_portal_role_downgrades(
    db: Session,
    *,
    before: PortalRoleMap,
    after: PortalRoleMap,
    effects: list[_PortalRoleDowngradeEffect],
) -> None:
    from app.services.portal_service import PortalService

    service = PortalService(db)
    for (user_id, account_id), previous_role in before.items():
        next_role = after.get((user_id, account_id))
        if portal_account_role_rank(next_role) >= portal_account_role_rank(
            previous_role
        ):
            continue
        if next_role is None:
            require_no_private_storage_space_ownership(db, user_id=user_id, account_id=account_id)
        user = db.scalars(select(User).where(User.id == user_id)).one()
        account = db.scalars(select(S3Account).where(S3Account.id == account_id)).one()
        if next_role is None:
            preparation = service._prepare_portal_iam_revocation(user, account)
            effects.append(
                _PortalRoleDowngradeEffect(
                    user_id=user_id,
                    account_id=account_id,
                    previous_role=previous_role,
                    next_role=None,
                    revocation=preparation,
                )
            )
            continue
        effects.append(
            _PortalRoleDowngradeEffect(
                user_id=user_id,
                account_id=account_id,
                previous_role=previous_role,
                next_role=next_role,
            )
        )
        service.sync_existing_portal_user_access(user, account, next_role)


def _restore_portal_role_downgrades(
    db: Session,
    effects: list[_PortalRoleDowngradeEffect],
) -> bool:
    from app.services.portal_service import PortalService

    service = PortalService(db)
    failed = False
    for effect in reversed(effects):
        if effect.revocation is not None:
            failed = service._rollback_portal_iam_revocation(effect.revocation) or failed
            continue
        try:
            user = db.scalars(select(User).where(User.id == effect.user_id)).one()
            account = db.scalars(select(S3Account).where(S3Account.id == effect.account_id)).one()
            service.sync_existing_portal_user_access(
                user,
                account,
                effect.previous_role,
            )
        except Exception:
            failed = True
    return failed


def _finalize_pending_portal_iam_revocations(
    db: Session,
    *,
    after: PortalRoleMap,
) -> None:
    from app.services.portal_service import PortalService

    service = PortalService(db)
    for (user_id, account_id), next_role in after.items():
        if next_role is not None:
            continue
        pending = db.scalar(
            select(PortalIAMRevocation.id).where(
                PortalIAMRevocation.user_id == user_id,
                PortalIAMRevocation.account_id == account_id,
            )
        )
        if pending is None:
            continue
        try:
            service._finalize_portal_iam_revocation(
                user_id=user_id,
                account_id=account_id,
            )
        except Exception as exc:
            logger.warning(
                "Portal IAM cleanup remains pending for user_id=%s account_id=%s: %s",
                user_id,
                account_id,
                exc,
            )


def _reject_pending_portal_iam_promotions(
    db: Session,
    *,
    before: PortalRoleMap,
    after: PortalRoleMap,
) -> None:
    from app.services.portal.exceptions import PortalConflictError

    for (user_id, account_id), next_role in after.items():
        if next_role is None:
            continue
        previous_role = before.get((user_id, account_id))
        if portal_account_role_rank(next_role) <= portal_account_role_rank(previous_role):
            continue
        pending = db.scalar(
            select(PortalIAMRevocation.id).where(
                PortalIAMRevocation.user_id == user_id,
                PortalIAMRevocation.account_id == account_id,
            )
        )
        if pending is not None:
            raise PortalConflictError(
                "Portal IAM revocation is pending. Retry reconciliation before restoring Portal access."
            )


def sync_portal_role_promotions(
    db: Session,
    *,
    before: PortalRoleMap,
    after: PortalRoleMap,
) -> None:
    from app.services.portal_service import PortalService

    service = PortalService(db)
    for (user_id, account_id), next_role in after.items():
        previous_role = before.get((user_id, account_id))
        if portal_account_role_rank(next_role) <= portal_account_role_rank(
            previous_role
        ):
            continue
        existing_identity = db.scalar(
            select(AccountIAMUser.id).where(
                AccountIAMUser.user_id == user_id,
                AccountIAMUser.account_id == account_id,
            )
        )
        if existing_identity is None:
            continue
        user = db.scalars(select(User).where(User.id == user_id)).one()
        account = db.scalars(select(S3Account).where(S3Account.id == account_id)).one()
        service.sync_existing_portal_user_access(user, account, next_role)


def commit_portal_role_changes(
    db: Session,
    *,
    before: PortalRoleMap,
    user_ids: Iterable[int],
    account_ids: Iterable[int],
    sync_promotions: bool = True,
) -> None:
    """Commit persisted role changes while keeping Portal IAM in sync."""

    after = capture_effective_portal_roles(
        db,
        user_ids=user_ids,
        account_ids=account_ids,
    )
    effects: list[_PortalRoleDowngradeEffect] = []
    try:
        _reject_pending_portal_iam_promotions(
            db,
            before=before,
            after=after,
        )
        _apply_portal_role_downgrades(
            db,
            before=before,
            after=after,
            effects=effects,
        )
        db.commit()
    except Exception as exc:
        rollback_failed = False
        try:
            db.rollback()
        except Exception:
            rollback_failed = True
        restore_failed = False
        if not rollback_failed:
            restore_failed = _restore_portal_role_downgrades(db, effects)
        if rollback_failed or restore_failed:
            raise RuntimeError(
                "Unable to commit Portal role changes. Local or IAM rollback also failed."
            ) from exc
        raise
    _finalize_pending_portal_iam_revocations(db, after=after)
    if sync_promotions:
        sync_portal_role_promotions(db, before=before, after=after)
