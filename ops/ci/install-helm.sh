#!/bin/sh
set -eu
version=$(python3 ops/ci/toolchain.py helm)
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) exit 1 ;; esac
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
curl -fsSL "https://get.helm.sh/helm-v$version-linux-$arch.tar.gz" -o "$temporary/helm.tar.gz"
curl -fsSL "https://get.helm.sh/helm-v$version-linux-$arch.tar.gz.sha256sum" -o "$temporary/checksum"
printf '%s  %s\n' "$(cut -d ' ' -f1 "$temporary/checksum")" "$temporary/helm.tar.gz" | sha256sum -c
tar -xzf "$temporary/helm.tar.gz" -C "$temporary"
install "$temporary/linux-$arch/helm" /usr/local/bin/helm
