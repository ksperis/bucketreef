#!/bin/sh
set -eu
: "${IMAGE_ARCH:?}"
: "${SMOKE_MODE:?Expected quickstart or compose}"
: "${CI_JOB_ID:?This smoke test requires an isolated CI Docker-in-Docker daemon}"
case "$SMOKE_MODE" in quickstart|compose) ;; *) echo "Invalid SMOKE_MODE" >&2; exit 2 ;; esac
key="${SMOKE_MODE}-${IMAGE_ARCH}"
runner="bucketreef-${SMOKE_MODE}-smoke-$CI_JOB_ID"
health_retries=24
compose_wait_timeout=180
if [ "$IMAGE_ARCH" = "arm64" ]; then
  health_retries=60
  compose_wait_timeout=600
fi
cleanup() {
  status=$?
  trap - EXIT
  python3 ops/ci/installation_evidence.py diagnostics "$key" || true
  mkdir -p "smoke-diagnostics/$key"
  docker cp "$runner:/tmp/timings.tsv" "smoke-diagnostics/$key/timings.tsv" >/dev/null 2>&1 || true
  if [ "$SMOKE_MODE" = quickstart ]; then
    docker exec "$runner" sh -c 'cd /bundle && docker compose --project-name bucketreef --env-file .env --file compose.yaml down --volumes' >/dev/null 2>&1 || true
  else
    docker exec "$runner" sh -c 'cd /bundle && docker compose --project-name bucketreef-compose-smoke --env-file .env --file compose.yaml down --volumes' >/dev/null 2>&1 || true
  fi
  docker rm --force "$runner" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 124' TERM INT
python3 ops/ci/installation_evidence.py preload

docker run --detach --name "$runner" --network host \
  --env DOCKER_HOST=tcp://127.0.0.1:2375 \
  --env DOCKER_DEFAULT_PLATFORM="linux/$IMAGE_ARCH" \
  "$DOCKER_CLI_IMAGE" tail -f /dev/null
docker cp public-candidate/bucketreef-deploy.tar.gz "$runner:/tmp/bundle.tar.gz"
docker cp ops/ci/deploy-healthcheck-smoke.py "$runner:/tmp/healthcheck-smoke.py"
docker cp ops/ci/installation_evidence.py "$runner:/tmp/installation-evidence.py"
docker cp "installation-images/$IMAGE_ARCH.json" "$runner:/tmp/expected-images.json"
docker exec \
  --env SMOKE_MODE="$SMOKE_MODE" \
  --env SMOKE_HEALTH_RETRIES="$health_retries" \
  --env SMOKE_COMPOSE_WAIT_TIMEOUT="$compose_wait_timeout" \
  "$runner" sh -ec '
  apk add --no-cache bash curl openssl python3
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
  export HEALTHCHECK_CRON_SCHEDULE="* * * * *"

  wait_for_scheduled_healthcheck() {
    project=$1
    deadline=$(($(date +%s) + SMOKE_COMPOSE_WAIT_TIMEOUT))
    until docker compose --project-name "$project" --env-file .env --file compose.yaml exec -T backend python - check </tmp/healthcheck-smoke.py; do
      if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "Scheduled healthcheck did not persist an UP status" >&2
        exit 1
      fi
      sleep 2
    done
  }

  if [ "$SMOKE_MODE" = quickstart ]; then
    export QUICKSTART_HEALTH_TIMEOUT_SECONDS="$SMOKE_COMPOSE_WAIT_TIMEOUT"
    ./bucketreef-quickstart start >/tmp/first-start.log
    mark quickstart-start
    python3 /tmp/installation-evidence.py verify-compose bucketreef first-start
    grep -q "/setup/first-admin#token=" /tmp/first-start.log
    cp .env /tmp/initial-env
    ./bucketreef-quickstart version
    ./bucketreef-quickstart status
    test "$(docker compose --project-name bucketreef --env-file .env --file compose.yaml ps --status running --services | wc -l | tr -d " ")" = 3
    docker compose --project-name bucketreef --env-file .env --file compose.yaml exec -T scheduler id -u | grep -qx 10001
    docker compose --project-name bucketreef --env-file .env --file compose.yaml exec -T backend python - seed </tmp/healthcheck-smoke.py
    wait_for_scheduled_healthcheck bucketreef
    ./bucketreef-quickstart stop
    ./bucketreef-quickstart start >/tmp/restart.log
    mark quickstart-restart
    python3 /tmp/installation-evidence.py verify-compose bucketreef restart
    cmp .env /tmp/initial-env
    wait_for_scheduled_healthcheck bucketreef
    curl -fsS http://127.0.0.1:8000/health >/dev/null
    curl -fsS http://127.0.0.1:8080/setup/first-admin >/dev/null
    ./bucketreef-quickstart stop
  else
    cp .env.example .env
    chmod 0600 .env
    ui=$(openssl rand -hex 48)
    api=$(openssl rand -hex 48)
    credential=$(openssl rand -hex 48)
    cron=$(openssl rand -hex 48)
    sed -i "s/replace-with-a-random-secret/$ui/; s/replace-with-a-different-random-secret/$api/; s/replace-with-another-random-secret/$credential/; s/replace-with-a-fourth-random-secret/$cron/" .env
    docker compose --project-name bucketreef-compose-smoke --env-file .env --file compose.yaml up --detach --wait --wait-timeout "$SMOKE_COMPOSE_WAIT_TIMEOUT"
    mark compose-start
    python3 /tmp/installation-evidence.py verify-compose bucketreef-compose-smoke compose
    test "$(docker compose --project-name bucketreef-compose-smoke --env-file .env --file compose.yaml ps --status running --services | wc -l | tr -d " ")" = 3
    docker compose --project-name bucketreef-compose-smoke --env-file .env --file compose.yaml exec -T scheduler id -u | grep -qx 10001
    docker compose --project-name bucketreef-compose-smoke --env-file .env --file compose.yaml exec -T backend python -m app.scripts.issue_first_admin_bootstrap >/tmp/compose-bootstrap.log
    grep -q "/setup/first-admin#token=" /tmp/compose-bootstrap.log
    docker compose --project-name bucketreef-compose-smoke --env-file .env --file compose.yaml exec -T backend python - seed </tmp/healthcheck-smoke.py
    wait_for_scheduled_healthcheck bucketreef-compose-smoke
    docker compose --project-name bucketreef-compose-smoke --env-file .env --file compose.yaml stop
    docker compose --project-name bucketreef-compose-smoke --env-file .env --file compose.yaml up --detach --wait --wait-timeout "$SMOKE_COMPOSE_WAIT_TIMEOUT"
    mark compose-restart
    python3 /tmp/installation-evidence.py verify-compose bucketreef-compose-smoke compose-restart
    wait_for_scheduled_healthcheck bucketreef-compose-smoke
    curl -fsS http://127.0.0.1:8000/health >/dev/null
    curl -fsS http://127.0.0.1:8080/setup/first-admin >/dev/null
  fi
'
mkdir -p "smoke-diagnostics/$key"
docker cp "$runner:/tmp/installation-checkpoints.json" "smoke-diagnostics/$key/checkpoints.json"
python3 ops/ci/installation_evidence.py complete "$key"
