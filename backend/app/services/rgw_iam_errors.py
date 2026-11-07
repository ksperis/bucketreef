# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0


class RGWIAMError(RuntimeError):
    """Raised when an expected RGW IAM operation or protocol exchange fails."""


class RGWIAMGroupAlreadyExistsError(RGWIAMError):
    """Raised when IAM reports a concurrent group-name conflict."""


class RGWIAMPaginationError(RGWIAMError):
    """Raised when RGW IAM returns an invalid pagination contract."""
