#!/bin/sh
set -eu
docker compose version
for compose_file in compose.yaml deploy/bundle/compose.yaml; do
  rendered="$(BUCKETREEF_TAG=0.0.0 INTERNAL_CRON_TOKEN=test docker compose --file "$compose_file" config --format json)"
  test "$(printf '%s' "$rendered" | jq -r '.services.frontend.environment.CSP_CONNECT_SRC')" = "'self'"
  printf '%s' "$rendered" | jq -e '.services.backend.healthcheck.test and .services.frontend.healthcheck.test' >/dev/null
  printf '%s' "$rendered" | jq -e '.services.backend.read_only and .services.frontend.read_only and .services.scheduler.read_only' >/dev/null
  test "$(printf '%s' "$rendered" | jq -r '.services.frontend.ports[0].target')" = "8080"
  test "$(printf '%s' "$rendered" | jq -r '.services.scheduler.user')" = "10001:10001"
  test "$(printf '%s' "$rendered" | jq -r '.services.scheduler.profiles // empty')" = ""
  test "$(printf '%s' "$rendered" | jq -r '.services.backend.environment.DEPLOYMENT_PROFILE')" = "full"

  compose_dir="$(dirname "$compose_file")"
  admin_override="$compose_dir/compose.admin.yaml"
  user_override="$compose_dir/compose.user.yaml"
  rendered_admin="$(BUCKETREEF_TAG=0.0.0 INTERNAL_CRON_TOKEN=test docker compose --file "$compose_file" --file "$admin_override" config --format json)"
  rendered_admin_no_ceph="$(BUCKETREEF_TAG=0.0.0 INTERNAL_CRON_TOKEN=test RUNTIME_SURFACES='["admin","storage_ops"]' docker compose --file "$compose_file" --file "$admin_override" config --format json)"
  rendered_user="$(BUCKETREEF_TAG=0.0.0 INTERNAL_CRON_TOKEN=test docker compose --file "$compose_file" --file "$user_override" config --format json)"
  test "$(printf '%s' "$rendered_admin" | jq -r '.services.backend.environment.DEPLOYMENT_PROFILE')" = "admin"
  test "$(printf '%s' "$rendered_admin" | jq -r '.services.backend.environment.SCHEDULED_JOBS_ENABLED')" = "true"
  test "$(printf '%s' "$rendered_admin" | jq -r '.services.backend.environment.WEBHOOK_WORKER_ENABLED')" = "true"
  test "$(printf '%s' "$rendered_admin_no_ceph" | jq -r '.services.backend.environment.DEPLOYMENT_PROFILE')" = "admin"
  test "$(printf '%s' "$rendered_admin_no_ceph" | jq -r '.services.backend.environment.SCHEDULED_JOBS_ENABLED')" = "true"
  test "$(printf '%s' "$rendered_admin_no_ceph" | jq -r '.services.backend.environment.WEBHOOK_WORKER_ENABLED')" = "true"
  test "$(printf '%s' "$rendered_user" | jq -r '.services.backend.environment.DEPLOYMENT_PROFILE')" = "user"
  test "$(printf '%s' "$rendered_user" | jq -r '.services.backend.environment.SCHEDULED_JOBS_ENABLED')" = "false"
  test "$(printf '%s' "$rendered_user" | jq -r '.services.backend.environment.WEBHOOK_WORKER_ENABLED')" = "false"
  printf '%s' "$rendered_admin_no_ceph" | jq -e '.services.backend.environment.RUNTIME_SURFACES | fromjson == ["admin","storage_ops"]' >/dev/null
  rendered_ceph_only="$(BUCKETREEF_TAG=0.0.0 DEPLOYMENT_PROFILE=full RUNTIME_SURFACES='["ceph_admin"]' SCHEDULED_JOBS_ENABLED=false WEBHOOK_WORKER_ENABLED=false BUCKET_MIGRATION_WORKER_ENABLED=false docker compose --file "$compose_file" config --format json)"
  printf '%s' "$rendered_ceph_only" | jq -e '.services.backend.environment | .DEPLOYMENT_PROFILE == "full" and (.RUNTIME_SURFACES | fromjson == ["ceph_admin"]) and .SCHEDULED_JOBS_ENABLED == "false" and .WEBHOOK_WORKER_ENABLED == "false" and .BUCKET_MIGRATION_WORKER_ENABLED == "false"' >/dev/null
  provision="$(BUCKETREEF_TAG=0.0.0 DEPLOYMENT_CONFIG='{"schema_version":1,"revision":1,"storage_endpoints":[]}' docker compose --file "$compose_file" --profile provision config --format json)"
  printf '%s' "$provision" | jq -e '
    .services["configure-deployment"] as $job | .services.backend as $backend |
    ($job.environment.DEPLOYMENT_CONFIG | fromjson | .revision == 1) and
    ($job.environment.DATABASE_URL == $backend.environment.DATABASE_URL) and
    ($job.volumes | any(.target == "/data" and .type == "volume")) and
    ($job.volumes | any(.target == "/deployment/credentials" and .type == "bind" and .read_only == true)) and
    ($job.read_only == true) and
    ($backend.environment | has("DEPLOYMENT_CONFIG") or has("ENV_STORAGE_ENDPOINTS") | not)
  ' >/dev/null
done
