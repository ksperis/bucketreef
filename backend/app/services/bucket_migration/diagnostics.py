# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Safe, actionable diagnostics shared by preparation and execution guards."""
from app.core.sensitive_data import sanitized_error_log_detail


class MigrationPermissionCheckError(RuntimeError):
    def __init__(self, message: str, permission: str, cause: Exception):
        super().__init__(message)
        self.permission = permission
        self.details = {"technical_error": sanitized_error_log_detail(cause)}
