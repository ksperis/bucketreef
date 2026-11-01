# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import socket

import pytest

from app.utils.network_targets import (
    host_matches_allowlist,
    resolve_hostname_ips,
    url_hostname,
    validate_outbound_url,
)


def _set_resolved_ips(monkeypatch, ips: list[str]) -> None:
    def fake_getaddrinfo(host: str, port: object):
        _ = host, port
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))
            for ip in ips
        ]

    monkeypatch.setattr("app.utils.network_targets.socket.getaddrinfo", fake_getaddrinfo)


def test_url_hostname_returns_only_the_normalized_hostname():
    assert (
        url_hostname("https://S3.Example.TEST.:9443/private/path?signature=hidden")
        == "s3.example.test"
    )
    assert url_hostname("not-a-url") == ""


def test_resolve_hostname_ips_ignores_invalid_address_entries(monkeypatch):
    _set_resolved_ips(monkeypatch, ["not-an-ip", "93.184.216.34"])

    assert {str(address) for address in resolve_hostname_ips("s3.example.test")} == {
        "93.184.216.34"
    }


def test_resolve_hostname_ips_propagates_unexpected_parser_failures(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34"])

    def unexpected_failure(_address):
        raise RuntimeError("unexpected parser failure")

    monkeypatch.setattr("app.utils.network_targets.ipaddress.ip_address", unexpected_failure)

    with pytest.raises(RuntimeError, match="unexpected parser failure"):
        resolve_hostname_ips("s3.example.test")


def test_validate_outbound_url_accepts_public_https_url(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34"])

    validate_outbound_url(
        "https://s3.example.test",
        field_name="Endpoint URL",
        allowed_schemes=("https",),
        scheme_label="https",
    )


def test_validate_outbound_url_rejects_http_scheme(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34"])

    with pytest.raises(ValueError, match="valid https URL"):
        validate_outbound_url(
            "http://s3.example.test",
            field_name="Endpoint URL",
            allowed_schemes=("https",),
            scheme_label="https",
        )


def test_validate_outbound_url_rejects_credentials(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34"])

    with pytest.raises(ValueError, match="must not include user credentials"):
        validate_outbound_url(
            "https://user:pass@s3.example.test",
            field_name="Endpoint URL",
            allowed_schemes=("https",),
            scheme_label="https",
        )


def test_validate_outbound_url_rejects_unresolved_host(monkeypatch):
    def raise_gaierror(host: str, port: object):
        _ = host, port
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr("app.utils.network_targets.socket.getaddrinfo", raise_gaierror)

    with pytest.raises(ValueError, match="host cannot be resolved"):
        validate_outbound_url(
            "https://missing.example.test",
            field_name="Endpoint URL",
            allowed_schemes=("https",),
            scheme_label="https",
        )


@pytest.mark.parametrize("ip_address", ["127.0.0.1", "10.0.0.12", "169.254.10.20"])
def test_validate_outbound_url_rejects_private_or_local_targets(monkeypatch, ip_address: str):
    _set_resolved_ips(monkeypatch, [ip_address])

    with pytest.raises(ValueError, match="private or local network address"):
        validate_outbound_url(
            "https://unsafe.example.test",
            field_name="Endpoint URL",
            allowed_schemes=("https",),
            scheme_label="https",
        )


def test_host_allowlist_requires_explicit_wildcard_for_subdomains():
    assert host_matches_allowlist("example.com", {"example.com"}) is True
    assert host_matches_allowlist("s3.example.com", {"example.com"}) is False
    assert host_matches_allowlist("s3.example.com", {"*.example.com"}) is True
    assert host_matches_allowlist("deep.s3.example.com", {"*.example.com"}) is True
    assert host_matches_allowlist("example.com", {"*.example.com"}) is False
    assert host_matches_allowlist("notexample.com", {"*.example.com"}) is False


def test_validate_outbound_url_rejects_every_host_when_allowlist_is_empty(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34"])

    with pytest.raises(ValueError, match="host is not allowed by policy"):
        validate_outbound_url(
            "https://s3.example.test",
            field_name="Endpoint URL",
            allowed_hosts=set(),
        )


def test_validate_outbound_url_rejects_mixed_public_and_private_dns_answers(monkeypatch):
    _set_resolved_ips(monkeypatch, ["93.184.216.34", "fd00::12"])

    with pytest.raises(ValueError, match="private or local network address"):
        validate_outbound_url("https://mixed.example.test", field_name="Endpoint URL")


def test_validate_outbound_url_revalidates_dns_on_every_call(monkeypatch):
    answers = iter((["93.184.216.34"], ["10.0.0.12"]))

    def changing_getaddrinfo(host: str, port: object):
        _ = host, port
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in next(answers)]

    monkeypatch.setattr("app.utils.network_targets.socket.getaddrinfo", changing_getaddrinfo)
    validate_outbound_url("https://changing.example.test", field_name="Endpoint URL")
    with pytest.raises(ValueError, match="private or local network address"):
        validate_outbound_url("https://changing.example.test", field_name="Endpoint URL")
