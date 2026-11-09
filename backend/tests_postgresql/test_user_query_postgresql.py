# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.db import User
from app.models.user import AdminUserListingRequest
from app.services.user_query_service import UserQueryService


def _postgresql_url() -> str:
    url = os.getenv("POSTGRES_TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    if not url.startswith(("postgresql://", "postgresql+psycopg2://")):
        pytest.fail("POSTGRES_TEST_DATABASE_URL must target PostgreSQL")
    return url


def test_postgresql_admin_user_search_handles_json_preferences() -> None:
    database_url = _postgresql_url()
    engine = sa.create_engine(database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    marker = f"postgres-user-search-{uuid.uuid4().hex}"
    email = f"{marker}@example.test"

    try:
        with session_factory() as db:
            user = User(
                email=email,
                full_name="PostgreSQL searchable user",
                ui_preferences={},
            )
            db.add(user)
            db.commit()
            user_id = int(user.id)

        with session_factory() as db:
            page = UserQueryService(db).list_users_page(
                AdminUserListingRequest(
                    page=1,
                    page_size=25,
                    search=marker,
                )
            )

            assert page.total == 1
            assert [item.id for item in page.items] == [user_id]
    finally:
        with engine.begin() as connection:
            connection.execute(sa.delete(User).where(User.email == email))
        engine.dispose()
