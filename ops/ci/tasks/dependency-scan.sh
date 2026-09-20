#!/bin/sh
set -eu
component=${1:?Component required}
mkdir -p gl-security-reports
report="gl-security-reports/$component-dependencies-trivy.json"
scan_exit=0
trivy fs --scanners vuln --list-all-pkgs --exit-code 1 --severity HIGH,CRITICAL \
  --ignore-unfixed --ignorefile .trivyignore --timeout 20m --no-progress \
  --format json --output "$report" "$component" || scan_exit=$?
trivy convert --format cyclonedx --output "gl-security-reports/$component-sbom.cdx.json" "$report"
trivy convert --format table "$report"
exit "$scan_exit"
