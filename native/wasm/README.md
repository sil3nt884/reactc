# reactc WASI runtime

The runtime embeds the Wasmtime C API and runs the same `reactc --target wasm`
file on Linux x86-64 or Android arm64 (API 26+). The module owns app state and
writes versioned JSON frames to stdout. The runtime passes stdin, stdout and
stderr through WASI Preview 1. It grants directory access only with
`--dir HOST[::GUEST]` and keeps the host's environment outside the guest.

The runner loads reactc's WASI Preview 1 command modules: the app sends JSON
frames describing its page, and the host sends input and replies back.

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

## Windows

Package a WASI page as a Windows x64 GUI executable with the precompiled
module, Wasmtime, and the native Skia renderer bundled inside. ReactC compiles
the module while packaging it so the app can skip compilation at launch.
On Linux install the reactc MinGW toolchain and run both Wasmtime installers.
On Windows, the native compiler package can pack an existing module without WSL.

```sh
sh tools/install-wasmtime.sh windows
sh tools/install-wasmtime.sh linux  # Linux build hosts
reactc pack Tasks.wasm --target windows --title "Tasks" --outdir dist/packaged
```

`dist/packaged/Tasks.exe` runs without a separate runtime installation. Start the
app's backend first if it uses HTTP.
The launcher draws its own title bar and window controls. A page can supply a
`WindowTitleBar` from `@reactc/ui` to customize the caption.

Use the Windows build of Wasmtime with the Python page host. The WASI module
is the same file used on Linux and Android. For the Tasks template, start its
backend first, then run this from the reactc checkout in PowerShell:

```powershell
py -3 host/native_page.py --http --wasmtime C:\path\to\wasmtime.exe --binary C:\path\to\Tasks.wasm
```

## Android

On Linux x64 or WSL, install a JDK (17 or newer), Android SDK Platform 35,
Build-Tools 35 or newer, and the Android NDK. Put Java on PATH and set
`ANDROID_HOME` and `ANDROID_NDK_HOME` to the Linux SDK and NDK directories.
Install the WASI compiler with `npm run setup -- --wasm` to build from source.

```sh
sh tools/install-wasmtime.sh linux
reactc build --target android --only client
reactc pack Tasks.wasm --target android --http-origin http://127.0.0.1:5180 --outdir dist/packaged
adb install -r dist/packaged/Tasks.apk
```

`build --target android` compiles the React page to WASI, compiles that module
for Android arm64 and signs an APK that includes the runtime and native widget
host. For standalone entries, pass the TSX file and omit `--only client`.
The APK requires Android 8.0 (API 26) or newer. It uses the Android debug key by
default. Set `REACTC_ANDROID_APPLICATION_ID` to choose the application ID.
For a custom signature, set `REACTC_ANDROID_KEYSTORE`,
`REACTC_ANDROID_KEY_ALIAS`, and `REACTC_ANDROID_KS_PASS`.

The Android host supports containers, headings, text, buttons, and text fields.
It can send HTTP requests to the configured `httpOrigin`, or the
`--http-origin` supplied to `pack`. Run the backend separately. On a development
device, `adb reverse tcp:5180 tcp:5180` connects the Tasks app to a local
backend listening on the build machine.

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

Larger pages can be compiled ahead of time to avoid compiling on the phone.
Use Wasmtime 50.0.1 and pass the resulting Android arm64 artifact to the
runtime with `--precompiled Tasks.android.cwasm`. Deserialization requires a
trusted artifact built with the same Wasmtime version and configuration.

```sh
wasmtime compile -C collector=drc -W exceptions=y -O opt-level=0 --target aarch64-linux-android \
  Tasks.wasm -o Tasks.android.cwasm
```
