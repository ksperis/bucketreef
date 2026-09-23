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

  compose_dir="$(dirname "$compose_file")"
  admin_override="$compose_dir/docker-compose.admin.yml"
  user_override="$compose_dir/docker-compose.user.yml"
  ceph_admin_override="$compose_dir/docker-compose.ceph-admin-high-security.yml"
  rendered_admin="$(BUCKETREEF_TAG=0.0.0 INTERNAL_CRON_TOKEN=test docker compose --profile operations --file "$compose_file" --file "$admin_override" config --format json)"
  rendered_user="$(BUCKETREEF_TAG=0.0.0 INTERNAL_CRON_TOKEN=test docker compose --profile operations --file "$compose_file" --file "$user_override" config --format json)"
  rendered_ceph_admin="$(BUCKETREEF_TAG=0.0.0 docker compose --file "$compose_file" --file "$ceph_admin_override" config --format json)"
  test "$(printf '%s' "$rendered_admin" | jq -r '.services.backend.environment.FEATURE_ADMIN_ENABLED')" = "true"
  test "$(printf '%s' "$rendered_admin" | jq -r '.services.backend.environment.FEATURE_MANAGER_ENABLED')" = "false"
  test "$(printf '%s' "$rendered_admin" | jq -r '.services.backend.environment.SCHEDULED_JOBS_ENABLED')" = "true"
  test "$(printf '%s' "$rendered_user" | jq -r '.services.backend.environment.FEATURE_ADMIN_ENABLED')" = "false"
  test "$(printf '%s' "$rendered_user" | jq -r '.services.backend.environment.FEATURE_MANAGER_ENABLED')" = "true"
  test "$(printf '%s' "$rendered_user" | jq -r '.services.backend.environment.SCHEDULED_JOBS_ENABLED')" = "false"
  test "$(printf '%s' "$rendered_ceph_admin" | jq -r '.services.backend.environment.CEPH_ADMIN_HIGH_SECURITY_MODE')" = "true"
  test "$(printf '%s' "$rendered_ceph_admin" | jq -r '.services.backend.environment.FEATURE_ADMIN_ENABLED')" = "false"
  test "$(printf '%s' "$rendered_ceph_admin" | jq -r '.services.backend.environment.FEATURE_CEPH_ADMIN_ENABLED')" = "true"
  test "$(printf '%s' "$rendered_ceph_admin" | jq -r '.services.backend.environment.FEATURE_MANAGER_ENABLED')" = "false"
  test "$(printf '%s' "$rendered_ceph_admin" | jq -r '.services.backend.environment.SCHEDULED_JOBS_ENABLED')" = "false"
done
