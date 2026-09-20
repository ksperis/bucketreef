#!/bin/sh
set -eu
if [ "$1" = backend-postgresql-tests ]; then export DATABASE_URL="$POSTGRES_TEST_DATABASE_URL"; fi
case "$1" in
  secret-scan)
    SECRET_ANALYZER_IMAGE=$(python3 ops/ci/toolchain.py image registry.gitlab.com/security-products/secrets:7)
    export SECRET_ANALYZER_IMAGE
    sh ops/ci/tasks/secret-scan.sh ;;
  backend-vuln-scan|frontend-vuln-scan)
    # The public runner has no private registry credentials.
    docker run --rm --volume "$PWD:/work" --workdir /work \
      --entrypoint sh "$(python3 ops/ci/toolchain.py image aquasec/trivy:0.69.3)" ops/ci/tasks/run.sh "$1" ;;
  *) sh ops/ci/tasks/run.sh "$1" ;;
esac
