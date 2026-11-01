# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Any, Optional

from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.rgw_account_topics_resolver import normalize_account_key
from app.utils.rgw_payloads import (
    extract_rgw_account_payload,
    extract_rgw_account_tenant,
    extract_rgw_user_listing_identity,
    rgw_qualified_uid,
)


logger = logging.getLogger(__name__)


class S3AccountRgwUsersService:
    """Resolve non-root RGW users attached to an account."""

    def __init__(self, account_roots: RgwAccountRootService) -> None:
        self.account_roots = account_roots

    def resolve(
        self,
        account_identifier: Optional[str],
        precomputed_users: Optional[dict[str, list[str]]],
        admin: Optional[RGWAdminClient],
        endpoint_capabilities: Optional[dict[str, bool]] = None,
        root_uid: Optional[str] = None,
    ) -> tuple[Optional[int], Optional[list[str]]]:
        normalized_key = normalize_account_key(account_identifier)
        if not normalized_key:
            return None, None
        if precomputed_users is not None:
            users = list(precomputed_users.get(normalized_key, []))
            return len(users), users
        if not admin:
            return None, None
        if endpoint_capabilities is not None and not endpoint_capabilities.get("account", False):
            return None, None
        try:
            account_info = admin.get_account(
                account_identifier,
                allow_not_found=True,
                allow_not_implemented=True,
            )
        except RGWAdminError as exc:
            logger.debug("Unable to fetch account info for %s: %s", account_identifier, exc)
            return None, None
        if admin.account_api_supported is False:
            return None, None
        if not account_info:
            return 0, []
        info = extract_rgw_account_payload(account_info)
        user_list = info.get("user_list", info.get("users"))
        if not isinstance(user_list, list):
            # Standard Ceph AccountInfo does not embed the account's users.
            # Do not scan the endpoint-wide user inventory here: account
            # listings call this resolver once per account and a large default
            # tenant would otherwise turn one request into thousands of Admin
            # Ops lookups. Import keeps its deliberate one-shot discovery path,
            # while deletion proves that no non-root users remain through IAM.
            return None, None
        resolved_root_uid = root_uid or self.account_roots.root_uid(account_identifier)
        try:
            deduped = self._clean_account_user_uids(
                user_list,
                root_uid=resolved_root_uid,
                account_tenant=extract_rgw_account_tenant(account_info),
            )
        except ValueError as exc:
            logger.debug("Unable to normalize RGW account users for %s: %s", account_identifier, exc)
            return None, None
        return len(deduped), deduped

    @staticmethod
    def _clean_account_user_uids(
        user_list: list[Any],
        *,
        root_uid: str,
        account_tenant: str,
    ) -> list[str]:
        normalized_root_uid = root_uid.strip()
        root_aliases = {normalized_root_uid}
        if account_tenant and "$" not in normalized_root_uid:
            root_aliases.add(rgw_qualified_uid(normalized_root_uid, account_tenant))

        cleaned: list[str] = []
        for entry in user_list:
            uid, tenant = extract_rgw_user_listing_identity(entry)
            if not uid:
                continue
            qualified_uid = rgw_qualified_uid(uid, tenant)
            if qualified_uid in root_aliases:
                continue
            cleaned.append(qualified_uid)
        return sorted(set(cleaned))
