#!/bin/sh
# Installs everything reactc's builds use into tools/, on Ubuntu 26.04 (WSL on
# Windows, a Linux machine, or the CI container): the C toolchain (with cmake,
# ninja and make), Porffor, the URL and Node native libraries for Linux and
# Windows targets, and Skia for Windows UIs. Already-installed tools are kept.
#
#   sh scripts/ci/install-tools.sh            # needs curl, git, xz, python3, perl
#   sh scripts/ci/install-tools.sh --wasm     # also the WebAssembly target's tools (about 640 MB)
#   sh scripts/ci/install-tools.sh --system   # as root: apt-get those first (CI)
#
# Most people run `npm run setup` instead, which calls this (inside WSL on
# Windows).
set -eu
cd "$(dirname "$0")/../.."
system=''; wasm=''
for argument in "$@"; do
  case "$argument" in
    --system) system=1 ;;
    --wasm) wasm=1 ;;
    *) echo "unknown option: $argument" >&2; exit 2 ;;
  esac
done
if [ -n "$system" ]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git xz-utils python3 perl zip unzip file >/dev/null
fi

missing=''
for command in curl git xz python3 perl apt-get dpkg sha256sum; do
  command -v "$command" >/dev/null 2>&1 || missing="$missing $command"
done
if [ -n "$missing" ]; then
  echo "Missing:$missing" >&2
  echo "Install them with: sudo apt-get install -y curl git xz-utils python3 perl" >&2
  exit 1
fi
if [ ! -s /var/lib/apt/lists/lock ] && [ -z "$(ls /var/lib/apt/lists/*Packages* 2>/dev/null | head -1)" ]; then
  echo "The apt package lists are empty. Run: sudo apt-get update" >&2
  exit 1
fi

export PATH="$PWD/tools/local/bin:$PATH"
step() { echo; echo "== $*"; }
[ -x tools/local/bin/cc ] && [ -x tools/local/bin/cmake ] || { step "C toolchain (tools/local)"; sh tools/install-toolchain.sh; }
[ -x tools/porf ] || { step "Porffor (tools/porf)"; sh tools/install-porffor.sh; }
[ -d tools/ada ] || { step "URL parser for Linux (tools/ada)"; sh tools/install-ada.sh; }
[ -d tools/ada-win ] || { step "URL parser for Windows (tools/ada-win)"; sh tools/install-ada.sh --windows; }
[ -d tools/node-host ] || { step "Node native libraries for Linux (tools/node-host)"; sh tools/install-node-libs.sh; }
[ -d tools/node-win ] || { step "Node native libraries for Windows (tools/node-win)"; sh tools/install-node-libs.sh --windows; }
[ -d tools/skia-win ] || { step "Skia for Windows UIs (tools/skia-win)"; sh tools/install-skia-windows.sh; }
if [ -n "$wasm" ]; then
  [ -d tools/wasi-sdk ] && [ -d tools/wasmtime ] || { step "WASI SDK and Wasmtime (tools/wasi-sdk, tools/wasmtime)"; sh tools/install-wasm.sh; }
  [ -d tools/ada-wasi ] || { step "URL parser for WebAssembly (tools/ada-wasi)"; sh tools/install-ada.sh --wasi; }
  # the runtime that runs reactc --target wasm apps on Linux; it fetches the
  # Wasmtime C API into tools/wasmtime-c-linux (Android: see native/wasm/README.md)
  [ -d tools/wasmtime-c-linux ] || { step "WebAssembly runtime for Linux (native/wasm)"; sh native/wasm/build.sh linux; }
fi
echo
echo "tools ready: $(ls tools | tr '\n' ' ')"
