#!/bin/sh
set -eu
prefix=${1:-/usr/local/bin}
actionlint=$(python3 ops/ci/toolchain.py actionlint)
shellcheck=$(python3 ops/ci/toolchain.py shellcheck)
test "$shellcheck" = 0.11.0
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_amd64; shell_platform=linux.x86_64; checksum=b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6 ;;
  Linux-aarch64) platform=linux_arm64; shell_platform=linux.aarch64; checksum=68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc ;;
  *) echo 'Unsupported CI lint platform' >&2; exit 1 ;;
esac
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
archive="actionlint_${actionlint}_${platform}.tar.gz"
base="https://github.com/rhysd/actionlint/releases/download/v$actionlint"
curl -fsSL "$base/$archive" -o "$temporary/$archive"
curl -fsSL "$base/actionlint_${actionlint}_checksums.txt" -o "$temporary/checksums"
(cd "$temporary" && grep "  $archive\$" checksums | sha256sum -c -)
tar -xzf "$temporary/$archive" -C "$temporary" actionlint
curl -fsSL "https://github.com/koalaman/shellcheck/releases/download/v$shellcheck/shellcheck-v$shellcheck.$shell_platform.tar.gz" -o "$temporary/shellcheck.tar.gz"
printf '%s  %s\n' "$checksum" "$temporary/shellcheck.tar.gz" | sha256sum -c
tar -xzf "$temporary/shellcheck.tar.gz" -C "$temporary"
mkdir -p "$prefix"
install -m 0755 "$temporary/actionlint" "$temporary/shellcheck-v$shellcheck/shellcheck" "$prefix/"
