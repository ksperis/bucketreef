# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Reconcile Portal IAM identities from canonical database access roles."""

from __future__ import annotations

import argparse
import json
import logging
from typing import Literal, TypedDict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.logging_security import configure_secure_logging
from app.db import AccountIAMUser, S3Account, User
from app.services.effective_access_service import EffectiveAccessService, ResolvedUserAccess
from app.services.portal_service import PortalService

logger = logging.getLogger(__name__)


class ReconcileError(TypedDict):
    user_id: int
    error: str


class ReconcileSummary(TypedDict):
    account_id: int
    account: str
    compatible: bool
    planned: int
    reconciled: int
    removed: int
    errors: list[ReconcileError]


def _new_summary(account: S3Account) -> ReconcileSummary:
    return {
        "account_id": int(account.id),
        "account": account.name,
        "compatible": EffectiveAccessService.portal_account_is_compatible(account),
        "planned": 0,
        "reconciled": 0,
        "removed": 0,
        "errors": [],
    }


def _desired_portal_roles(
    users: list[User],
    resolved_by_user: dict[int, ResolvedUserAccess],
    account_id: int,
) -> dict[int, str]:
    desired: dict[int, str] = {}
    for user in users:
        user_id = int(user.id)
        link = resolved_by_user[user_id].account_link_for(account_id)
        if link is not None and link.portal_role is not None:
            desired[user_id] = link.portal_role
    return desired


def _existing_portal_user_ids(db: Session, account_id: int) -> set[int]:
    return {
        int(value)
        for value in db.scalars(
            select(AccountIAMUser.user_id).where(
                AccountIAMUser.account_id == account_id
            )
        ).all()
    }


def _apply_target(
    db: Session,
    portal: PortalService,
    user: User,
    account: S3Account,
    role: str | None,
) -> Literal["reconciled", "removed"]:
    if role is None:
        portal.sync_existing_portal_user_access(user, account, None)
        outcome: Literal["reconciled", "removed"] = "removed"
    else:
        portal.provision_portal_user(user, account, role)
        outcome = "reconciled"
    db.commit()
    return outcome


def _reconcile_account(
    db: Session,
    portal: PortalService,
    account: S3Account,
    *,
    users: list[User],
    users_by_id: dict[int, User],
    resolved_by_user: dict[int, ResolvedUserAccess],
    dry_run: bool,
) -> ReconcileSummary:
    summary = _new_summary(account)
    if not summary["compatible"]:
        return summary

    account_id = int(account.id)
    desired = _desired_portal_roles(users, resolved_by_user, account_id)
    target_ids = sorted(desired.keys() | _existing_portal_user_ids(db, account_id))
    summary["planned"] = len(target_ids)
    for user_id in target_ids:
        target = users_by_id.get(user_id)
        if target is None:
            summary["errors"].append(
                {"user_id": user_id, "error": "UI user not found"}
            )
            continue
        if dry_run:
            continue
        try:
            outcome = _apply_target(
                db,
                portal,
                target,
                account,
                desired.get(user_id),
            )
            summary[outcome] += 1
        except Exception as exc:  # noqa: BLE001 - reconcile remaining users independently
            db.rollback()
            summary["errors"].append({"user_id": user_id, "error": str(exc)})
    return summary


def reconcile_portal_iam(
    *,
    dry_run: bool = True,
    account_id: int | None = None,
) -> list[ReconcileSummary]:
    db = SessionLocal()
    try:
        statement = select(S3Account).order_by(S3Account.id.asc())
        if account_id is not None:
            statement = statement.where(S3Account.id == account_id)
        accounts = db.scalars(statement).all()
        all_users = db.scalars(select(User).order_by(User.id.asc())).all()
        users = [user for user in all_users if user.is_active]
        users_by_id = {int(user.id): user for user in all_users}
        service = EffectiveAccessService(db)
        resolved_by_user = service.resolve_users(users)
        portal = PortalService(db)
        return [
            _reconcile_account(
                db,
                portal,
                account,
                users=users,
                users_by_id=users_by_id,
                resolved_by_user=resolved_by_user,
                dry_run=dry_run,
            )
            for account in accounts
        ]
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconcile Portal IAM identities from canonical access roles.")
    parser.add_argument("--apply", action="store_true", help="Apply changes. Without this flag, only a dry-run is performed.")
    parser.add_argument("--account-id", type=int, help="Limit reconciliation to one database account id.")
    args = parser.parse_args()
    configure_secure_logging(level="INFO")
    summaries = reconcile_portal_iam(dry_run=not args.apply, account_id=args.account_id)
    logger.info("mode=%s", "apply" if args.apply else "dry-run")
    for summary in summaries:
        logger.info("%s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
