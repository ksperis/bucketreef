#!/bin/sh
# Unprivileged, native-platform smoke for fork contributions; no push or secrets.
set -eu
image="bucketreef-scheduler-contract:${GITHUB_RUN_ID:-${CI_JOB_ID:-local}}"
trap 'docker image rm "$image" >/dev/null 2>&1 || true' EXIT
docker build --file scheduler/Dockerfile --tag "$image" .
test "$(docker run --rm --read-only --tmpfs /tmp --entrypoint id "$image" -u)" = 10001
docker run --rm --read-only --tmpfs /tmp --entrypoint supercronic "$image" -version
