#!/bin/sh
set -eu

if [ "$(uname -s):$(uname -m)" != Linux:x86_64 ]; then
    echo 'The pinned WASI tools installer requires Linux x86-64 (WSL is supported).' >&2
    exit 1
fi

tool_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
staging="$(mktemp -d "$tool_dir/.wasm-tools.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

install_release() {
    name="$1"
    url="$2"
    digest="$3"
    if [ -e "$tool_dir/$name" ]; then
        echo "Using existing $tool_dir/$name"
        return
    fi
    curl --fail --location --retry 3 "$url" --output "$staging/archive"
    printf '%s  %s\n' "$digest" "$staging/archive" | sha256sum --check
    mkdir "$staging/$name"
    tar -xf "$staging/archive" --strip-components=1 -C "$staging/$name"
    mv -T "$staging/$name" "$tool_dir/$name"
    rm "$staging/archive"
}

install_release wasi-sdk \
    https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-30/wasi-sdk-30.0-x86_64-linux.tar.gz \
    0507679dff16814b74516cd969a9b16d2ced1347388024bc7966264648c78bfb
install_release wasmtime \
    https://github.com/bytecodealliance/wasmtime/releases/download/v43.0.0/wasmtime-v43.0.0-x86_64-linux.tar.xz \
    e75a4933253fbc7b027c670b699490f163e3c86784f1db66581ae80fc0eb652c
