{{- define "bucketreef.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "bucketreef.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "bucketreef.labels" -}}
app.kubernetes.io/name: {{ include "bucketreef.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "bucketreef.deploymentProfile" -}}
{{- lower (default "full" .Values.deploymentProfile) -}}
{{- end -}}

{{/* One authoritative environment map avoids duplicate profile variables. */}}
{{- define "bucketreef.runtimeEnv" -}}
{{- $profile := include "bucketreef.deploymentProfile" . -}}
{{- if not (has $profile (list "full" "admin" "user")) -}}
{{- fail "deploymentProfile must be one of: full, admin, user." -}}
{{- end -}}
{{- $env := deepCopy .Values.backend.env -}}
{{- if hasKey $env "DEPLOYMENT_PROFILE" -}}
{{- fail "DEPLOYMENT_PROFILE is controlled by deploymentProfile and must not be set in backend.env." -}}
{{- end -}}
{{- $defaults := dict -}}
{{- if eq $profile "admin" -}}
{{- $defaults = dict "FEATURE_ADMIN_ENABLED" "true" "FEATURE_CEPH_ADMIN_ENABLED" "true" "FEATURE_STORAGE_OPS_ENABLED" "true" "FEATURE_MANAGER_ENABLED" "false" "FEATURE_PORTAL_ENABLED" "false" "FEATURE_BROWSER_ENABLED" "false" "SCHEDULED_JOBS_ENABLED" "true" "WEBHOOK_WORKER_ENABLED" "true" -}}
{{- else if eq $profile "user" -}}
{{- $defaults = dict "FEATURE_ADMIN_ENABLED" "false" "FEATURE_CEPH_ADMIN_ENABLED" "false" "FEATURE_STORAGE_OPS_ENABLED" "false" "FEATURE_MANAGER_ENABLED" "true" "FEATURE_PORTAL_ENABLED" "true" "FEATURE_BROWSER_ENABLED" "true" "SCHEDULED_JOBS_ENABLED" "false" "WEBHOOK_WORKER_ENABLED" "false" -}}
{{- end -}}
{{- range $key, $value := $defaults -}}
{{- if and (hasKey $env $key) (not (and (eq $profile "admin") (eq $key "FEATURE_CEPH_ADMIN_ENABLED"))) -}}
{{- fail (printf "%s is controlled by deploymentProfile=%s and must not be set in backend.env." $key $profile) -}}
{{- end -}}
{{- if not (hasKey $env $key) -}}{{- $_ := set $env $key $value -}}{{- end -}}
{{- end -}}
{{- $_ := set $env "DEPLOYMENT_PROFILE" $profile -}}
{{- range $key := list "FEATURE_ADMIN_ENABLED" "FEATURE_CEPH_ADMIN_ENABLED" "FEATURE_STORAGE_OPS_ENABLED" "FEATURE_MANAGER_ENABLED" "FEATURE_PORTAL_ENABLED" "FEATURE_BROWSER_ENABLED" "SCHEDULED_JOBS_ENABLED" "WEBHOOK_WORKER_ENABLED" "BUCKET_MIGRATION_WORKER_ENABLED" -}}
{{- if and (hasKey $env $key) (not (has (lower (toString (get $env $key))) (list "true" "false"))) -}}
{{- fail (printf "%s must be true or false." $key) -}}
{{- end -}}
{{- end -}}
{{- toYaml $env -}}
{{- end -}}

{{- define "bucketreef.scheduledJobsEnabled" -}}
{{- $env := include "bucketreef.runtimeEnv" . | fromYaml -}}
{{- if hasKey $env "SCHEDULED_JOBS_ENABLED" -}}
{{- lower (toString (get $env "SCHEDULED_JOBS_ENABLED")) -}}
{{- else -}}true{{- end -}}
{{- end -}}
