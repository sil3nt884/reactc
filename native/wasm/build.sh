#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
platform="${1:-linux}"
case "$platform" in
  linux)
    target=x86_64-linux
    digest=e2c0c26e1aef52f82f0b9918ad6f34cc30f4b557aee3e261cb127a9462be8f4d
    cc="${CC:-cc}"
    platform_libs=""
    ;;
  android)
    target=aarch64-android
    digest=611b6cd99939767684f48bd4cf3db559db4fde4992c949057be1e815ec2a9e70
    if [ -z "${CC:-}" ]; then
      : "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to the Android NDK (or set CC to its arm64 API 26 compiler)}"
    fi
    cc="${CC:-$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang}"
    platform_libs="-llog -Wl,-z,max-page-size=16384"
    ;;
  *) echo "usage: sh native/wasm/build.sh [linux|android]" >&2; exit 2 ;;
esac

version=v50.0.1
sdk="${WASMTIME_C_API:-$root/tools/wasmtime-c-$platform}"
if [ ! -f "$sdk/lib/libwasmtime.a" ]; then
  if [ -n "${WASMTIME_C_API:-}" ]; then
    echo "Cannot find lib/libwasmtime.a under WASMTIME_C_API" >&2
    exit 1
  fi
  mkdir -p "$root/tools"
  work="$(mktemp -d "$root/tools/.wasmtime-c.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  asset="wasmtime-$version-$target-c-api.tar.xz"
  curl -fsSL --retry 3 "https://github.com/bytecodealliance/wasmtime/releases/download/$version/$asset" -o "$work/$asset"
  printf '%s  %s\n' "$digest" "$work/$asset" | sha256sum --check
  mkdir "$work/sdk"
  tar -xJf "$work/$asset" --strip-components=1 -C "$work/sdk"
  mv -T "$work/sdk" "$sdk"
fi

out="$root/dist/wasm-runtime/$platform"
mkdir -p "$out"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I "$sdk/include" "$root/native/wasm/main.c" \
  "$sdk/lib/libwasmtime.a" -ldl -lm -pthread $platform_libs -o "$out/reactc-runtime"
cp "$sdk/LICENSE" "$out/Wasmtime-LICENSE"
printf '%s\n' "$out/reactc-runtime"
