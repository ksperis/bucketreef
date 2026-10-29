# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from contextlib import closing
from typing import Any

from app.services import s3_client
from app.services.rgw_bucket_target import split_explicit_rgw_s3_bucket_name
from app.services.s3_execution_client import (
    s3_execution_bucket_request_kwargs,
    s3_execution_request_kwargs,
)
from app.services.s3_execution_context import (
    S3ExecutionTarget,
    is_ceph_admin_execution_context,
)


class LongRunningS3ClientMixin:
    s3_credentials_error_message = "S3 execution context is missing credentials"
    s3_user_agent_extra: str | None = None

    def _client_kwargs(
        self,
        execution_context: S3ExecutionTarget,
        *,
        bucket_name: str | None = None,
    ) -> dict[str, Any]:
        client_kwargs = (
            s3_execution_bucket_request_kwargs(
                execution_context,
                bucket_name,
                error_message=self.s3_credentials_error_message,
            )
            if bucket_name is not None
            else s3_execution_request_kwargs(
                execution_context,
                error_message=self.s3_credentials_error_message,
            )
        )
        if self.s3_user_agent_extra:
            client_kwargs["user_agent_extra"] = self.s3_user_agent_extra
        return client_kwargs

    def _open_client(
        self,
        execution_context: S3ExecutionTarget,
        *,
        bucket_name: str | None = None,
    ) -> closing[s3_client.LoggedS3Client]:
        """Own a fresh client until the operation and its workers have finished."""
        if (
            bucket_name is not None
            and is_ceph_admin_execution_context(execution_context)
            and split_explicit_rgw_s3_bucket_name(bucket_name) is not None
        ):
            return closing(self._build_client(execution_context, bucket_name=bucket_name))
        return closing(self._build_client(execution_context))

    def _build_client(
        self,
        execution_context: S3ExecutionTarget,
        *,
        bucket_name: str | None = None,
    ) -> s3_client.LoggedS3Client:
        from app.services.openstack_execution_guard import guard_openstack_client
        return guard_openstack_client(execution_context, s3_client.get_s3_client(
            request_profile="long_running",
            **self._client_kwargs(execution_context, bucket_name=bucket_name),
        ))
