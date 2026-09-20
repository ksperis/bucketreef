#!/bin/sh
# Shared validation entry point; installation belongs to the platform adapters.
set -eu
cd "$(dirname "$0")/../../.."
mkdir -p gl-test-reports gl-security-reports
# Never allow developer/provider configuration to bleed into autonomous tests.
for variable in $(env | cut -d= -f1 | grep -E '^(OIDC|LDAP)_PROVIDERS__' || true); do unset "$variable"; done
export OIDC_PROVIDERS='{}' LDAP_PROVIDERS='{}' APP_ENV=test
case "${1:?Validation name required}" in
  project-naming) python3 backend/scripts/check_project_naming.py ;;
  ci-contract) python3 -m pytest ops/ci/tests -q; sh ops/ci/tasks/lint.sh ;;
  backend-tests)
    version=$(python3 -c 'import json; print(json.load(open("frontend/package.json"))["version"])')
    python3 ops/release/check_version.py "$version"
    python3 ops/release/schema_baseline.py "$version" --check
    cd backend
    PYTHONPATH=. python3 -m pytest tests -q --junit-xml=../gl-test-reports/backend-junit.xml ;;
  backend-postgresql-tests)
    cd backend
    python3 -m alembic upgrade head
    PYTHONPATH=. python3 -m pytest tests_postgresql -q --junit-xml=../gl-test-reports/backend-postgresql-junit.xml ;;
  backend-deadcode) cd backend; python3 scripts/check_vulture.py ;;
  frontend-quality) cd frontend; npm audit --omit=dev --audit-level=high; npm run check:ci ;;
  frontend-tests) cd frontend; npm run test:ci ;;
  frontend-browser-e2e)
    export E2E_START_MOTO=true E2E_S3_ENDPOINT=http://127.0.0.1:5000
    export E2E_S3_ACCESS_KEY=minio E2E_S3_SECRET_KEY=minio123 S3_IGNORE_SUBDOMAIN_BUCKETNAME=true
    cd frontend; CI=1 npm run test:e2e:ci ;;
  docs-build) python3 -m mkdocs build -f doc/mkdocs.yml --strict ;;
  docs-screenshots) node frontend/scripts/docs-screenshots/check.mjs ;;
  helm-contract|compose-contract|scheduler-contract) sh "ops/ci/tasks/$1.sh" ;;
  backend-vuln-scan) sh ops/ci/tasks/dependency-scan.sh backend ;;
  frontend-vuln-scan) sh ops/ci/tasks/dependency-scan.sh frontend ;;
  *) echo "Unknown validation: $1" >&2; exit 1 ;;
esac
