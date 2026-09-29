#!/bin/sh
set -eu
: "${IMAGE_ARCH:?}"
: "${CI_JOB_ID:?This smoke test requires an isolated CI Docker-in-Docker daemon}"
runner="bucketreef-bundle-smoke-$CI_JOB_ID"
health_retries=24
compose_wait_timeout=180
if [ "$IMAGE_ARCH" = "arm64" ]; then
  # QEMU on the amd64 release runner is substantially slower than native arm64.
  # Keep the published Compose health budget unchanged and relax only this
  # isolated smoke runtime so emulation can finish application imports/startup.
  health_retries=60
  compose_wait_timeout=600
fi
cleanup() {
  status=$?
  trap - EXIT
  # Only allowlisted data leaves DinD; raw logs and generated env stay inside it.
  python3 ops/ci/installation_evidence.py diagnostics "$IMAGE_ARCH" || true
  mkdir -p "smoke-diagnostics/$IMAGE_ARCH"
  docker cp "$runner:/tmp/timings.tsv" "smoke-diagnostics/$IMAGE_ARCH/timings.tsv" >/dev/null 2>&1 || true
  docker exec "$runner" sh -c 'cd /bundle && export BUCKETREEF_TAG=$(cat VERSION) && docker compose --project-name bucketreef-quickstart --env-file .env.quickstart --profile operations down --volumes' >/dev/null 2>&1 || true
  docker exec "$runner" sh -c 'cd /compose && docker compose --project-name bucketreef-compose-smoke --profile operations down --volumes' >/dev/null 2>&1 || true
  docker rm --force "$runner" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 124' TERM INT
python3 ops/ci/installation_evidence.py preload
# Host networking puts the CLI and health requests in the isolated DinD host.
# The bundle is copied via Docker; no checkout is mounted into the test runtime.
docker run --detach --name "$runner" --network host \
  --env DOCKER_HOST=tcp://127.0.0.1:2375 \
  --env DOCKER_DEFAULT_PLATFORM="linux/$IMAGE_ARCH" \
  "$DOCKER_CLI_IMAGE" tail -f /dev/null
docker cp public-candidate/bucketreef-quickstart.tar.gz "$runner:/tmp/bundle.tar.gz"
docker cp public-candidate/bucketreef-compose.tar.gz "$runner:/tmp/compose.tar.gz"
docker cp ops/ci/quickstart-healthcheck-smoke.py "$runner:/tmp/healthcheck-smoke.py"
docker cp ops/ci/installation_evidence.py "$runner:/tmp/installation-evidence.py"
docker cp "installation-images/$IMAGE_ARCH.json" "$runner:/tmp/expected-images.json"
docker exec \
  --env SMOKE_HEALTH_RETRIES="$health_retries" \
  --env SMOKE_COMPOSE_WAIT_TIMEOUT="$compose_wait_timeout" \
  "$runner" sh -ec '
  apk add --no-cache bash curl openssl python3
  # All command output remains ephemeral, including bootstrap URLs on failures.
  exec >/tmp/smoke.log 2>&1
  phase_start=$(date +%s)
  mark() {
    now=$(date +%s)
    printf "%s\t%s\n" "$1" "$((now - phase_start))" >> /tmp/timings.tsv
    phase_start=$now
  }
  trap "mark exit" EXIT
  mkdir /bundle
  tar -xzf /tmp/bundle.tar.gz -C /bundle
  cd /bundle
  export BUCKETREEF_HEALTHCHECK_RETRIES="$SMOKE_HEALTH_RETRIES"
  export QUICKSTART_HEALTH_TIMEOUT_SECONDS="$SMOKE_COMPOSE_WAIT_TIMEOUT"
  export HEALTHCHECK_CRON_SCHEDULE="* * * * *"
  ./bucketreef-quickstart start >/tmp/first-start.log
  mark quickstart-start
  python3 /tmp/installation-evidence.py verify-compose bucketreef-quickstart first-start
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
  deadline=$(($(date +%s) + SMOKE_COMPOSE_WAIT_TIMEOUT))
  until quickstart_compose exec -T backend python - check </tmp/healthcheck-smoke.py; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "Scheduled healthcheck did not persist an UP status" >&2
      exit 1
    fi
    sleep 2
  done
  mark scheduler-check
  ./bucketreef-quickstart stop
  ./bucketreef-quickstart start >/tmp/restart.log
  mark quickstart-restart
  python3 /tmp/installation-evidence.py verify-compose bucketreef-quickstart restart
  test "$(quickstart_compose ps --status running --services | wc -l | tr -d " ")" = 3
  cmp .env.quickstart /tmp/initial-env
  curl -fsS http://127.0.0.1:8000/health >/dev/null
  curl -fsS http://127.0.0.1:8080/setup/first-admin >/dev/null
  ./bucketreef-quickstart stop
  mkdir /compose
  tar -xzf /tmp/compose.tar.gz -C /compose
  cp .env.quickstart /compose/.env
  cd /compose
  export BUCKETREEF_TAG=$(cat VERSION)
  docker compose --project-name bucketreef-compose-smoke --profile operations up --detach --wait --wait-timeout "$SMOKE_COMPOSE_WAIT_TIMEOUT"
  mark compose-start
  python3 /tmp/installation-evidence.py verify-compose bucketreef-compose-smoke compose
  test "$(docker compose --project-name bucketreef-compose-smoke --profile operations ps --status running --services | wc -l | tr -d " ")" = 3
  docker compose --project-name bucketreef-compose-smoke --profile operations exec -T scheduler id -u | grep -qx 10001
  curl -fsS http://127.0.0.1:8000/health >/dev/null
'
mkdir -p "smoke-diagnostics/$IMAGE_ARCH"
docker cp "$runner:/tmp/installation-checkpoints.json" "smoke-diagnostics/$IMAGE_ARCH/checkpoints.json"
python3 ops/ci/installation_evidence.py complete "$IMAGE_ARCH"
