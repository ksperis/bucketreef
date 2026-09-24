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
grep -A1 'name: DEPLOYMENT_PROFILE' /tmp/bucketreef-rendered.yaml | grep -q 'value: "full"'
grep -Fq '[\"10.244.0.0/16\"]' /tmp/bucketreef-rendered.yaml
chart_version=$(awk '/^appVersion:/ {gsub(/"/, "", $2); print $2}' deploy/helm/bucketreef/Chart.yaml)
grep -q "ghcr.io/ksperis/bucketreef-backend:$chart_version" /tmp/bucketreef-rendered.yaml
grep -q "ghcr.io/ksperis/bucketreef-frontend:$chart_version" /tmp/bucketreef-rendered.yaml

grep -q 'kind: NetworkPolicy' /tmp/bucketreef-rendered.yaml
grep -q 'readOnlyRootFilesystem: true' /tmp/bucketreef-rendered.yaml
grep -q 'automountServiceAccountToken: false' /tmp/bucketreef-rendered.yaml

helm template bucketreef-admin deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml -f deploy/helm/bucketreef/values-admin.yaml --set backend.existingSecret=bucketreef-auth --set healthcheckCronJob.enabled=true > /tmp/bucketreef-admin.yaml
grep -A1 'name: DEPLOYMENT_PROFILE' /tmp/bucketreef-admin.yaml | grep -q 'value: "admin"'
grep -A1 'name: FEATURE_ADMIN_ENABLED' /tmp/bucketreef-admin.yaml | grep -q 'value: "true"'
grep -A1 'name: FEATURE_CEPH_ADMIN_ENABLED' /tmp/bucketreef-admin.yaml | grep -q 'value: "true"'
grep -A1 'name: FEATURE_MANAGER_ENABLED' /tmp/bucketreef-admin.yaml | grep -q 'value: "false"'
grep -A1 'name: SCHEDULED_JOBS_ENABLED' /tmp/bucketreef-admin.yaml | grep -q 'value: "true"'
grep -q 'kind: CronJob' /tmp/bucketreef-admin.yaml

helm template bucketreef-admin deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml -f deploy/helm/bucketreef/values-admin-no-ceph-admin.yaml --set backend.existingSecret=bucketreef-auth --set healthcheckCronJob.enabled=true > /tmp/bucketreef-admin-no-ceph-admin.yaml
grep -A1 'name: DEPLOYMENT_PROFILE' /tmp/bucketreef-admin-no-ceph-admin.yaml | grep -q 'value: "admin-no-ceph-admin"'
grep -A1 'name: FEATURE_ADMIN_ENABLED' /tmp/bucketreef-admin-no-ceph-admin.yaml | grep -q 'value: "true"'
grep -A1 'name: FEATURE_CEPH_ADMIN_ENABLED' /tmp/bucketreef-admin-no-ceph-admin.yaml | grep -q 'value: "false"'
grep -A1 'name: FEATURE_STORAGE_OPS_ENABLED' /tmp/bucketreef-admin-no-ceph-admin.yaml | grep -q 'value: "true"'
grep -A1 'name: SCHEDULED_JOBS_ENABLED' /tmp/bucketreef-admin-no-ceph-admin.yaml | grep -q 'value: "true"'
grep -q 'kind: CronJob' /tmp/bucketreef-admin-no-ceph-admin.yaml

helm template bucketreef-user deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml -f deploy/helm/bucketreef/values-user.yaml --set backend.existingSecret=bucketreef-auth > /tmp/bucketreef-user.yaml
grep -A1 'name: DEPLOYMENT_PROFILE' /tmp/bucketreef-user.yaml | grep -q 'value: "user"'
grep -A1 'name: FEATURE_ADMIN_ENABLED' /tmp/bucketreef-user.yaml | grep -q 'value: "false"'
grep -A1 'name: FEATURE_MANAGER_ENABLED' /tmp/bucketreef-user.yaml | grep -q 'value: "true"'
grep -A1 'name: SCHEDULED_JOBS_ENABLED' /tmp/bucketreef-user.yaml | grep -q 'value: "false"'
if grep -q 'kind: CronJob' /tmp/bucketreef-user.yaml; then echo "user profile must not render scheduled jobs"; exit 1; fi
if helm template bucketreef-user deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml -f deploy/helm/bucketreef/values-user.yaml --set backend.existingSecret=bucketreef-auth --set healthcheckCronJob.enabled=true > /tmp/bucketreef-user-jobs-invalid.yaml 2>/tmp/bucketreef-user-jobs-invalid.err; then echo "expected user profile with jobs enabled to fail"; exit 1; fi
grep -q 'deploymentProfile=user cannot own scheduled jobs' /tmp/bucketreef-user-jobs-invalid.err

helm template bucketreef-ceph-admin deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml -f deploy/helm/bucketreef/values-ceph-admin-high-security.yaml --set backend.existingSecret=bucketreef-ceph-admin-auth > /tmp/bucketreef-ceph-admin.yaml
grep -A1 'name: DEPLOYMENT_PROFILE' /tmp/bucketreef-ceph-admin.yaml | grep -q 'value: "ceph-admin-high-security"'
grep -A1 'name: CEPH_ADMIN_HIGH_SECURITY_MODE' /tmp/bucketreef-ceph-admin.yaml | grep -q 'value: "true"'
grep -A1 'name: FEATURE_ADMIN_ENABLED' /tmp/bucketreef-ceph-admin.yaml | grep -q 'value: "false"'
grep -A1 'name: FEATURE_CEPH_ADMIN_ENABLED' /tmp/bucketreef-ceph-admin.yaml | grep -q 'value: "true"'
grep -A1 'name: FEATURE_MANAGER_ENABLED' /tmp/bucketreef-ceph-admin.yaml | grep -q 'value: "false"'
grep -A1 'name: SCHEDULED_JOBS_ENABLED' /tmp/bucketreef-ceph-admin.yaml | grep -q 'value: "false"'
if grep -q 'kind: CronJob' /tmp/bucketreef-ceph-admin.yaml; then echo "Ceph Admin high-security profile must not render scheduled jobs"; exit 1; fi
if helm template bucketreef-ceph-admin deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml -f deploy/helm/bucketreef/values-ceph-admin-high-security.yaml --set backend.existingSecret=bucketreef-ceph-admin-auth --set healthcheckCronJob.enabled=true > /tmp/bucketreef-ceph-admin-jobs-invalid.yaml 2>/tmp/bucketreef-ceph-admin-jobs-invalid.err; then echo "expected Ceph Admin high-security profile with jobs enabled to fail"; exit 1; fi
grep -q 'deploymentProfile=ceph-admin-high-security cannot own scheduled jobs' /tmp/bucketreef-ceph-admin-jobs-invalid.err

helm template bucketreef deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml --set backend.existingSecret=bucketreef-auth --set backend.replicas=2 --set backend.persistence.enabled=false > /tmp/bucketreef-multi-backend.yaml
test -s /tmp/bucketreef-multi-backend.yaml
helm template bucketreef deploy/helm/bucketreef -f ops/ci/helm-secure-values.yaml --set backend.existingSecret=bucketreef-auth --set-string image.backend.repository="$CI_REGISTRY_IMAGE/backend" --set-string image.backend.tag="$CI_COMMIT_SHA" --set-string image.frontend.repository="$CI_REGISTRY_IMAGE/frontend" --set-string image.frontend.tag="$CI_COMMIT_SHA" > /tmp/bucketreef-commit-images.yaml
grep -q "$CI_REGISTRY_IMAGE/backend:$CI_COMMIT_SHA" /tmp/bucketreef-commit-images.yaml
grep -q "$CI_REGISTRY_IMAGE/frontend:$CI_COMMIT_SHA" /tmp/bucketreef-commit-images.yaml
