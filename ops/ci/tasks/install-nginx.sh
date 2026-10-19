#!/bin/sh
# Native Nginx is used only by the isolated worker/CSP regression fixture.
set -eu
if command -v nginx >/dev/null 2>&1; then exit 0; fi
if [ "$(id -u)" = 0 ]; then
  apt-get update
  apt-get install -y --no-install-recommends nginx
else
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends nginx
fi
