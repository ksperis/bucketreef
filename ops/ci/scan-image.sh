#!/bin/sh
set -eu
: "${IMAGE_COMPONENT:?}"
: "${IMAGE_ARCH:?}"
image="${SOURCE_IMAGE:-$CI_REGISTRY_IMAGE/$IMAGE_COMPONENT:$CI_COMMIT_SHA}"
report="gl-security-reports/$IMAGE_COMPONENT-${SCAN_KIND:-image}-$IMAGE_ARCH"
scan_exit=0
trivy image --platform "linux/$IMAGE_ARCH" \
  --scanners vuln --pkg-types os,library --exit-code 1 \
  --severity "$TRIVY_SEVERITY" --ignore-unfixed --ignorefile .trivyignore \
  --timeout "$TRIVY_TIMEOUT" --no-progress \
  --format json --output "$report-trivy.json" "$image" || scan_exit=$?
trivy image --platform "linux/$IMAGE_ARCH" --format cyclonedx \
  --output "$report-sbom.cdx.json" "$image"
trivy convert --format table "$report-trivy.json"
exit "$scan_exit"
