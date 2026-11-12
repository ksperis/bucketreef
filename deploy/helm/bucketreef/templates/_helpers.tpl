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
{{- range $legacy := list "FEATURE_ADMIN_ENABLED" "FEATURE_CEPH_ADMIN_ENABLED" "FEATURE_STORAGE_OPS_ENABLED" "FEATURE_MANAGER_ENABLED" "FEATURE_PORTAL_ENABLED" "FEATURE_BROWSER_ENABLED" "FEATURE_OPENSTACK_ENABLED" "FEATURE_COST_ENABLED" "FEATURE_ENDPOINT_STATUS_ENABLED" "ENV_STORAGE_ENDPOINTS" "DEPLOYMENT_CONFIG" "RUNTIME_SURFACES" -}}
{{- if hasKey $env $legacy -}}
{{- fail (printf "%s must be migrated to runtimeSurfaces or deploymentConfiguration." $legacy) -}}
{{- end -}}
{{- end -}}
{{- if kindIs "slice" .Values.runtimeSurfaces -}}
{{- $surfaces := .Values.runtimeSurfaces -}}
{{- if ne (len $surfaces) (len (uniq $surfaces)) -}}{{- fail "runtimeSurfaces contains duplicates." -}}{{- end -}}
{{- range $surface := $surfaces -}}
{{- if not (has $surface (list "admin" "ceph_admin" "storage_ops" "manager" "portal" "browser")) -}}
{{- fail "runtimeSurfaces contains an unknown surface." -}}
{{- end -}}
{{- end -}}
{{- if and (eq $profile "admin") (not (or (eq (join "," (sortAlpha $surfaces)) "admin,ceph_admin,storage_ops") (eq (join "," (sortAlpha $surfaces)) "admin,storage_ops"))) -}}
{{- fail "The admin profile requires admin and storage_ops and permits ceph_admin." -}}
{{- end -}}
{{- if and (eq $profile "user") (not (eq (join "," (sortAlpha $surfaces)) "browser,manager,portal")) -}}
{{- fail "The user profile requires browser, manager and portal only." -}}
{{- end -}}
{{- $_ := set $env "RUNTIME_SURFACES" (toJson $surfaces) -}}
{{- else if not (kindIs "invalid" .Values.runtimeSurfaces) -}}
{{- fail "runtimeSurfaces must be a list." -}}
{{- end -}}
{{- $defaults := dict -}}
{{- if eq $profile "admin" -}}
{{- $defaults = dict "SCHEDULED_JOBS_ENABLED" "true" "WEBHOOK_WORKER_ENABLED" "true" -}}
{{- else if eq $profile "user" -}}
{{- $defaults = dict "SCHEDULED_JOBS_ENABLED" "false" "WEBHOOK_WORKER_ENABLED" "false" -}}
{{- end -}}
{{- range $key, $value := $defaults -}}
{{- if hasKey $env $key -}}
{{- fail (printf "%s is controlled by deploymentProfile=%s and must not be set in backend.env." $key $profile) -}}
{{- end -}}
{{- if not (hasKey $env $key) -}}{{- $_ := set $env $key $value -}}{{- end -}}
{{- end -}}
{{- $_ := set $env "DEPLOYMENT_PROFILE" $profile -}}
{{- range $key := list "SCHEDULED_JOBS_ENABLED" "WEBHOOK_WORKER_ENABLED" "BUCKET_MIGRATION_WORKER_ENABLED" -}}
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

{{- define "bucketreef.backendEgress" -}}
egress:
  - to:
      - namespaceSelector:
          {{- toYaml .Values.networkPolicy.dns.namespaceSelector | nindent 12 }}
        podSelector:
          {{- toYaml .Values.networkPolicy.dns.podSelector | nindent 12 }}
    ports:
      - { protocol: UDP, port: 53 }
      - { protocol: TCP, port: 53 }
  - to:
      - podSelector:
          matchLabels:
            app.kubernetes.io/instance: {{ .Release.Name }}
            app.kubernetes.io/component: postgresql
    ports:
      - protocol: TCP
        port: {{ .Values.postgresql.service.port }}
  {{- range .Values.networkPolicy.publicHttpsEgress }}
  - to:
      - ipBlock:
          cidr: {{ .cidr | quote }}
          {{- with .except }}
          except:
            {{- toYaml . | nindent 14 }}
          {{- end }}
    ports:
      - protocol: TCP
        port: 443
  {{- end }}
  {{- range .Values.networkPolicy.privateEgress }}
  - to:
      - ipBlock:
          cidr: {{ .cidr | quote }}
    ports:
      {{- toYaml .ports | nindent 8 }}
  {{- end }}
{{- end -}}
