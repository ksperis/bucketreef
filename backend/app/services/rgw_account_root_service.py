# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
import re
from typing import Any, Optional

from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.rgw_identifiers import normalize_rgw_identifier
from app.utils.rgw_payloads import (
    require_rgw_user_identity,
    rgw_user_account_root,
    split_rgw_tenant_uid,
)


logger = logging.getLogger(__name__)


class RgwAccountRootService:
    _ROOT_UID_SUFFIX = "-admin"

    def root_uid(self, identifier: Any) -> str:
        value = str(identifier or "").strip()
        if not value:
            raise ValueError("Missing account identifier for RGW root user")
        normalized = normalize_rgw_identifier(value)
        if not normalized:
            raise ValueError("Missing account identifier for RGW root user")
        return f"{normalized}{self._ROOT_UID_SUFFIX}"

    @staticmethod
    def root_display_name(
        account_name: Optional[str],
        account_identifier: str,
    ) -> str:
        base = (account_name or account_identifier or "").strip()
        # Ceph RGW Tentacle rejects account-root creation with InvalidArgument
        # for characters that are valid in an RGW account name but are not
        # accepted reliably by the account-root user creation path. Keep the
        # account name itself untouched and normalize only this technical
        # display name using a conservative ASCII subset.
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", base).strip("-")
        return safe or "bucketreef-admin-user"

    @staticmethod
    def load_existing_root_user(
        admin: RGWAdminClient,
        root_uid: str,
        account_id: str,
        tenant: str = "",
    ) -> Optional[dict[str, Any]]:
        payload = admin.get_user(root_uid, tenant=tenant or None, allow_not_found=True)
        if not payload or payload.get("not_found"):
            return None
        require_rgw_user_identity(payload, root_uid, tenant)
        user = payload.get("user") if isinstance(payload.get("user"), dict) else payload
        account_values = {
            str(value).strip()
            for value in (user.get("account_id"), payload.get("account_id"))
            if value is not None and str(value).strip()
        }
        if account_values != {account_id}:
            raise ValueError(
                "RGW root UID belongs to another account or has no verifiable account"
            )
        if rgw_user_account_root(payload) is False:
            raise ValueError("RGW user is not an account root")
        return payload

    def resolve_import_identity(
        self,
        admin: RGWAdminClient,
        info: dict[str, Any],
        account_id: str,
        override: str | None,
    ) -> tuple[str, str]:
        """Discover a pre-existing account root, including a custom tenant-qualified UID."""
        account_info = info.get("account") if isinstance(info.get("account"), dict) else info
        tenant = str(account_info.get("tenant") or "").strip()
        if override:
            uid, selected_tenant = split_rgw_tenant_uid(override, tenant)
            if "tenant" in account_info and selected_tenant != tenant:
                raise ValueError("Root UID tenant does not match the RGW account tenant")
            return uid, selected_tenant

        candidates = account_info.get("user_list", account_info.get("users"))
        account_scoped_candidates = candidates is not None
        if candidates is None:
            candidates = admin.list_user_ids()

        roots: set[tuple[str, str]] = set()
        for candidate in candidates:
            root = self._resolve_import_root_candidate(
                admin,
                candidate,
                account_id=account_id,
                tenant=tenant,
                tenant_declared="tenant" in account_info,
                account_scoped_candidates=account_scoped_candidates,
            )
            if root is not None:
                roots.add(root)
        if len(roots) > 1:
            raise ValueError(
                "Multiple RGW account roots found; specify the root UID to import"
            )
        if roots:
            return next(iter(roots))
        return split_rgw_tenant_uid(self.root_uid(account_id), tenant)

    def _resolve_import_root_candidate(
        self,
        admin: RGWAdminClient,
        candidate: Any,
        *,
        account_id: str,
        tenant: str,
        tenant_declared: bool,
        account_scoped_candidates: bool,
    ) -> tuple[str, str] | None:
        raw_uid = (
            candidate.get("uid", candidate.get("user_id"))
            if isinstance(candidate, dict)
            else candidate
        )
        if not isinstance(raw_uid, str) or not raw_uid.strip():
            return None

        uid, candidate_tenant = split_rgw_tenant_uid(raw_uid)
        if "$" not in raw_uid:
            candidate_tenant = tenant if account_scoped_candidates else ""
        if tenant_declared and candidate_tenant != tenant:
            return None

        payload = admin.get_user(
            uid,
            tenant=candidate_tenant or None,
            allow_not_found=True,
        )
        if not payload:
            return None
        user = (
            payload.get("user")
            if isinstance(payload.get("user"), dict)
            else payload
        )
        if (
            user.get("account_id") != account_id
            or rgw_user_account_root(payload) is not True
        ):
            return None

        self.load_existing_root_user(
            admin,
            uid,
            account_id,
            candidate_tenant,
        )
        return uid, candidate_tenant

    def obtain_import_credentials(
        self,
        admin: RGWAdminClient,
        *,
        account_id: str,
        root_uid: str,
        root_display_name: str,
        tenant: str,
    ) -> tuple[str, str]:
        existing_root = self.load_existing_root_user(
            admin,
            root_uid,
            account_id,
            tenant,
        )
        access_key, secret_key = self._extract_credentials(admin, existing_root)
        if not access_key or not secret_key:
            if not existing_root:
                response = self._create_import_root(
                    admin,
                    account_id=account_id,
                    root_uid=root_uid,
                    root_display_name=root_display_name,
                    tenant=tenant,
                )
                access_key, secret_key = self._extract_credentials(admin, response)
                if not access_key or not secret_key:
                    existing_root = self.load_existing_root_user(
                        admin,
                        root_uid,
                        account_id,
                        tenant,
                    )
                    access_key, secret_key = self._extract_credentials(
                        admin,
                        existing_root,
                    )
            if not access_key or not secret_key:
                access_key, secret_key = self._create_import_access_key(
                    admin,
                    account_id=account_id,
                    root_uid=root_uid,
                    tenant=tenant,
                )
        if not access_key or not secret_key:
            raise ValueError(f"Unable to obtain root keys for account {account_id}")
        if not self.load_existing_root_user(admin, root_uid, account_id, tenant):
            raise ValueError("RGW account root could not be verified after import")
        return access_key, secret_key

    @staticmethod
    def _extract_credentials(
        admin: RGWAdminClient,
        payload: dict[str, Any] | None,
    ) -> tuple[str | None, str | None]:
        return RgwUserKeyParser.select_complete_credentials(
            admin.extract_keys(payload or {})
        )

    def _create_import_root(
        self,
        admin: RGWAdminClient,
        *,
        account_id: str,
        root_uid: str,
        root_display_name: str,
        tenant: str,
    ) -> dict[str, Any] | None:
        response = admin.create_user_with_account_id(
            uid=root_uid,
            account_id=account_id,
            display_name=root_display_name,
            account_root=True,
            **({"tenant": tenant} if tenant else {}),
        )
        if not (isinstance(response, dict) and response.get("conflict")):
            return response

        existing_root = self.load_existing_root_user(
            admin,
            root_uid,
            account_id,
            tenant,
        )
        if not existing_root:
            raise ValueError(
                "RGW root UID conflict; account ownership could not be verified"
            )
        return existing_root

    def _create_import_access_key(
        self,
        admin: RGWAdminClient,
        *,
        account_id: str,
        root_uid: str,
        tenant: str,
    ) -> tuple[str | None, str | None]:
        verified_root = self.load_existing_root_user(
            admin,
            root_uid,
            account_id,
            tenant,
        )
        if not verified_root:
            raise ValueError(
                "RGW account root could not be verified before key creation"
            )
        try:
            response = admin.create_access_key(
                root_uid,
                tenant=tenant or None,
            )
        except RGWAdminError:
            return None, None
        return self._extract_credentials(admin, response)

    def ensure_provisioned_credentials(
        self,
        admin: RGWAdminClient,
        *,
        rgw_account_id: str,
        account_name: str,
        resume: bool,
        tenant: str = "",
    ) -> tuple[str, str, str]:
        """Create or reconcile the root identity for a provisioned RGW account.

        Fresh provisioning deliberately creates the account and its root user
        through the same RGW client/session. Resume mode first reconciles an
        already-created root so interrupted onboarding can continue safely.
        """
        root_uid = self.root_uid(rgw_account_id)
        root_payload = self._ensure_provisioned_root(
            admin,
            rgw_account_id=rgw_account_id,
            account_name=account_name,
            root_uid=root_uid,
            tenant=tenant,
            resume=resume,
        )
        access_key, secret_key = self._provisioned_root_credentials(
            admin,
            rgw_account_id=rgw_account_id,
            root_uid=root_uid,
            tenant=tenant,
            root_payload=root_payload,
        )
        return root_uid, access_key, secret_key

    def _ensure_provisioned_root(
        self,
        admin: RGWAdminClient,
        *,
        rgw_account_id: str,
        account_name: str,
        root_uid: str,
        tenant: str,
        resume: bool,
    ) -> dict[str, Any]:
        root_payload = (
            self.load_existing_root_user(
                admin,
                root_uid,
                rgw_account_id,
                tenant,
            )
            if resume
            else None
        )
        if root_payload:
            return root_payload

        try:
            root_payload = admin.create_user_with_account_id(
                uid=root_uid,
                account_id=rgw_account_id,
                display_name=self.root_display_name(account_name, rgw_account_id),
                account_root=True,
                tenant=tenant or None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW root user creation failed: {exc}") from exc

        if isinstance(root_payload, dict) and root_payload.get("conflict"):
            root_payload = self.load_existing_root_user(
                admin,
                root_uid,
                rgw_account_id,
                tenant,
            )
            if not root_payload:
                raise ValueError(
                    "RGW root UID conflict; account ownership could not be verified"
                )
        return root_payload

    def _provisioned_root_credentials(
        self,
        admin: RGWAdminClient,
        *,
        rgw_account_id: str,
        root_uid: str,
        tenant: str,
        root_payload: dict[str, Any],
    ) -> tuple[str, str]:
        access_key, secret_key = self._extract_credentials(admin, root_payload)
        if not access_key or not secret_key:
            reconciled = self.load_existing_root_user(
                admin,
                root_uid,
                rgw_account_id,
                tenant,
            )
            access_key, secret_key = self._extract_credentials(admin, reconciled)
        if not access_key or not secret_key:
            try:
                key_payload = admin.create_access_key(root_uid, tenant=tenant or None)
            except RGWAdminError as exc:
                raise ValueError(
                    f"RGW root access key creation failed: {exc}"
                ) from exc
            access_key, secret_key = self._extract_credentials(admin, key_payload)
        if not access_key or not secret_key:
            raise ValueError("Unable to obtain root access/secret keys for account")
        return access_key, secret_key

    def delete_root_user(
        self,
        admin: RGWAdminClient,
        *,
        root_uid: str,
        account_id: str,
        tenant: str,
        local_account_id: int,
    ) -> None:
        try:
            if not self.load_existing_root_user(
                admin,
                root_uid,
                account_id,
                tenant,
            ):
                raise ValueError("RGW root user could not be verified before deletion")
            admin.delete_user(root_uid, tenant=tenant or None)
            logger.debug("Deleted RGW root user %s", root_uid)
        except RGWAdminError as exc:
            logger.debug("Unable to delete RGW root user %s: %s", root_uid, exc)
            raise ValueError(
                f"Unable to delete RGW root user {root_uid} "
                f"for account {local_account_id}: {exc}"
            ) from exc
