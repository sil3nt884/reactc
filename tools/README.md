# Pinned Porffor compiler

Run `sh tools/install-porffor.sh` from the project root. The installer only writes
inside this tools directory and temporary files; it does not edit shell profiles.

Validated compiler: **alpha-22**, commit **a081ebd**, released 2026-11-05.
Asset: `porffor-linux-x64.tar.gz` from the official GitHub release.
The checked-in SHA-256 is the digest observed when bootstrapping this project,
not a separately authenticated signature from the upstream author.

Upstream source/license: https://github.com/CanadaHonk/porffor/tree/alpha-22
License: MIT. The ignored binary/archive is local development tooling, not part
of this repository. Other host platforms require separately pinned assets and
validation. Android/Windows output is not established by this installer.

# The rest of tools/

`npm run setup` (which runs `sh scripts/ci/install-tools.sh`, inside WSL on
Windows) installs everything reactc's builds use, on
Ubuntu 26.04 (WSL, a Linux machine, or the `ubuntu:26.04` container CI uses).
Add `--system` as root to apt-get the prerequisites first (curl, git,
xz-utils, python3, perl, zip). Only curl, git, xz, python3 and perl are needed: cmake,
ninja and make come with the toolchain. It runs these, skipping what is already
present:

| Script | Installs |
| --- | --- |
| `install-toolchain.sh` | `tools/local`: GCC 15 and MinGW-w64 in a relocatable Ubuntu 26.04 sysroot, wrapper scripts, and Node 22 |
| `install-porffor.sh` | `tools/porf`, the pinned Porffor compiler |
| `install-ada.sh [--windows]` | the URL parser for Linux (`tools/ada`) and Windows (`tools/ada-win`) targets |
| `install-node-libs.sh [--windows]` | libuv, uSockets, zlib, Brotli, zstd and OpenSSL for Node APIs (`tools/node-host`, `tools/node-win`) |
| `install-http2.sh [--windows]` | pinned static nghttp2 for Linux (`tools/http2-host`) and Windows (`tools/http2-win`) |
| `install-skia-windows.sh` | `tools/skia-win`, the Skia library Windows UIs render with |

Executables built with `tools/local` need a glibc at least as new as Ubuntu
26.04's, and so does the WSL distribution that runs it on Windows.
