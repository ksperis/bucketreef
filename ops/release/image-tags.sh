#!/bin/sh
# Resolve aliases at the time of publication, including retries of older jobs.
set -eu
version=${1:?Version required}
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
minor=${version%.*}
refs=$(git ls-remote --tags --refs "$CI_REPOSITORY_URL" 'v[0-9]*.[0-9]*.[0-9]*')
versions=$(printf '%s\n' "$refs" | awk '{print $2}' | sed 's#refs/tags/v##' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' || true)
versions=$(printf '%s\n%s\n' "$versions" "$version" | sort -V | uniq)
highest=$(printf '%s\n' "$versions" | tail -n 1)
highest_minor=$(printf '%s\n' "$versions" | awk -v minor="$minor" 'index($0, minor ".") == 1 { print }' | tail -n 1)
tags=$version
if [ "$version" = "$highest_minor" ]; then tags="$tags,$minor"; fi
if [ "$version" = "$highest" ]; then tags="$tags,latest"; fi
printf '%s\n' "$tags"
