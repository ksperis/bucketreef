#!/bin/sh
set -eu
: "${IMAGE_COMPONENT:?}"
: "${IMAGE_ARCH:?}"
if [ -n "${SOURCE_IMAGE:-}" ]; then
  image=$SOURCE_IMAGE
elif [ -f "release-sources/$IMAGE_COMPONENT" ]; then
  image=$(cat "release-sources/$IMAGE_COMPONENT")
else
  digest=$(cat "image-receipts/$IMAGE_COMPONENT.digest")
  image="$CI_REGISTRY_IMAGE/$IMAGE_COMPONENT@$digest"
fi
case "$image" in *@sha256:*) ;; *) echo 'Image scans require an immutable digest' >&2; exit 1 ;; esac
report="gl-security-reports/$IMAGE_COMPONENT-${SCAN_KIND:-image}-$IMAGE_ARCH"
scan_exit=0
trivy image --platform "linux/$IMAGE_ARCH" \
  --scanners vuln --pkg-types os,library --list-all-pkgs --exit-code 1 \
  --severity "$TRIVY_SEVERITY" --ignore-unfixed --ignorefile .trivyignore \
  --timeout "$TRIVY_TIMEOUT" --no-progress \
  --format json --output "$report-trivy.json" "$image" || scan_exit=$?
trivy convert --format cyclonedx --output "$report-sbom.cdx.json" "$report-trivy.json"
trivy convert --format table "$report-trivy.json"
if [ "$scan_exit" -eq 0 ]; then
  python3 ops/ci/scan_receipt.py "$report-trivy.json" "$image" "$IMAGE_ARCH"
fi
exit "$scan_exit"
