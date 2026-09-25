# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations


class PortalClientError(RuntimeError):
    """Base class for Portal business errors caused by the current request."""


class PortalBadRequestError(PortalClientError):
    pass


class PortalForbiddenError(PortalClientError):
    pass


class PortalNotFoundError(PortalClientError):
    pass


class PortalConflictError(PortalClientError):
    pass


class PortalGoneError(PortalClientError):
    pass


class PortalAccessKeyLimitExceeded(PortalConflictError):
    """Raised when a portal user reaches the configured IAM user key limit."""


class PortalAccessKeyManagementDisabled(PortalForbiddenError):
    """Raised when portal access-key mutations are disabled by settings."""


class PortalAccessKeyProtected(PortalBadRequestError):
    """Raised when a request targets the active portal credential."""


class PortalStorageSpaceNotEmpty(PortalConflictError):
    """Raised when a Storage Space still contains current or historical data."""
