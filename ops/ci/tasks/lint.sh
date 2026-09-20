#!/bin/sh
set -eu
actionlint
shellcheck ops/ci/*.sh ops/ci/tasks/*.sh ops/release/*.sh
