#!/bin/sh
set -eu
case "$1" in
  backend-tests|backend-postgresql-tests|backend-deadcode) python3 -m pip install -r backend/requirements-test.txt ;;
  ci-contract) python3 -m pip install -r ops/ci/requirements.txt; sudo sh ops/ci/install-linters.sh ;;
  docs-build) python3 -m pip install -r doc/requirements.txt ;;
  frontend-quality|frontend-tests) npm ci --prefix frontend --no-audit --no-fund ;;
  frontend-browser-e2e)
    python3 -m pip install -r backend/requirements-browser-e2e.txt
    npm ci --prefix frontend --no-audit --no-fund
    python3 ops/ci/toolchain.py check-node
    cd frontend; npx playwright install --with-deps chromium ;;
  helm-contract) sudo sh ops/ci/install-helm.sh ;;
esac
