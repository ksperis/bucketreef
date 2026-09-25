# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared domain errors used across service and API boundaries."""


class ResourceNotFoundError(ValueError):
    """Raised when a requested BucketReef-managed resource does not exist."""


class StorageEndpointNotFoundError(ResourceNotFoundError):
    pass


class S3UserNotFoundError(ResourceNotFoundError):
    pass


class S3AccessKeyNotFoundError(ResourceNotFoundError):
    pass


class S3AccountNotFoundError(ResourceNotFoundError):
    pass


class UiUserNotFoundError(ResourceNotFoundError):
    pass


class UiGroupNotFoundError(ResourceNotFoundError):
    pass


class BucketMigrationNotFoundError(ResourceNotFoundError):
    pass


class BucketMigrationItemNotFoundError(ResourceNotFoundError):
    pass


class BillingSubjectNotFoundError(ResourceNotFoundError):
    pass


class S3ConnectionNotFoundError(ResourceNotFoundError):
    pass
