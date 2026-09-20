#!/bin/sh
set -eu
: "${RELEASE_VERSION:?}"
: "${GHCR_USERNAME:?}"
: "${GHCR_TOKEN:?}"
chart="oci://ghcr.io/ksperis/charts/bucketreef"
archive="dist/release/bucketreef-$RELEASE_VERSION.tgz"
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
export HELM_REGISTRY_CONFIG="$temporary/registry.json"
printf '%s' "$GHCR_TOKEN" | helm registry login ghcr.io --username "$GHCR_USERNAME" --password-stdin
# Reuse the packaged, fingerprinted candidate; publication never repackages it.
test -s "$archive"
mkdir "$temporary/expected" "$temporary/existing"
tar -xzf "$archive" -C "$temporary/expected"
if helm pull "$chart" --version "$RELEASE_VERSION" --destination "$temporary/existing" 2>"$temporary/pull.err"; then
  tar -xzf "$temporary/existing/bucketreef-$RELEASE_VERSION.tgz" -C "$temporary/existing"
  # The candidate archive is deterministic: a different version is immutable.
  cmp "$archive" "$temporary/existing/bucketreef-$RELEASE_VERSION.tgz"
else
  if ! grep -Eiq 'not found|404|manifest unknown' "$temporary/pull.err"; then
    cat "$temporary/pull.err" >&2
    exit 1
  fi
  helm push "$archive" oci://ghcr.io/ksperis/charts
fi
# A successful authenticated push alone is insufficient for public installation.
export HELM_REGISTRY_CONFIG="$temporary/anonymous.json"
export DOCKER_CONFIG="$temporary/docker-anonymous"
mkdir "$DOCKER_CONFIG"
printf '{}\n' > "$DOCKER_CONFIG/config.json"
if ! helm pull "$chart" --version "$RELEASE_VERSION" --destination "$temporary"; then
  echo 'Make the charts/bucketreef GHCR package public, then retry this job.' >&2
  exit 1
fi
mkdir "$temporary/public"
tar -xzf "$temporary/bucketreef-$RELEASE_VERSION.tgz" -C "$temporary/public"
cmp "$archive" "$temporary/bucketreef-$RELEASE_VERSION.tgz"
