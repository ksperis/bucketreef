#!/bin/sh
set -eu
case "$1" in
  backend-tests|backend-postgresql-tests|backend-deadcode) python3 -m pip install -r backend/requirements-test.txt ;;
  ci-contract) python3 -m pip install -r ops/ci/requirements.txt ;;
  docs-build) python3 -m pip install -r doc/requirements.txt ;;
  frontend-quality|frontend-tests) npm ci --prefix frontend --no-audit --no-fund ;;
  frontend-browser-e2e)
    python3 -m pip install -r backend/requirements-browser-e2e.txt
    npm ci --prefix frontend --no-audit --no-fund
    cd frontend; npx playwright install --with-deps chromium ;;
  helm-contract)
    temporary=$(mktemp -d)
    trap 'rm -rf "$temporary"' EXIT
    curl -fsSL https://get.helm.sh/helm-v3.18.6-linux-amd64.tar.gz -o "$temporary/helm.tar.gz"
    curl -fsSL https://get.helm.sh/helm-v3.18.6-linux-amd64.tar.gz.sha256sum -o "$temporary/checksum"
    printf '%s  %s\n' "$(cut -d ' ' -f1 "$temporary/checksum")" "$temporary/helm.tar.gz" | sha256sum -c
    tar -xzf "$temporary/helm.tar.gz" -C "$temporary"
    sudo install "$temporary/linux-amd64/helm" /usr/local/bin/helm ;;
esac
