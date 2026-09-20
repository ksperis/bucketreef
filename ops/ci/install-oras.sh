#!/bin/sh
set -eu
version=1.3.0
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) exit 1 ;; esac
archive="oras_${version}_linux_${arch}.tar.gz"
base="https://github.com/oras-project/oras/releases/download/v$version"
curl --fail --silent --show-error --location "$base/$archive" -o "$temporary/$archive"
curl --fail --silent --show-error --location "$base/oras_${version}_checksums.txt" -o "$temporary/checksums"
(cd "$temporary" && grep "  $archive\$" checksums | sha256sum -c -)
tar -xzf "$temporary/$archive" -C "$temporary" oras
install -m 0755 "$temporary/oras" /usr/local/bin/oras
