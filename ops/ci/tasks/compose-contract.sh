#!/bin/sh
set -eu
docker compose version
for compose_file in docker-compose.yml deploy/compose/docker-compose.yml; do
  rendered="$(BUCKETREEF_TAG=0.0.0 INTERNAL_CRON_TOKEN=test docker compose --profile operations --file "$compose_file" config --format json)"
  test "$(printf '%s' "$rendered" | jq -r '.services.frontend.environment.CSP_CONNECT_SRC')" = "'self'"
  printf '%s' "$rendered" | jq -e '.services.backend.healthcheck.test and .services.frontend.healthcheck.test' >/dev/null
  printf '%s' "$rendered" | jq -e '.services.backend.read_only and .services.frontend.read_only and .services.scheduler.read_only' >/dev/null
  test "$(printf '%s' "$rendered" | jq -r '.services.frontend.ports[0].target')" = "8080"
  test "$(printf '%s' "$rendered" | jq -r '.services.scheduler.user')" = "10001:10001"
done
