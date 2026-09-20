#!/bin/sh
set -eu
: "${1:?Image reference required}"
# Skopeo inspects the index, not just the runner's selected architecture.
skopeo inspect --raw --creds "$CI_REGISTRY_USER:$CI_REGISTRY_PASSWORD" "docker://$1" |
  jq -e '[.manifests[].platform | select(.os == "linux") | .architecture] | index("amd64") != null and index("arm64") != null' >/dev/null
