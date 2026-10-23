# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pathlib import Path

import yaml


def test_helm_requires_and_serializes_structured_trusted_proxy_cidrs():
    repository_root = Path(__file__).resolve().parents[2]
    values = yaml.safe_load(
        repository_root.joinpath("deploy/helm/bucketreef/values.yaml").read_text(encoding="utf-8")
    )
    template = repository_root.joinpath(
        "deploy/helm/bucketreef/templates/backend-deployment.yaml"
    ).read_text(encoding="utf-8")

    assert values["backend"]["trustedProxyCidrs"] == []
    assert "backend.trustedProxyCidrs is required" in template
    assert 'hasKey .Values.backend.env "TRUSTED_PROXY_CIDRS"' in template
    assert "name: TRUSTED_PROXY_CIDRS" in template
    assert ".Values.backend.trustedProxyCidrs | toJson" in template


def test_helm_supports_explicit_external_tls_termination():
    repository_root = Path(__file__).resolve().parents[2]
    values = yaml.safe_load(
        repository_root.joinpath("deploy/helm/bucketreef/values.yaml").read_text(encoding="utf-8")
    )
    template = repository_root.joinpath(
        "deploy/helm/bucketreef/templates/backend-deployment.yaml"
    ).read_text(encoding="utf-8")

    assert values["ingress"]["externalTlsTermination"] is False
    assert ".Values.ingress.externalTlsTermination" in template
    assert "unless ingress.externalTlsTermination=true" in template


def test_helm_internal_cron_requests_use_the_configured_ingress_host():
    repository_root = Path(__file__).resolve().parents[2]
    templates_dir = repository_root / "deploy/helm/bucketreef/templates"
    request_templates = []

    for template_path in sorted(templates_dir.glob("*cronjob.yaml")):
        template = template_path.read_text(encoding="utf-8")
        if "requests.post" not in template:
            continue
        request_templates.append(template_path.name)
        assert '"Host": {{ .Values.ingress.host | quote }}' in template

    assert request_templates


def test_ci_covers_positive_and_negative_trusted_proxy_rendering():
    repository_root = Path(__file__).resolve().parents[2]
    pipeline = repository_root.joinpath("ops/ci/tasks/helm-contract.sh").read_text(encoding="utf-8")

    assert "expected missing trusted proxy CIDRs to fail" in pipeline
    assert pipeline.count("backend.trustedProxyCidrs") >= 2
    assert "name: TRUSTED_PROXY_CIDRS" in pipeline
