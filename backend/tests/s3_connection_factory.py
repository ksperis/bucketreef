from __future__ import annotations


def custom_endpoint_fields(
    endpoint_url: str,
    *,
    region: str | None = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
    provider: str | None = None,
) -> dict[str, object]:
    return {
        "custom_endpoint_url": endpoint_url,
        "custom_region": region,
        "custom_force_path_style": force_path_style,
        "custom_verify_tls": verify_tls,
        "custom_provider": provider,
    }
