#!/bin/sh
set -eu
: "${CI_REGISTRY_IMAGE:=registry.invalid/bucketreef}"
: "${CI_COMMIT_SHA:=0000000000000000000000000000000000000000}"
helm lint deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml --set backend.existingSecret=bucketreef-auth
if helm template bucketreef deploy/helm/bucketreef --set backend.existingSecret=bucketreef-auth --set networkPolicy.strict=false > /tmp/bucketreef-invalid.yaml 2>/tmp/bucketreef-invalid.err; then echo "expected missing trusted proxy CIDRs to fail"; exit 1; fi
grep -q 'backend.trustedProxyCidrs is required' /tmp/bucketreef-invalid.err
if helm template bucketreef deploy/helm/bucketreef --set backend.existingSecret=bucketreef-auth --set-json 'backend.trustedProxyCidrs=["10.42.0.0/16"]' > /tmp/bucketreef-network-invalid.yaml 2>/tmp/bucketreef-network-invalid.err; then echo "expected missing strict NetworkPolicy selectors to fail"; exit 1; fi
grep -q 'networkPolicy.ingressController.namespaceSelector.matchLabels is required' /tmp/bucketreef-network-invalid.err
helm template bucketreef deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml --set backend.existingSecret=bucketreef-auth > /tmp/bucketreef-rendered.yaml
test -s /tmp/bucketreef-rendered.yaml
grep -q 'name: TRUSTED_PROXY_CIDRS' /tmp/bucketreef-rendered.yaml
grep -Fq '[\"10.244.0.0/16\"]' /tmp/bucketreef-rendered.yaml
chart_version=$(awk '/^appVersion:/ {gsub(/"/, "", $2); print $2}' deploy/helm/bucketreef/Chart.yaml)
grep -q "ghcr.io/ksperis/bucketreef-backend:$chart_version" /tmp/bucketreef-rendered.yaml
grep -q "ghcr.io/ksperis/bucketreef-frontend:$chart_version" /tmp/bucketreef-rendered.yaml

grep -q 'kind: NetworkPolicy' /tmp/bucketreef-rendered.yaml
grep -q 'readOnlyRootFilesystem: true' /tmp/bucketreef-rendered.yaml
grep -q 'automountServiceAccountToken: false' /tmp/bucketreef-rendered.yaml
helm template bucketreef deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml --set backend.existingSecret=bucketreef-auth --set backend.replicas=2 --set backend.persistence.enabled=false > /tmp/bucketreef-multi-backend.yaml
test -s /tmp/bucketreef-multi-backend.yaml
helm template bucketreef deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml --set backend.existingSecret=bucketreef-auth --set-string image.backend.repository="$CI_REGISTRY_IMAGE/backend" --set-string image.backend.tag="$CI_COMMIT_SHA" --set-string image.frontend.repository="$CI_REGISTRY_IMAGE/frontend" --set-string image.frontend.tag="$CI_COMMIT_SHA" > /tmp/bucketreef-commit-images.yaml
grep -q "$CI_REGISTRY_IMAGE/backend:$CI_COMMIT_SHA" /tmp/bucketreef-commit-images.yaml
grep -q "$CI_REGISTRY_IMAGE/frontend:$CI_COMMIT_SHA" /tmp/bucketreef-commit-images.yaml
