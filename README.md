# reactc

reactc is an ahead-of-time build toolchain and native runtime for React and
Node.js apps. You write a React UI, a Node server, or both, in TypeScript or
JavaScript. reactc turns them into standalone programs for Windows, Linux or
WebAssembly. There is no browser and no JavaScript engine inside the result:
your code becomes machine code.

- **UIs** become native windows: Win32 with a Skia renderer on Windows, a Tk
  or Skia host on Linux.
- **Servers** (`node:http`, `fs`, `net`, `crypto`, `child_process`, `zlib`,
  `worker_threads` and more) become console executables.
- **Threads.** [`@reactc/threads`](packages/reactc-threads/README.md) gives you
  real parallel threads on one shared heap, in Java style or functional style.
  `run()` can be async, and a thread can be awaited like a promise.
- **Native libraries.** [`@reactc/native`](packages/reactc-native/README.md)
  calls functions in any `.dll` or `.so` with a C ABI. Signatures are declared
  in JavaScript, and JS objects, strings and callbacks are converted.
- **Projects.** `reactc new` creates a Node + React project that builds with
  `npm run build`.

What does not work yet is listed in [docs/LIMITS.md](docs/LIMITS.md). To
bring an existing React app over, see
[docs/CONVERTING.md](docs/CONVERTING.md).

## What kind of tool is it?

reactc works like a compiler driver: the way `clang` runs a preprocessor,
compiler and linker for you, reactc runs every stage from TSX to an
executable, and adds the runtime your app needs.

1. **Front end (reactc, in Rust).** reactc bundles your code with rolldown,
   parses and transforms it with oxc, and optionally runs the React Compiler.
   It lowers JSX and hooks onto its page runtime, compiles CSS to native style
   rules, and replaces Node built-ins with native implementations: Windows
   paths, `fetch`, worker threads. With `@reactc/threads`, it also applies the
   shared-heap transform.
2. **JavaScript to C.** [Porffor](https://github.com/CanadaHonk/porffor)
   compiles the bundle to C.
3. **C to a native program.** GCC (Linux), MinGW-w64 (Windows) or the WASI SDK
   (WebAssembly) compile that C. It is linked with reactc's runtime: the window
   host and renderer, libuv, uWebSockets and OpenSSL for Node APIs, and the
   thread runtimes.

So reactc is not a single compiler, and not a JavaScript engine or a browser
shell. It is a compilation toolchain plus the native runtime the compiled app
runs on.

## Download

Each [release](../../releases) has the packaged toolchain:

- `reactc.exe` downloads and verifies the Windows build tools when first
  needed. `reactc-offline.exe` carries the same tools in the executable and
  can be renamed to `reactc.exe`.
  Both reuse the unpacked tools in `%LOCALAPPDATA%\reactc\toolchains`.
  Windows builds run without WSL or a separate Node installation.
- `reactc-windows-x64.zip` contains the unpackable Windows toolchain and
  its `bin/reactc.exe`.
- `reactc-linux-x64.tar.gz`: `bin/reactc`, for Linux x86-64 with a glibc at
  least as new as Ubuntu 26.04's.

Put `reactc.exe` in your project folder, or add its directory to PATH.
From the folder containing `reactc.config.json`, run:

```powershell
.\reactc.exe build --target windows
```

Use `reactc.exe build --target windows` when the executable is on PATH.
The standalone executable also looks beside itself for the config when
the current folder has none. An explicit `--config` takes precedence.

For a new project:

```sh
reactc new my-app      # a Node + React project, with @reactc/threads and @reactc/ui
cd my-app
reactc build           # Windows executables on Windows, Linux executables on Linux
```

`npm run build:windows` and `npm run build:linux` pick the target. See the
[template README](templates/node-react-app/README.md) and the
[compiler guide](compiler/README.md).

## Libraries

- [`@reactc/threads`](packages/reactc-threads/README.md): threads on a shared
  heap.
- [`@reactc/ui`](packages/reactc-ui/README.md): React layout, controls and
  window chrome for native apps.
- [`@reactc/native`](packages/reactc-native/README.md): call any native library
  with a C ABI from JavaScript, with structs, strings, buffers and callbacks.

Projects made by `reactc new` depend on both through the reactc that created
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

**Windows without WSL.** To build only Windows programs, skip Ubuntu:
install Node.js 22.15 or newer, Rust and [Git for Windows](https://git-scm.com),
then run `npm run setup -- --native` in place of `npm run setup`. It installs
a native MinGW-w64 GCC (`tools/mingw64`) and Porffor's source
(`tools/porffor`), which reactc runs on Node. Linux (`--target host`) and
WebAssembly targets still need the WSL setup; both setups can share a clone,
and reactc then builds Windows programs natively.

For the WebAssembly target, add `--wasm` to setup and to the build:
`npm run setup -- --wasm`, then `npm run build:compiler -- --wasm` (about 640 MB more).

Then, from a clone (on Windows, on a drive letter such as `C:\src\reactc`):

```sh
npm run setup            # checks the above, then installs the toolchain into tools/ (20-40 minutes the first time)
npm run build:compiler   # builds reactc and packages it in dist/reactc
```

`dist/reactc` is the toolchain: `bin/reactc(.exe)` with everything it needs.
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
OpenSSL, zlib, Brotli, zstd, [nghttp2](https://nghttp2.org/) and [ada](https://github.com/ada-url/ada). Release
packages include each project's license notices.
