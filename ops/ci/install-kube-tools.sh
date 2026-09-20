#!/bin/sh
set -eu
sh ops/ci/install-helm.sh
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) exit 1 ;; esac
version=$(python3 ops/ci/toolchain.py kind)
curl -fsSL "https://kind.sigs.k8s.io/dl/$version/kind-linux-$arch" -o "$temporary/kind"
curl -fsSL "https://kind.sigs.k8s.io/dl/$version/kind-linux-$arch.sha256sum" -o "$temporary/kind.sha256"
printf '%s  %s\n' "$(awk '{print $1}' "$temporary/kind.sha256")" "$temporary/kind" | sha256sum -c
version=$(python3 ops/ci/toolchain.py kubectl)
curl -fsSL "https://dl.k8s.io/release/$version/bin/linux/$arch/kubectl" -o "$temporary/kubectl"
curl -fsSL "https://dl.k8s.io/release/$version/bin/linux/$arch/kubectl.sha256" -o "$temporary/kubectl.sha256"
printf '%s  %s\n' "$(cat "$temporary/kubectl.sha256")" "$temporary/kubectl" | sha256sum -c
install -m 0755 "$temporary/kind" "$temporary/kubectl" /usr/local/bin/
