# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared domain errors used across service and API boundaries."""


class ResourceNotFoundError(ValueError):
    """Raised when a requested BucketReef-managed resource does not exist."""


class ResourceConflictError(ValueError):
    """Raised when a requested mutation conflicts with managed resource state."""


class ResourceNameValidationError(ValueError):
    """Raised when a provider-aware resource name fails request validation."""

    def __init__(self, message: str, *, loc: tuple[object, ...]) -> None:
        super().__init__(message)
        self.loc = loc


class BucketConfigValidationError(ValueError):
    """Raised when a bucket configuration mutation rejects its input."""


class CephMultisiteValidationError(ValueError):
    """Raised when a Ceph Multisite diagnostic request is semantically invalid."""


class CephMultisiteConflictError(ResourceConflictError):
    """Raised when a Ceph Multisite diagnostic target changed during inspection."""


class CephMultisiteCredentialsMissingError(PermissionError):
    """Raised when a Ceph Multisite diagnostic endpoint lacks its admin identity."""


class StorageEndpointNotFoundError(ResourceNotFoundError):
    pass


class StorageEndpointProviderError(ValueError):
    """Raised when an endpoint does not provide the storage backend a workflow requires."""


class StorageEndpointFeatureDisabledError(ValueError):
    """Raised when a storage endpoint disables a feature required by a workflow."""


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


class CostSubjectNotFoundError(ResourceNotFoundError):
    pass


class CostDisabledError(ValueError):
    pass


class S3ConnectionNotFoundError(ResourceNotFoundError):
    pass


class S3ConnectionConflictError(ResourceConflictError):
    pass


class AvatarNotFoundError(ResourceNotFoundError):
    pass


class BrowserFavoriteNotFoundError(ResourceNotFoundError):
    pass


class BrowserFavoriteConflictError(ResourceConflictError):
    pass


class WebhookEndpointNotFoundError(ResourceNotFoundError):
    pass


class BrowserListingCursorError(ValueError):
    """Raised when a Browser listing cursor no longer matches its filters."""


class BrowserStorageSpacePermissionError(PermissionError):
    """Raised when Portal Storage Space access does not permit a Browser mutation."""


class ExternalIdentityNotFoundError(ResourceNotFoundError):
    pass


class ExternalIdentityConflictError(ResourceConflictError):
    pass


class ExternalIdentityLinkRequestNotFoundError(ResourceNotFoundError):
    pass


class AuthSessionNotFoundError(ResourceNotFoundError):
    pass


class IdentitySecuritySelfActionError(ValueError):
    """Raised when an administrator targets their own account for a forbidden action."""


class IdentitySecurityAuthorizationError(PermissionError):
    """Raised when an administrator cannot manage the requested identity target."""


class ManagerIAMManagedUserConflictError(ResourceConflictError):
    pass


class ManagerIAMUserNotFoundError(ResourceNotFoundError):
    pass


class ManagerIAMRoleNotFoundError(ResourceNotFoundError):
    pass


class ManagerIAMCredentialsMissingError(ValueError):
    pass
