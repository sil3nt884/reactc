# reactc WASI runtime

The runtime embeds the Wasmtime C API and runs the same `reactc --target wasm`
file on Linux x86-64 or Android arm64 (API 26+). The module owns app state and
writes versioned JSON frames to stdout. The runtime passes stdin, stdout and
stderr through WASI Preview 1. It grants directory access only with
`--dir HOST[::GUEST]` and keeps the host's environment outside the guest.

This follows Chorium's separation of a portable app and a native Wasmtime
host. Chorium's app uses its own WASI 0.2 component interfaces. This runner
loads reactc's WASI Preview 1 command modules and uses the
[page protocol](../../docs/page-protocol.md).
[Chorium architecture](https://github.com/sil3nt884/browser/tree/main/chorium)

## Linux

```sh
sh native/wasm/build.sh linux
python3 host/native_page.py \
  --wasm-runtime dist/wasm-runtime/linux/reactc-runtime \
  --binary dist/reactc/personal-details-wasm/personal-details.wasm \
  --demo --renderer skia
```

Build the module using the [reactc instructions](../../compiler/README.md#webassembly-target).
Use `--demo --smoke` to exercise the profile app and the local demo backend
without opening a window. For a module built with `--http-origin`, select
`--http` and start its backend. The page host services the fetch frames.

## Android

Use the Linux Android NDK host toolchain. The output is an arm64 Android
command-line executable. It can run the module and exchange protocol frames
over `adb shell`. An Android view host that consumes those frames is separate
from the runner.

```sh
ANDROID_NDK_HOME=/path/to/android-ndk sh native/wasm/build.sh android

adb push dist/wasm-runtime/android/reactc-runtime /data/local/tmp/reactc-runtime
adb push dist/reactc/personal-details-wasm/personal-details.wasm /data/local/tmp/page.wasm
adb shell chmod 755 /data/local/tmp/reactc-runtime
adb shell -T /data/local/tmp/reactc-runtime /data/local/tmp/page.wasm </dev/null
```

The last command should emit the initial JSON snapshot. Interactive apps use
the same stdin event frames. The runtime links Wasmtime statically and
includes its license in the output directory. The build downloads and checks
the pinned C API archive, or accepts an unpacked one via `WASMTIME_C_API`.
