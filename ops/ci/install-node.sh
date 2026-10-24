#!/bin/sh
# The Playwright browser image embeds a different Node major. Replace only Node.
set -eu
version=$(python3 ops/ci/toolchain.py node)
test "$version" = 24.22.1
case "$(uname -m)" in
  x86_64) arch=x64; checksum=eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c ;;
  aarch64) arch=arm64; checksum=33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3 ;;
  *) exit 1 ;;
esac
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
curl -fsSL "https://nodejs.org/dist/v$version/node-v$version-linux-$arch.tar.gz" -o "$temporary/node.tar.gz"
printf '%s  %s\n' "$checksum" "$temporary/node.tar.gz" | sha256sum -c
tar -xzf "$temporary/node.tar.gz" -C /usr/local --strip-components=1
node --version
