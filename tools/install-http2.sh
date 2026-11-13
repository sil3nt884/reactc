#!/bin/sh
# Build the HTTP/2 protocol library for both native targets.
set -eu

tool_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Git Bash on Windows (the WSL-free setup): the native tools take Windows paths.
if command -v cygpath >/dev/null 2>&1; then
  work=$(cygpath -m "$work"); tool_dir=$(cygpath -m "$tool_dir")
fi
git init -q "$work/source"
git -C "$work/source" fetch --quiet --depth=1 https://github.com/nghttp2/nghttp2.git 85e300c79fb6dbcfa9c1013215c8710c1c2cd3d2
git -C "$work/source" checkout --quiet --detach FETCH_HEAD

build() {
  target=$1
  shift
  prefix="$tool_dir/http2-$target"
  cmake -G Ninja -S "$work/source" -B "$work/$target" \
    -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib \
    -DCMAKE_BUILD_TYPE=Release -DENABLE_LIB_ONLY=ON \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON -DBUILD_TESTING=OFF "$@"
  cmake --build "$work/$target" --parallel "${JOBS:-4}"
  cmake --install "$work/$target"
  cp "$work/source/COPYING" "$prefix/LICENSE.txt"
}

case "${1:-}" in
  '') build host -DCMAKE_C_COMPILER="${CC:-cc}" ;;
  --windows) build win -DCMAKE_SYSTEM_NAME=Windows \
      -DCMAKE_C_COMPILER="${WINDOWS_CC:-x86_64-w64-mingw32-gcc}" ;;
  *) echo "Usage: sh tools/install-http2.sh [--windows]" >&2; exit 2 ;;
esac
