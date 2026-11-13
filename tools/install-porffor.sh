#!/bin/sh
set -eu
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) ;;
  *) echo 'This bootstrap installer is validated only on Linux x64.' >&2; exit 1 ;;
esac
tool_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
download_dir="$(mktemp -d)"
trap 'rm -rf "$download_dir"' EXIT
curl --fail --location --retry 3 \
  https://github.com/CanadaHonk/porffor/releases/download/alpha-22/porffor-linux-x64.tar.gz \
  --output "$download_dir/compiler.tar.gz"
(
  cd "$download_dir"
  printf '%s  %s\n' '6bb23046ecc5dfddb6ba6d9136ba2e684519c1a02868f221609b60290cee4361' 'compiler.tar.gz' | sha256sum --check
)
tar -xzf "$download_dir/compiler.tar.gz" -C "$download_dir" porf
chmod +x "$download_dir/porf"
"$download_dir/porf" --version
mv "$download_dir/porf" "$tool_dir/porf"
