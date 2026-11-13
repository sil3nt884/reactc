#!/bin/sh
set -eu

tool_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cxx_flags=""
case "${1:-}" in
  '') cxx="${CXX:-c++}"; output="$tool_dir/ada" ;;
  --windows) cxx="${WINDOWS_CXX:-x86_64-w64-mingw32-g++}"; output="$tool_dir/ada-win" ;;
  --wasi)
    cxx="$tool_dir/wasi-sdk/bin/clang++"
    output="$tool_dir/ada-wasi"
    cxx_flags="--target=wasm32-wasip1 -fno-exceptions -fno-rtti"
    [ -x "$cxx" ] || { echo 'Run sh tools/install-wasm.sh first.' >&2; exit 1; }
    ;;
  *) echo 'Usage: sh tools/install-ada.sh [--windows|--wasi]' >&2; exit 2 ;;
esac
download_dir="$(mktemp -d)"
trap 'rm -rf "$download_dir"' EXIT
curl --fail --location --retry 3 \
  https://github.com/ada-url/ada/releases/download/v4.0.0/singleheader.zip \
  --output "$download_dir/singleheader.zip"
curl --fail --location --retry 3 \
  https://raw.githubusercontent.com/ada-url/ada/v4.0.0/LICENSE-MIT \
  --output "$download_dir/LICENSE-MIT"
(
  cd "$download_dir"
  printf '%s  %s\n' \
    'd7fa5aea7b3805c91111231d1aaaeefc39ae20562a9f599e13c22471ee576b9f' singleheader.zip \
    'af0d7d2cef91fc243cf4ad98570b03d1f26f5e0227cad0f5f4a7376e2feb3160' LICENSE-MIT | sha256sum --check
  python3 -m zipfile -e singleheader.zip .
  "$cxx" $cxx_flags -std=c++20 -O2 -c ada.cpp -o ada.o
)
mkdir -p "$output"
cp "$download_dir/ada_c.h" "$download_dir/ada.o" "$download_dir/LICENSE-MIT" "$output/"
