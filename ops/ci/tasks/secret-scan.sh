#!/bin/sh
set -eu
temporary=$(mktemp -d)
trap 'rm -rf "$temporary" gl-secret-detection-report.json' EXIT
scan_options=$(PYTHONPATH=ops/ci python3 -c 'import json; from plan import secret_scan_options; print(*secret_scan_options(json.load(open("ci-plan.json"))))')
SECRET_DETECTION_LOG_OPTIONS=${scan_options% *}
SECRET_DETECTION_HISTORIC_SCAN=${scan_options##* }
export SECRET_DETECTION_LOG_OPTIONS SECRET_DETECTION_HISTORIC_SCAN
# The same analyzer also runs outside GitLab on public hosted runners.
CI_COMMIT_SHA=$(python3 -c 'import json; print(json.load(open("ci-plan.json"))["sha"])')
CI_COMMIT_BRANCH=${CI_COMMIT_BRANCH:-public-validation}
export CI_COMMIT_SHA CI_COMMIT_BRANCH
# Analyzer output can include credentials. Only the redacted summary is emitted.
if [ -x /analyzer ]; then
  /analyzer run >"$temporary/analyzer.log" 2>&1 || { echo 'Secret analyzer failed (raw output withheld)'; exit 1; }
else
  : "${SECRET_ANALYZER_IMAGE:?}"
  docker run --rm --volume "$PWD:/repo" --workdir /repo \
    --env CI_PROJECT_DIR=/repo --env CI_COMMIT_SHA --env CI_COMMIT_BRANCH \
    --env CI_DEFAULT_BRANCH=main --env SECRET_DETECTION_HISTORIC_SCAN \
    --env SECRET_DETECTION_LOG_OPTIONS --entrypoint /analyzer "$SECRET_ANALYZER_IMAGE" run \
    >"$temporary/analyzer.log" 2>&1 || { echo 'Secret analyzer failed (raw output withheld)'; exit 1; }
fi
python3 ops/ci/secret_report.py
