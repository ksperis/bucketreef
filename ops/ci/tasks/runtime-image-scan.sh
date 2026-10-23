#!/bin/sh
# Build (when needed) and scan the actual runtime image in public CI.
set -eu

component=${1:?Component required}
image=${2:-}
built=false

case "$component" in
  backend|frontend|scheduler) ;;
  *) echo "Unsupported runtime image component: $component" >&2; exit 1 ;;
esac

if [ -z "$image" ]; then
  image="bucketreef-$component-public-scan:${GITHUB_RUN_ID:-local}"
  built=true
  case "$component" in
    backend) docker build --tag "$image" backend ;;
    frontend) docker build --tag "$image" frontend ;;
    scheduler) docker build --file scheduler/Dockerfile --tag "$image" . ;;
  esac
fi

if [ "$built" = true ]; then
  trap 'docker image rm "$image" >/dev/null 2>&1 || true' EXIT
fi

mkdir -p gl-security-reports
report="gl-security-reports/$component-runtime-image-trivy.json"
trivy_image=$(python3 ops/ci/toolchain.py image aquasec/trivy:0.76.1)
scan_exit=0

docker run --rm \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume "$PWD:/work" --workdir /work \
  "$trivy_image" image \
  --scanners vuln --pkg-types os,library --list-all-pkgs --exit-code 1 \
  --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore \
  --timeout 20m --no-progress --format json --output "/work/$report" \
  "$image" || scan_exit=$?

docker run --rm \
  --volume "$PWD:/work" --workdir /work \
  "$trivy_image" convert --scanners vuln --severity HIGH,CRITICAL --format table "/work/$report"

exit "$scan_exit"
