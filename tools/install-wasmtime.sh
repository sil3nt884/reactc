#!/bin/sh
# Wasmtime used by the Windows launcher and the Android AOT packager.
set -eu
tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
version=v50.0.1
case "${1:-}" in
    windows) platform=windows; format=zip; exe=wasmtime.exe
        digest=c3646ee2de8cfcefe532e75852e1fd2728d78c3fcc43251794803a698d1c30ca ;;
    linux) platform=linux; format=tar.xz; exe=wasmtime
        digest=685466455dd42a14774a86c36c8f2e45cbb9bd6d92a850139315df60a75498a5 ;;
    *) echo 'Usage: sh tools/install-wasmtime.sh windows|linux' >&2; exit 2 ;;
esac
target="$tools/wasmtime-pack-$platform"
[ -f "$target/$exe" ] && [ -f "$target/LICENSE" ] && exit 0
work=$(mktemp -d "$tools/.wasmtime-pack.XXXXXX")
trap 'rm -rf "$work"' EXIT
release="wasmtime-$version-x86_64-$platform"
archive="$release.$format"
curl -fsSL --retry 3 "https://github.com/bytecodealliance/wasmtime/releases/download/$version/$archive" -o "$work/$archive"
(cd "$work" && printf '%s  %s\n' "$digest" "$archive" | sha256sum --check)
if [ "$platform" = windows ]; then
    if command -v unzip >/dev/null 2>&1; then
        unzip -q "$work/$archive" -d "$work"
    else
        tar -xf "$work/$archive" -C "$work"
    fi
else
    tar -xJf "$work/$archive" -C "$work"
fi
mkdir -p "$target"
cp "$work/$release/$exe" "$work/$release/LICENSE" "$target/"
