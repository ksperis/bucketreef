# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import pytest

from app.db import ManagedPrivateAccess, User, UserRole
from app.services.managed_private_access_query_service import (
    ManagedPrivateAccessQueryService,
)


def _user(db_session, email: str) -> User:
    user = User(
        email=email,
        hashed_password="x",
        role=UserRole.UI_SUPERADMIN.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _provisioning(
    *,
    owner: User,
    source_kind: str = "account",
    source_id: int = 41,
    state: str = "active",
    username: str = "managed-user",
    access_key_id: str = "AK-MANAGED",
) -> ManagedPrivateAccess:
    return ManagedPrivateAccess(
        owner_user_id=owner.id,
        source_context_type=source_kind,
        source_context_id=source_id,
        remote_principal_type="iam_user",
        remote_principal_identifier=username,
        iam_username=username,
        access_key_id=access_key_id,
        state=state,
    )


@pytest.mark.parametrize(
    "state",
    ["provisioning", "active", "deleting", "cleanup_pending"],
)
def test_queries_include_all_active_lifecycle_states(db_session, state):
    owner = _user(db_session, f"{state}@example.test")
    provisioning = _provisioning(owner=owner, state=state)
    db_session.add(provisioning)
    db_session.commit()

    queries = ManagedPrivateAccessQueryService(db_session)

    assert queries.managed_iam_user("account", 41, "managed-user") == provisioning
    assert queries.managed_key("account", 41, "AK-MANAGED") == provisioning
    assert queries.managed_resources_for_source("account", 41) == [provisioning]
    assert queries.has_active_source("account", 41) is True
    assert queries.active_for_source(owner.id, "account", 41) == provisioning


def test_queries_exclude_failed_provisioning(db_session):
    owner = _user(db_session, "failed@example.test")
    failed = _provisioning(owner=owner, state="failed")
    db_session.add(failed)
    db_session.commit()

    queries = ManagedPrivateAccessQueryService(db_session)

    assert queries.managed_iam_user("account", 41, "managed-user") is None
    assert queries.managed_key("account", 41, "AK-MANAGED") is None
    assert queries.managed_resources_for_source("account", 41) == []
    assert queries.has_active_source("account", 41) is False
    assert queries.active_for_source(owner.id, "account", 41) is None


def test_queries_scope_results_to_source_and_owner(db_session):
    owner = _user(db_session, "owner@example.test")
    other_owner = _user(db_session, "other@example.test")
    target = _provisioning(owner=owner, source_kind="s3_user", source_id=7)
    other = _provisioning(
        owner=other_owner,
        source_kind="s3_user",
        source_id=7,
        username="other-user",
        access_key_id="AK-OTHER",
    )
    db_session.add_all([target, other])
    db_session.commit()

    queries = ManagedPrivateAccessQueryService(db_session)

    assert queries.managed_iam_user("s3_user", 7, "managed-user") == target
    assert queries.managed_key("s3_user", 7, "AK-MANAGED") == target
    assert set(queries.managed_resources_for_source("s3_user", 7)) == {target, other}
    assert queries.has_active_source("s3_user", 7) is True
    assert queries.active_for_source(owner.id, "s3_user", 7) == target
    assert queries.active_for_source(other_owner.id, "s3_user", 7) == other
    assert queries.managed_key("account", 7, "AK-MANAGED") is None
    assert queries.has_active_source("account", 7) is False
