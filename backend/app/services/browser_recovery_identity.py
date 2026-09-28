# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Opaque, non-authorizing local recovery partition for direct S3 sessions."""
import hashlib
import hmac
import json

from app.core.config import get_settings
from app.models.session import ManagerSessionPrincipal


def browser_recovery_identity(principal: ManagerSessionPrincipal) -> str:
    # No credential or access-key ID leaves the backend. This reference grants
    # no access; every resumed request still uses the current session's rights.
    material = json.dumps([
        "browser-local-recovery-v1", principal.capabilities.endpoint_url,
        principal.access_key,
    ], separators=(",", ":")).encode()
    return hmac.new(get_settings().credential_keys[0].encode(), material, hashlib.sha256).hexdigest()
