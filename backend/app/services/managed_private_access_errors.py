# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Managed private-access domain errors."""

from app.core.domain_errors import ResourceConflictError, ResourceNotFoundError


class ManagedPrivateAccessError(RuntimeError):
    pass


class ManagedPrivateAccessConflict(ResourceConflictError, ManagedPrivateAccessError):
    pass


class ManagedPrivateAccessForbidden(ManagedPrivateAccessError):
    pass


class ManagedPrivateAccessNotFound(ResourceNotFoundError, ManagedPrivateAccessError):
    pass


class ManagedPrivateAccessCleanupPending(ManagedPrivateAccessConflict):
    def __init__(self, provisioning_id: int, message: str) -> None:
        super().__init__(message)
        self.provisioning_id = provisioning_id
