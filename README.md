# reactc

reactc compiles React (TSX/JSX) user interfaces and Node servers into native
executables for Windows and Linux. It is built on
[Porffor](https://github.com/CanadaHonk/porffor): JavaScript becomes C, and C
becomes a native program. No JavaScript engine runs in what it produces.

- **UIs** become native windows rendered with Skia on Windows, or a protocol
  core on Linux.
- **Servers** (`node:http`, `fs`, `net`, `crypto`, `child_process`, `zlib`
  and more) become console executables.
- **Threads.** [`@reactc/threads`](packages/reactc-threads/README.md) gives you
  Java-style and functional threads on one shared heap. `run()` can be async,
  and threads can be awaited like promises.
- **Projects.** `reactc new` creates a Node + React project that builds with
  `npm run build`.

What does not work yet is listed in [docs/LIMITS.md](docs/LIMITS.md).

## Download

Each [release](../../releases) has the packaged compiler:

- `reactc-windows-x64.zip`: `bin/reactc.exe`. Builds run the bundled C
  toolchain through WSL with Ubuntu 26.04. The programs it produces need no
  WSL.
- `reactc-linux-x64.tar.gz`: `bin/reactc`, for Linux x86-64 with a glibc at
  least as new as Ubuntu 26.04's.

Unpack, add `bin` to PATH, then:

```sh
reactc new my-app      # a Node + React project, with @reactc/threads and @reactc/ui
cd my-app
npm run build          # Windows executables on Windows, Linux executables on Linux
```

`npm run build:windows` and `npm run build:linux` pick the target. See the
[template README](templates/node-react-app/README.md) and the
[compiler guide](compiler/README.md).

## Libraries

- [`@reactc/threads`](packages/reactc-threads/README.md): threads on a shared
  heap.
- [`@reactc/ui`](packages/reactc-ui/README.md): React layout, controls and
  window chrome for native apps.

Projects made by `reactc new` depend on both through the compiler that created
them. Elsewhere, install them from npm or from a release:

```sh
npm install @reactc/threads
npm install https://github.com/sil3nt884/reactc/releases/download/v0.1.0/reactc-threads-0.1.0.tgz
```

## Build from source

Everything the build needs is downloaded and built by the repository's own
scripts. You install only these:

| | Windows | Linux |
| --- | --- | --- |
| [Node.js](https://nodejs.org) 22 or newer | yes | yes |
| [Rust](https://rustup.rs) | yes | yes |
| Ubuntu 26.04 | as WSL: `wsl --install -d Ubuntu-26.04` | the system (or an `ubuntu:26.04` container) |
| `curl git xz-utils python3 perl` | inside WSL (Ubuntu ships them) | `sudo apt-get install -y curl git xz-utils python3 perl` |

For the WebAssembly target, add `--wasm` to setup and to the build:
`npm run setup -- --wasm`, then `npm run build:compiler -- --wasm` (about 640 MB more).

Then, from a clone (on Windows, on a drive letter such as `C:\src\reactc`):

```sh
npm run setup            # checks the above, then installs the toolchain into tools/ (20-40 minutes the first time)
npm run build:compiler   # builds reactc and packages it in dist/reactc
```

`dist/reactc` is the compiler: `bin/reactc(.exe)` with everything it needs.
Add `bin` to PATH and run `reactc new my-app`. `npm run setup` keeps
already-installed tools, so rerunning it is quick.
[tools/README.md](tools/README.md) lists what each installer adds.

The compiler alone builds with `cargo build --manifest-path compiler/Cargo.toml`.
It finds its runtime (`src/`, `native/`, `packages/`, `templates/`, `tools/`)
next to itself, or through `REACTC_HOME` or `--root`.

## Tests and CI

`npm test` runs the compiler's unit tests. CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs them on Windows
and Linux, runs the template's tests, packs the libraries, and builds a
generated Node + React project natively on Linux on every push.
[`release.yml`](.github/workflows/release.yml) builds both packages and the
library tarballs when a `v*` tag is pushed. It publishes the libraries to npm
when the repository has an `NPM_TOKEN` secret.

## Repository layout

```
compiler/      the reactc compiler (Rust)
src/           runtime compiled into programs: page runtime, Node layers, thread runtimes
native/        the Windows host (Win32 + Skia) and the WebAssembly runtime (native/wasm)
packages/      @reactc/threads and @reactc/ui
templates/     project templates for reactc new
scripts/       setup, packaging and CI
tools/         installers for the C toolchain and native libraries
host/          the Linux host (Tk or Skia) that runs Linux and WebAssembly UI builds
```

## Acknowledgements

reactc builds on [Porffor](https://github.com/CanadaHonk/porffor) (MIT),
[rolldown](https://github.com/rolldown/rolldown) and
[oxc](https://github.com/oxc-project/oxc) (MIT), Skia through
[SkiaSharp](https://github.com/mono/SkiaSharp)'s native build (MIT/BSD),
[libuv](https://github.com/libuv/libuv), [uWebSockets](https://github.com/uNetworking/uWebSockets),
OpenSSL, zlib, Brotli, zstd and [ada](https://github.com/ada-url/ada). Release
packages include each project's license notices.
