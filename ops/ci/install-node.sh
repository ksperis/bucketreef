#!/bin/sh
# The Playwright browser image embeds a different Node major. Replace only Node.
set -eu
version=$(python3 ops/ci/toolchain.py node)
test "$version" = 24.22.1
case "$(uname -m)" in
  x86_64) arch=x64; checksum=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 ;;
  aarch64) arch=arm64; checksum=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e ;;
  *) exit 1 ;;
esac
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
curl -fsSL "https://nodejs.org/dist/v$version/node-v$version-linux-$arch.tar.gz" -o "$temporary/node.tar.gz"
printf '%s  %s\n' "$checksum" "$temporary/node.tar.gz" | sha256sum -c
tar -xzf "$temporary/node.tar.gz" -C /usr/local --strip-components=1
node --version
