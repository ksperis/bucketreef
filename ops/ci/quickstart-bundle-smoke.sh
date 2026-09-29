#!/bin/sh
set -eu
: "${IMAGE_ARCH:?}"
: "${CI_JOB_ID:?This smoke test requires an isolated CI Docker-in-Docker daemon}"
runner="bucketreef-bundle-smoke-$CI_JOB_ID"
health_retries=24
compose_wait_timeout=180
runner_lifetime=600
if [ "$IMAGE_ARCH" = "arm64" ]; then
  # QEMU on the amd64 release runner is substantially slower than native arm64.
  # Keep the published Compose health budget unchanged and relax only this
  # isolated smoke runtime so emulation can finish application imports/startup.
  health_retries=60
  compose_wait_timeout=600
  runner_lifetime=1800
fi
cleanup() {
  docker exec "$runner" sh -c 'cd /bundle && export BUCKETREEF_TAG=$(cat VERSION) && docker compose --project-name bucketreef-quickstart --env-file .env.quickstart --profile operations down --volumes' >/dev/null 2>&1 || true
  docker exec "$runner" sh -c 'cd /compose && docker compose --project-name bucketreef-compose-smoke --profile operations down --volumes' >/dev/null 2>&1 || true
  docker rm --force "$runner" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Host networking puts the CLI and health requests in the isolated DinD host.
# The bundle is copied via Docker; no checkout is mounted into the test runtime.
docker run --detach --name "$runner" --network host \
  --env DOCKER_HOST=tcp://127.0.0.1:2375 \
  --env DOCKER_DEFAULT_PLATFORM="linux/$IMAGE_ARCH" \
  "$DOCKER_CLI_IMAGE" sleep "$runner_lifetime"
docker cp public-bundles/bucketreef-quickstart.tar.gz "$runner:/tmp/bundle.tar.gz"
docker cp public-bundles/bucketreef-compose.tar.gz "$runner:/tmp/compose.tar.gz"
docker cp ops/ci/quickstart-healthcheck-smoke.py "$runner:/tmp/healthcheck-smoke.py"
docker exec \
  --env SMOKE_HEALTH_RETRIES="$health_retries" \
  --env SMOKE_COMPOSE_WAIT_TIMEOUT="$compose_wait_timeout" \
  "$runner" sh -ec '
  apk add --no-cache bash curl openssl
  mkdir /bundle
  tar -xzf /tmp/bundle.tar.gz -C /bundle
  cd /bundle
  if [ "$SMOKE_HEALTH_RETRIES" != "24" ]; then
    sed -i "s/retries: 24/retries: $SMOKE_HEALTH_RETRIES/g" docker-compose.yml
  fi
  export HEALTHCHECK_CRON_SCHEDULE="* * * * *"
  ./bucketreef-quickstart start >/tmp/first-start.log
  grep -q "/setup/first-admin#token=" /tmp/first-start.log
  cp .env.quickstart /tmp/initial-env
  ./bucketreef-quickstart version
  ./bucketreef-quickstart status
  export BUCKETREEF_TAG=$(cat VERSION)
  quickstart_compose() {
    docker compose --project-name bucketreef-quickstart --env-file .env.quickstart --profile operations "$@"
  }
  test "$(quickstart_compose ps --status running --services | wc -l | tr -d " ")" = 3
  quickstart_compose exec -T scheduler id -u | grep -qx 10001
  quickstart_compose exec -T backend python - seed </tmp/healthcheck-smoke.py
  attempts=0
  until quickstart_compose exec -T backend python - check </tmp/healthcheck-smoke.py; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 45 ]; then
      ./bucketreef-quickstart logs
      echo "Scheduled healthcheck did not persist an UP status" >&2
      exit 1
    fi
    sleep 2
  done
  ./bucketreef-quickstart stop
  ./bucketreef-quickstart start >/tmp/restart.log
  test "$(quickstart_compose ps --status running --services | wc -l | tr -d " ")" = 3
  cmp .env.quickstart /tmp/initial-env
  curl -fsS http://127.0.0.1:8000/health >/dev/null
  curl -fsS http://127.0.0.1:8080/setup/first-admin >/dev/null
  ./bucketreef-quickstart stop
  mkdir /compose
  tar -xzf /tmp/compose.tar.gz -C /compose
  cp .env.quickstart /compose/.env
  cd /compose
  if [ "$SMOKE_HEALTH_RETRIES" != "24" ]; then
    sed -i "s/retries: 24/retries: $SMOKE_HEALTH_RETRIES/g" docker-compose.yml
  fi
  export BUCKETREEF_TAG=$(cat VERSION)
  docker compose --project-name bucketreef-compose-smoke --profile operations up --detach --wait --wait-timeout "$SMOKE_COMPOSE_WAIT_TIMEOUT"
  test "$(docker compose --project-name bucketreef-compose-smoke --profile operations ps --status running --services | wc -l | tr -d " ")" = 3
  docker compose --project-name bucketreef-compose-smoke --profile operations exec -T scheduler id -u | grep -qx 10001
  curl -fsS http://127.0.0.1:8000/health >/dev/null
'
