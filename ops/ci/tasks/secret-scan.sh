#!/bin/sh
set -eu
temporary=$(mktemp -d)
trap 'rm -rf "$temporary" gl-secret-detection-report.json' EXIT
SECRET_DETECTION_LOG_OPTIONS=$(python3 -c 'import json; p=json.load(open("ci-plan.json")); print((p["base_sha"]+".."+p["sha"]) if p.get("base_sha") else "--all")')
export SECRET_DETECTION_LOG_OPTIONS
export SECRET_DETECTION_HISTORIC_SCAN=true
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
