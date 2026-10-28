# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Bounded Keystone v3 reader. It never creates or deletes remote credentials."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from urllib.parse import quote, urlsplit

import requests

from app.core.config import get_settings
from app.models.openstack import OpenStackAuthenticate
from app.utils.network_targets import validate_outbound_url
from app.utils.s3_endpoint import validate_openstack_catalog_s3_endpoint
from app.utils.time import normalize_utc, utcnow


class OpenStackError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


@dataclass(frozen=True, repr=False)
class KeystoneIdentity:
    token: str
    user_id: str
    name: str
    expires_at: datetime
    project_id: str | None = None


def identifier(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise OpenStackError("invalid_provider_response", "Keystone returned an invalid identity", 502)
    return value


class KeystoneClient:
    def __init__(self, auth_url: str):
        self.auth_url = auth_url.rstrip("/")

    def _request(self, method: str, path: str, *, token: str | None = None, body=None, subject: str | None = None):
        settings = get_settings()
        url = self.auth_url + path
        try:
            validate_outbound_url(
                url, field_name="Keystone URL", allowed_hosts=set(settings.openstack_allowed_hosts),
                allow_private_targets=settings.openstack_allow_private_targets,
            )
        except ValueError:
            raise OpenStackError("outbound_policy", "Keystone destination is not allowed by outbound policy", 403) from None
        headers = {"Accept": "application/json"}
        if token:
            headers["X-Auth-Token"] = token
        if subject:
            headers["X-Subject-Token"] = subject
        try:
            with requests.request(
                method, url, json=body, headers=headers, timeout=(5, 20),
                allow_redirects=False, verify=settings.openstack_ca_file or True, stream=True,
            ) as response:
                if response.status_code == 401:
                    raise OpenStackError("reauthentication_required", "Reconnect to OpenStack")
                if response.status_code == 403:
                    raise OpenStackError("access_denied", "Keystone denied this operation", 403)
                if not 200 <= response.status_code < 300:
                    raise OpenStackError("provider_unavailable", "Keystone request failed", 502)
                raw = bytearray()
                for chunk in response.iter_content(chunk_size=65536):
                    raw.extend(chunk)
                    if len(raw) > 2 * 1024 * 1024:
                        raise OpenStackError("invalid_provider_response", "Keystone response is too large", 502)
                import json
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    raise ValueError()
                return payload, response.headers.get("X-Subject-Token")
        except (requests.RequestException, ValueError, TypeError):
            raise OpenStackError("provider_unavailable", "Keystone is unavailable or returned an invalid response", 502) from None

    @staticmethod
    def _identity(payload: dict, token: str | None) -> KeystoneIdentity:
        try:
            data = payload["token"]
            user = data["user"]
            expires = normalize_utc(datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00")))
            methods = data["methods"]
            # Never turn a restricted delegation into access to persistent keys.
            primary = {"password", "token", "totp", "mapped", "saml2", "openid", "external", "kerberos", "x509"}
            if not isinstance(methods, list) or not methods or any(method not in primary for method in methods) or any(
                key in data for key in ("OS-TRUST:trust", "application_credential", "OS-OAUTH1")
            ):
                raise OpenStackError("unsupported_token", "A primary user authentication token is required", 403)
            if expires <= utcnow():
                raise OpenStackError("reauthentication_required", "Reconnect to OpenStack")
            return KeystoneIdentity(identifier(token), identifier(user["id"]),
                                    str(user.get("name") or user["id"]), expires,
                                    data.get("project", {}).get("id"))
        except (KeyError, TypeError, ValueError, AttributeError):
            raise OpenStackError("invalid_provider_response", "Keystone returned an invalid token", 502) from None

    def authenticate(self, payload: OpenStackAuthenticate, default_domain: str | None) -> KeystoneIdentity:
        source_expiration = None
        source_user = None
        if payload.method == "token":
            raw_token = payload.token.get_secret_value()
            source, _ = self._request("GET", "/auth/tokens", token=raw_token, subject=raw_token)
            original = self._identity(source, raw_token)
            source_expiration, source_user = original.expires_at, original.user_id
            identity = {"methods": ["token"], "token": {"id": raw_token}}
        else:
            user = {"password": payload.password.get_secret_value()}
            if payload.user_id:
                user["id"] = payload.user_id
            else:
                user["name"] = payload.username
                domain = payload.domain or default_domain
                if not domain:
                    raise OpenStackError("domain_required", "A user domain is required", 422)
                user["domain"] = {"id" if payload.domain_is_id else "name": domain}
            identity = {"methods": ["password"], "password": {"user": user}}
        data, token = self._request("POST", "/auth/tokens", body={"auth": {"identity": identity, "scope": "unscoped"}})
        result = self._identity(data, token)
        if source_user is not None and source_user != result.user_id:
            raise OpenStackError("identity_mismatch", "Keystone identity changed", 403)
        if payload.method == "password" and payload.user_id and payload.user_id != result.user_id:
            raise OpenStackError("identity_mismatch", "Keystone returned a different user", 403)
        return KeystoneIdentity(result.token, result.user_id, result.name,
                                min(result.expires_at, source_expiration) if source_expiration else result.expires_at)

    def projects(self, token: str) -> list[dict]:
        result = []
        path = "/auth/projects"
        visited = set()
        for _ in range(20):
            if path in visited:
                break
            visited.add(path)
            payload, _ = self._request("GET", path, token=token)
            projects = payload.get("projects")
            if not isinstance(projects, list) or len(result) + len(projects) > 10000:
                raise OpenStackError("invalid_provider_response", "Invalid Keystone project listing", 502)
            for item in projects:
                if not isinstance(item, dict):
                    raise OpenStackError("invalid_provider_response", "Invalid Keystone project", 502)
                if item.get("enabled", True):
                    result.append({"id": identifier(item.get("id")), "name": str(item.get("name") or item["id"]), "domain_id": item.get("domain_id")})
            links = payload.get("links", {})
            if not isinstance(links, dict):
                raise OpenStackError("invalid_provider_response", "Invalid Keystone pagination", 502)
            next_url = links.get("next")
            if not next_url:
                return result
            if not isinstance(next_url, str):
                raise OpenStackError("invalid_provider_response", "Invalid Keystone pagination", 502)
            parsed, base = urlsplit(next_url), urlsplit(self.auth_url)
            if parsed.scheme != base.scheme or parsed.netloc != base.netloc or not parsed.path.startswith(base.path + "/") or parsed.fragment:
                raise OpenStackError("invalid_provider_response", "Unsafe Keystone pagination link", 502)
            path = parsed.path[len(base.path):] + ("?" + parsed.query if parsed.query else "")
        raise OpenStackError("invalid_provider_response", "Keystone project pagination limit exceeded", 502)

    def scoped(self, identity: KeystoneIdentity, project_id: str) -> KeystoneIdentity:
        return self._scoped_payload(identity, project_id)[0]

    def _scoped_payload(self, identity: KeystoneIdentity, project_id: str) -> tuple[KeystoneIdentity, list[dict]]:
        data, token = self._request("POST", "/auth/tokens", body={"auth": {
            "identity": {"methods": ["token"], "token": {"id": identity.token}}, "scope": {"project": {"id": project_id}},
        }})
        scoped = self._identity(data, token)
        if scoped.user_id != identity.user_id or scoped.project_id != project_id:
            raise OpenStackError("identity_mismatch", "Keystone returned a different user or project", 403)
        catalog = data.get("token", {}).get("catalog", [])
        if not isinstance(catalog, list) or len(catalog) > 512:
            raise OpenStackError("invalid_provider_response", "Invalid Keystone service catalog", 502)
        return scoped, catalog

    @staticmethod
    def _looks_like_direct_s3_url(url: str) -> bool:
        """Accept object-store fallback only when the catalog URL is not a Swift API path."""
        path = urlsplit(url).path.strip("/")
        if not path:
            return True
        segments = [part.casefold() for part in path.split("/") if part]
        return not any(part == "v1" or part == "swift" or part.startswith("auth_") for part in segments)

    @classmethod
    def _catalog_targets(cls, catalog: list[dict]) -> list[dict]:
        explicit: list[dict] = []
        fallback: list[dict] = []
        endpoint_count = 0
        for service in catalog:
            if not isinstance(service, dict):
                raise OpenStackError("invalid_provider_response", "Invalid Keystone service catalog", 502)
            service_type = service.get("type")
            if not isinstance(service_type, str) or not service_type or len(service_type) > 128:
                continue
            service_type = service_type.casefold()
            if service_type not in {"s3", "object-store"}:
                continue
            service_name = service.get("name")
            if service_name is not None and (not isinstance(service_name, str) or len(service_name) > 255):
                raise OpenStackError("invalid_provider_response", "Invalid Keystone service catalog", 502)
            endpoints = service.get("endpoints")
            if not isinstance(endpoints, list):
                raise OpenStackError("invalid_provider_response", "Invalid Keystone service catalog", 502)
            endpoint_count += len(endpoints)
            if endpoint_count > 4096:
                raise OpenStackError("invalid_provider_response", "Keystone service catalog is too large", 502)
            for endpoint in endpoints:
                if not isinstance(endpoint, dict):
                    raise OpenStackError("invalid_provider_response", "Invalid Keystone catalog endpoint", 502)
                interface = endpoint.get("interface")
                if interface not in {"public", "internal"}:
                    continue
                raw_url = endpoint.get("url")
                if not isinstance(raw_url, str) or not raw_url or len(raw_url) > 2048:
                    continue
                if service_type == "object-store" and not cls._looks_like_direct_s3_url(raw_url):
                    continue
                try:
                    endpoint_url = validate_openstack_catalog_s3_endpoint(raw_url)
                    target_id = identifier(endpoint.get("id"))
                    region_id = identifier(endpoint.get("region_id") or endpoint.get("region") or "default")
                except ValueError:
                    continue
                candidate = {
                    "target_id": target_id,
                    "region_id": region_id,
                    "interface": interface,
                    "service_type": service_type,
                    "service_name": service_name,
                    "endpoint_url": endpoint_url,
                }
                (explicit if service_type == "s3" else fallback).append(candidate)

        candidates = explicit or fallback
        if not candidates:
            return []
        # One usable S3 target per real Keystone region. Prefer public over internal.
        candidates.sort(key=lambda item: (
            item["region_id"].casefold(),
            0 if item["interface"] == "public" else 1,
            (item["service_name"] or "").casefold(),
            item["target_id"],
        ))
        result: list[dict] = []
        seen_regions: set[str] = set()
        for candidate in candidates:
            region_key = candidate["region_id"].casefold()
            if region_key in seen_regions:
                continue
            seen_regions.add(region_key)
            result.append(candidate)
        return result

    def _credentials(self, identity: KeystoneIdentity, project_id: str, scoped: KeystoneIdentity) -> list[dict]:
        payload, _ = self._request("GET", f"/users/{quote(identity.user_id, safe='')}/credentials/OS-EC2", token=scoped.token)
        rows = payload.get("credentials")
        if not isinstance(rows, list) or len(rows) > 10000:
            raise OpenStackError("invalid_provider_response", "Invalid EC2 credential listing", 502)
        result = []
        seen = set()
        for row in rows:
            if not isinstance(row, dict) or row.get("user_id") != identity.user_id:
                raise OpenStackError("identity_mismatch", "Keystone returned credentials for a different user", 403)
            if row.get("tenant_id") and row.get("project_id") and row["tenant_id"] != row["project_id"]:
                raise OpenStackError("identity_mismatch", "Keystone returned contradictory project identifiers", 403)
            if (row.get("tenant_id") or row.get("project_id")) == project_id:
                if row.get("access") in seen:
                    raise OpenStackError("invalid_provider_response", "Keystone returned duplicate credential identifiers", 502)
                seen.add(row.get("access"))
                result.append({"access": identifier(row.get("access")), "secret": identifier(row.get("secret")), "expires_at": min(scoped.expires_at, identity.expires_at)})
        return result

    def credentials(self, identity: KeystoneIdentity, project_id: str) -> list[dict]:
        scoped = self.scoped(identity, project_id)
        return self._credentials(identity, project_id, scoped)

    def project_access(self, identity: KeystoneIdentity, project_id: str) -> dict:
        scoped, catalog = self._scoped_payload(identity, project_id)
        return {
            "targets": self._catalog_targets(catalog),
            "credentials": self._credentials(identity, project_id, scoped),
        }
