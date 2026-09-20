#!/bin/sh
set -eu
: "${IMAGE_ARCH:?}"
: "${CI_JOB_ID:?This smoke test requires an isolated CI Docker-in-Docker daemon}"
runner="bucketreef-bundle-smoke-$CI_JOB_ID"
cleanup() {
  docker exec "$runner" sh -c 'cd /bundle && export BUCKETREEF_TAG=$(cat VERSION) && docker compose --project-name bucketreef-quickstart --env-file .env.quickstart down --volumes' >/dev/null 2>&1 || true
  docker exec "$runner" sh -c 'cd /compose && docker compose --project-name bucketreef-compose-smoke --profile operations down --volumes' >/dev/null 2>&1 || true
  docker rm --force "$runner" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Host networking puts the CLI and health requests in the isolated DinD host.
# The bundle is copied via Docker; no checkout is mounted into the test runtime.
docker run --detach --name "$runner" --network host \
  --env DOCKER_HOST=tcp://127.0.0.1:2375 \
  --env DOCKER_DEFAULT_PLATFORM="linux/$IMAGE_ARCH" \
  "$DOCKER_CLI_IMAGE" sleep 600
docker cp public-bundles/bucketreef-quickstart.tar.gz "$runner:/tmp/bundle.tar.gz"
docker cp public-bundles/bucketreef-compose.tar.gz "$runner:/tmp/compose.tar.gz"
docker exec "$runner" sh -ec '
  apk add --no-cache bash curl openssl
  mkdir /bundle
  tar -xzf /tmp/bundle.tar.gz -C /bundle
  cd /bundle
  ./bucketreef-quickstart start >/tmp/first-start.log
  grep -q "/setup/first-admin#token=" /tmp/first-start.log
  cp .env.quickstart /tmp/initial-env
  ./bucketreef-quickstart version
  ./bucketreef-quickstart status
  ./bucketreef-quickstart stop
  ./bucketreef-quickstart start >/tmp/restart.log
  cmp .env.quickstart /tmp/initial-env
  curl -fsS http://127.0.0.1:8000/health >/dev/null
  curl -fsS http://127.0.0.1:8080/setup/first-admin >/dev/null
  ./bucketreef-quickstart stop
  mkdir /compose
  tar -xzf /tmp/compose.tar.gz -C /compose
  cp .env.quickstart /compose/.env
  cd /compose
  export BUCKETREEF_TAG=$(cat VERSION)
  docker compose --project-name bucketreef-compose-smoke --profile operations up --detach --wait --wait-timeout 180
  test "$(docker compose --project-name bucketreef-compose-smoke --profile operations ps --status running --services | wc -l | tr -d " ")" = 3
  docker compose --project-name bucketreef-compose-smoke --profile operations exec -T scheduler id -u | grep -qx 10001
  curl -fsS http://127.0.0.1:8000/health >/dev/null
'
