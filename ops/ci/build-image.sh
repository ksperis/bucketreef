#!/bin/sh
set -eu

: "${IMAGE_COMPONENT:?backend, frontend or scheduler}"
: "${CI_REGISTRY_IMAGE:?}"
: "${CI_COMMIT_SHA:?}"
validated_image="$CI_REGISTRY_IMAGE/$IMAGE_COMPONENT:$CI_COMMIT_SHA"
# Do not expose the immutable SHA tag until both runtime checks have passed.
image="$CI_REGISTRY_IMAGE/$IMAGE_COMPONENT:build-$CI_COMMIT_SHA-${CI_JOB_ID:-local}"
builder="bucketreef-${CI_JOB_ID:-local}"
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"; docker buildx rm "$builder" >/dev/null 2>&1 || true' EXIT
reuse=false
if docker buildx imagetools inspect --raw "$validated_image" >"$temporary/manifest.json" 2>"$temporary/inspect.err"; then
  jq -e '[.manifests[].platform | select(.os == "linux") | .architecture] | index("amd64") != null and index("arm64") != null' "$temporary/manifest.json" >/dev/null
  image=$validated_image
  reuse=true
  echo "Rechecking existing immutable image: $image"
elif ! grep -Eiq 'manifest unknown|name unknown|not found|404' "$temporary/inspect.err"; then
  cat "$temporary/inspect.err" >&2
  exit 1
fi
docker run --privileged --rm "$BINFMT_IMAGE" --install arm64,amd64
if [ "$reuse" = false ]; then
  docker buildx create --name "$builder" --driver docker-container --use
  case "$IMAGE_COMPONENT" in
    backend) set -- backend ;;
    frontend) set -- --build-arg "VITE_API_URL=${VITE_API_URL:-/api}" frontend ;;
    scheduler) set -- --file scheduler/Dockerfile . ;;
    *) echo 'Unknown image component' >&2; exit 1 ;;
  esac
  docker buildx build --platform linux/amd64,linux/arm64 --tag "$image" --push "$@"
fi

# Test both actual image variants, including their non-root runtime contract.
for arch in amd64 arm64; do
  docker pull --platform "linux/$arch" "$image"
  case "$IMAGE_COMPONENT" in
    backend)
      docker run --rm --platform "linux/$arch" --read-only --tmpfs /tmp --entrypoint python "$image" \
        -c 'from pathlib import Path; import os, app.scripts.issue_first_admin_bootstrap; assert os.getuid() == 10001; assert Path("/app/alembic/versions/0119_first_admin_bootstrap.py").is_file()'
      ;;
    frontend)
      # This isolated check serves the setup page without a backend container.
      container=$(docker run --detach --platform "linux/$arch" --read-only --tmpfs /tmp \
        --env BACKEND_UPSTREAM=127.0.0.1:8000 "$image")
      trap 'rm -rf "$temporary"; docker rm --force "$container" >/dev/null 2>&1 || true; docker buildx rm "$builder" >/dev/null 2>&1 || true' EXIT
      attempt=0
      until docker exec "$container" wget -q -O /dev/null http://127.0.0.1:8080/setup/first-admin; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 30 ]; then docker logs "$container"; exit 1; fi
        sleep 1
      done
      docker exec "$container" grep -F "connect-src 'self'" /tmp/nginx.conf
      docker rm --force "$container" >/dev/null
      trap 'rm -rf "$temporary"; docker buildx rm "$builder" >/dev/null 2>&1 || true' EXIT
      ;;
    scheduler)
      test "$(docker run --rm --platform "linux/$arch" --read-only --tmpfs /tmp --entrypoint id "$image" -u)" = 10001
      docker run --rm --platform "linux/$arch" --read-only --tmpfs /tmp --entrypoint supercronic "$image" -version
      ;;
  esac
done
if [ "$reuse" = false ]; then
  docker buildx imagetools create --tag "$validated_image" "$image"
fi
