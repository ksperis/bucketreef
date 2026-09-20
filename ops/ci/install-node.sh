#!/bin/sh
# The Playwright browser image embeds a different Node major. Replace only Node.
set -eu
version=$(python3 ops/ci/toolchain.py node)
test "$version" = 24.21.0
case "$(uname -m)" in
  x86_64) arch=x64; checksum=6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff ;;
  aarch64) arch=arm64; checksum=724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5 ;;
  *) exit 1 ;;
esac
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
curl -fsSL "https://nodejs.org/dist/v$version/node-v$version-linux-$arch.tar.gz" -o "$temporary/node.tar.gz"
printf '%s  %s\n' "$checksum" "$temporary/node.tar.gz" | sha256sum -c
tar -xzf "$temporary/node.tar.gz" -C /usr/local --strip-components=1
node --version
