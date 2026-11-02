# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Revalidate session-bound S3 executors before each provider request."""
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.db import User
from app.services.keystone_client import OpenStackError
from app.services.s3_execution_client import s3_execution_cache_key
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget


OpenStackContextResolver = Callable[[Session, User, str, str], S3ExecutionContext]


def make_openstack_validator(
    bind,
    user_id: int,
    auth_id: str,
    context_ref: str,
    fingerprint: str,
    *,
    resolve_context: OpenStackContextResolver,
):
    def validate():
        with Session(bind=bind) as db:
            user = db.get(User, user_id)
            if user is None:
                raise OpenStackError("reauthentication_required", "The initiating user is no longer available")
            try:
                current = resolve_context(db, user, auth_id, context_ref)
            except OpenStackError as exc:
                if exc.code in {"reauthentication_required", "context_not_found"}:
                    raise OpenStackError(
                        "reauthentication_required",
                        "The execution session or configuration changed; restart this operation",
                    ) from None
                raise
            if s3_execution_cache_key(current) != fingerprint:
                raise OpenStackError("reauthentication_required", "The execution session or configuration changed; restart this operation")
    return validate


def guard_openstack_client(context: S3ExecutionTarget, client):
    validator = context.access_validator if isinstance(context, S3ExecutionContext) else None
    if validator is not None:
        def before_send(**kwargs):
            validator()
        client.meta.events.register("before-send.s3", before_send)
    return client
