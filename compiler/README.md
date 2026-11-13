# reactc

The reactc command: the Rust front end and driver of the toolchain. It bundles
and transforms a React (TSX) app or a Node server, hands it to Porffor for C,
and compiles and links that C with reactc's runtime into a native executable.
See [What kind of tool is it?](../README.md#what-kind-of-tool-is-it) for the
stages.

```text
TSX ─► React Compiler ─► oxc ─► rolldown ─► Porffor ─► C ─► executable
       (optional)        strip types,       bundle      JS to C     alone, or with the
                         lower JSX                                  Skia host and Skia
```

| Stage | Library | What it does here |
| --- | --- | --- |
| React Compiler | `oxc_react_compiler` 0.143 (Rust port, experimental) | Rewrites components to cache work between renders |
| Parse and lower | `oxc` 0.143 | Parses TSX, removes TypeScript, turns JSX into calls to the native element factory |
| Bundle | `rolldown` 1.3 | Links the module graph with the native page runtime into one file |
| JS to C | Porffor (pinned in `toolchain.json`) | Compiles the bundle to C |
| Link | MinGW, host `cc`, or WASI SDK | Produces the executable or WebAssembly module |

`react` is not bundled. Imports of `react` resolve to the native page runtime
in `src/page-runtime.js`, which is compiled into the app with your components.
The [`@reactc/ui` package](../packages/reactc-ui/README.md) provides React
layouts, fields, buttons, and a customizable Windows title bar.

## Use

```sh
cargo build --locked --manifest-path compiler/Cargo.toml
# JavaScript bundle only:
./compiler/target/debug/reactc build App.tsx --outdir dist/reactc/page
# One self-contained Windows executable with the Skia renderer:
./compiler/target/debug/reactc build App.tsx --outdir dist/reactc/windows \
    --react-compiler --target windows --name MyApp --title "My App"
```

`--target host` links a bare protocol program for the build machine, used by
tests. With the Windows build tool this is a Linux executable built in WSL.

reactc reads its own files (`src/`, `native/`, `tools/`) from its root:
`--root` or the configuration's `"root"`, else `REACTC_HOME`, else the nearest
folder above the executable that contains `src/page-runtime.js`. The checkout
build in `compiler/target/*/` and a packaged `bin/reactc.exe` both find their
root this way, so they run from any folder.

### Start a project

`reactc new <folder> [--template NAME]` copies a template from reactc's
`templates/` folder (`reactc new --list` shows them; `node-react-app` is the
default). It points the copy's `reactc.config.json` `"root"` at this reactc,
and names `package.json` after the folder. The project's `build.ps1` (needs
only PowerShell: `-Only server|client`, `-Start`, `-NoBuild`) and its npm
scripts find reactc through that `root`, then `REACTC_HOME`, then PATH.

### Package the compiler

`npm run build:compiler` (from Windows) builds reactc in release mode and
assembles `dist/reactc`: `bin/`, `src/`, `native/`, the tools it compiles with
(Porffor, the C toolchain, Skia, and the Windows and Linux libraries), `@reactc/ui`,
the project template, `README.md` and `VERSION.json`. Each run replaces the
sources and copies tools incrementally. It ends by bundling an app with the
packaged compiler from an unrelated folder. Options: `--out DIR`, `--wasm`
(adds the WebAssembly toolchain), and `--smoke-native` (also links a Windows
executable).

Each target writes the raw Porffor `app.c` and the C files used for linking
into `--outdir`. Host builds write `host.c` and, when unused Porffor library
glue is removed, `app.host.c`. Windows builds write `app.windows.c`,
`entry.c`, and `windows-host.c`. The generated host includes the checked-in
`native/windows/app.c` Skia runtime. The Windows manifest records the
window, core and protocol-worker roles. When compiling the emitted Windows C
manually, put the repository root on the C compiler's include path.

UI side-effect `.css` imports compile into native styles. The subset includes
class, ID, element and attribute selectors, descendant and child selectors,
CSS variables, pixel min/max-width media queries, and `:hover` and `:focus`.
Windows sends viewport changes to the core so the cascade updates on resize.
When a stylesheet uses `:hover` or `:focus`, snapshots set
`interactionStyles`, and Windows sends
`{"type":"interaction","hover":id|null,"focus":id|null}` with the innermost
tree node under the pointer and the focused text control. `:hover` matches that
node and its ancestors in the committed tree. Supported properties include
`opacity`, per-side borders, `font-style: italic`, `cursor: pointer` (the
Windows hand cursor) and `box-sizing: border-box` (the renderer's box model).
The compiler reports unsupported selectors, properties, values and at-rules,
for example `:active`, `:focus-visible`, `box-shadow`, `transform`,
`transition`, `outline` and scrollbar pseudo-elements. The native renderer
determines layout and painting, so browser layout and animation can differ.
Borders are painted inside the box and do not reduce its content area.
Windows text uses a covering system typeface, chosen through the Skia font
manager, for characters the selected face lacks, such as emoji.

Windows controls without their own border width (inputs, textareas, selects and
buttons without `nativeVariants`) get a 1px default border. A `border-color`
alone recolours it, and a border width of 0 (`border: none`) removes it. The
app's root background selects light or dark defaults: on a light root,
unstyled controls use light fills and dark text with a 6px radius. An opaque
root background fills the window around the app. The native edit control uses
the edited field's background and text colours.

Windows apps without a `WindowTitleBar` get a default one. The page runtime
wraps the tree in a 36px title bar with the window title and minimize,
maximize and close buttons, using the nodes `@reactc/ui` emits. It follows
the root background's light or dark choice. The window then uses the custom
frame: no system caption and no menu bar, and Licenses moves to the system menu.
Host-target snapshots are unchanged.

### Keyboard

Shortcut-class keys reach the page before Windows handles them. While a text
field is being edited, these are keys with Ctrl, Alt or the Windows key, plus
Enter, Escape, Tab and the function keys. Elsewhere every key except a
modifier alone is reported. Alt+F4 stays with Windows. The host sends
`{"type":"key","key","shiftKey","ctrlKey","altKey","metaKey","repeat","target"}`
only when snapshots set `keyListeners`. `target` is the field being edited or
the focused button or link. The event bubbles through `onKeyDown` handlers
from the target up through its ancestors, then to `window` and `document`
`keydown` listeners (reactc only; the JS compiler rejects these globals).
`preventDefault()` cancels the Windows default below. Plain typing in a text
field is not reported.

Windows defaults:

- Tab and Shift+Tab move focus through inputs, selects, textareas, buttons,
  links and `tabIndex: 0` scroll regions, inside an open modal if there is
  one. A focused button or link shows a focus ring.
- Enter activates the focused button or link. Space activates a focused
  button; otherwise it scrolls the page.
- Enter in a single-line field submits its form, with the first submit button,
  or directly when the form has one text field.
- In text fields, Ctrl+A selects all and Ctrl+Backspace deletes the previous
  word. Ctrl+C, Ctrl+V, Ctrl+X and Ctrl+Z are the edit control's own.
- Arrow keys, Page Up/Down, Home, End and Space scroll the page when nothing
  else is focused.
- A key replayed after the page's reply uses the modifiers captured when it
  was pressed, so a quick Ctrl+V still pastes.

`document.documentElement.setAttribute` updates attributes used by the root
stylesheet selectors. `window`'s `online` and `offline` listeners reflect
reachability observed by the configured native HTTP transport.
The Windows host paints each render snapshot, including snapshots with pending
HTTP requests. A synchronous event handler can start a separate async function
with `void` to render pending state immediately. Handle request failures in that
function and update state again when the response arrives.
Windows builds support `window.open(url, '_blank')` from React event handlers
and effects. Use an absolute HTTP or HTTPS URL. The host opens it in a separate
browser window and keeps the native app on its current page. It uses the
registered browser when it supports Chrome's or Firefox's new-window option,
with registered Microsoft Edge as the fallback. The call returns `null`, and
the target can be omitted. Browser window features and handles are unavailable.
WASI builds write `app.wasi.c` and `wasi.c`. The manifest lists the generated
C files. Add `--emit-c` to stop before linking. Use a separate output directory
for each target.

On Windows the Porffor and C compiler steps run through WSL, because the
pinned Porffor release ships for Linux and macOS. The finished `.exe` needs
neither WSL nor Node.

## Separate UI and server programs

Name a server entry `*.server.ts`, `*.server.js`, `*.server.mjs`, or
`*.server.cjs`, or pass `--server` for an existing filename such as
`server/api.ts`. The server build bundles the entry for Porffor and links
a standalone host executable. The UI build takes a default-exported
React component, optionally named `*.client.tsx`. It rejects imports of
files marked `*.server.*`. Build the two entry points separately and use
HTTP across the boundary.

```sh
compiler/target/debug/reactc build server/api.ts --server --target windows \
    --name dinner-server --outdir dist/reactc/dinner-server
compiler/target/debug/reactc build ui/App.client.tsx --target windows \
    --http-origin http://127.0.0.1:43765 --name DinnerMenu --outdir dist/reactc/dinner-ui
```

`--target windows` links a server into a standalone Windows console
executable, `NAME.exe`, with its third-party notices in `NAME-NOTICES.txt`
beside it. It is the default target when `reactc.exe` runs on Windows.
`--target host` builds a program for the build machine; with the Windows
build tool, that is a Linux executable built through WSL. A large server
compiles slowly: an Express bundle spends about 25 minutes in one optimising C
compiler pass. Server compatibility depends
on the Node APIs and dependencies supported by the pinned Porffor compiler.
When a bundle imports `node:crypto` or `crypto`, `reactc` fills in missing
`generateKeyPair` and `pbkdf2` callbacks using Porffor's OpenSSL operations.
The callback runs on the native event loop after the call returns. The
cryptographic work runs on that loop and can block other server handlers.
`--emit-c` also works for a server entry.

### Project configuration

`reactc.config.json` holds any command-line option, and says which folders
hold server code and which hold client code. `reactc build` uses the file in
the current folder, or the one given by `--config FILE`, and builds every
configured entry, server first. Use `--only server` or `--only client` to
build one side.

```json
{
  "target": "windows",
  "outDir": "dist/my-app",
  "shared": ["shared"],
  "server": { "folders": ["server"], "entry": "server/index.ts", "name": "MyAppServer" },
  "client": { "folders": ["src"], "entry": "src/App.tsx", "name": "MyApp", "title": "My app",
              "httpOrigin": "http://127.0.0.1:5000" }
}
```

- Option keys: `target`, `outDir`, `root`, `name`, `title`, `httpOrigin`,
  `asyncPage`, `reactCompiler`, `native` and `emitC`. Top-level keys apply to
  every build, a `server` or `client` section overrides them, and command-line
  flags override both. Server sections reject UI-only options.
- Paths are relative to the configuration file. With two entries, outputs go
  to `outDir/server` and `outDir/client`. `root` overrides where reactc finds its
  own files (by default, from its executable).
- `reactc build path/to/file.ts` with a configuration builds that one file.
  Its folder decides the side: a file in a server folder is a server,
  without `--server`.
- The client bundle may not include files from server folders, and the server
  bundle may not include files from client folders. The build stops and names
  the files. Put code both sides use in a `shared` folder; packages are open
  to both. Folders may not belong to two sides.
- Unknown keys are errors. Configured builds produce native output unless
  `native` is `false`; clients default to async page mode.

The [Node + React template](../templates/node-react-app/reactc.config.json)
is a complete configured project.

## The Windows executable

The compiled application and the Skia host are linked into one process. The
application runs on its own thread and exchanges protocol messages with the
host through two in-memory queues (`native/windows/core-channel.h`). Skia is
embedded as a resource. The generic host (`NATIVE_APP`) handles windowing,
input, drawing, and HTTP through WinHTTP.

The Windows message pump owns painting and window commands. A separate
protocol worker waits for the compiled core, timers and WinHTTP. The window
uses the last completed snapshot while app commands run in order, so it can
move, repaint and close during a slow operation.

Run with `--smoke` to paint one frame, save `native-app-smoke.bmp` and
`native-app-smoke.json`, and exit. Set `REACTC_TIMING=1` to log per-step
timings.

### Draw the Windows title bar in TSX

Import `WindowTitleBar` and `WindowButton` from `@reactc/ui`.
Keep the title bar as a direct child of the root layout and present in the
initial snapshot. Build with `--target windows`.

```tsx
import { WindowTitleBar, WindowButton } from '@reactc/ui';

export default function App() {
  return <main>
    <WindowTitleBar height={52} style={{
      backgroundColor: '#21344f',
      borderBottomWidth: 3,
      borderColor: '#ffae42',
      paddingLeft: 18,
    }}>
      <span style={{ flexGrow: 1 }}>React Express Demo</span>
      <WindowButton command="minimize" style={{ position: 'relative', top: 4 }} />
      <div style={{ position: 'relative', width: 116, height: 44 }}>
        <WindowButton command="maximize" style={{ position: 'absolute', left: 4, bottom: 4 }} />
        <WindowButton command="close" style={{
          position: 'absolute', right: 8, top: 4,
          backgroundColor: '#842a3a', borderRadius: 8,
        }}>×</WindowButton>
      </div>
    </WindowTitleBar>
    <h1>Full-stack Deploy Demo</h1>
  </main>;
}
```

Skia paints the title bar and its children. Drag its unoccupied area to move
the window and use the window edges to resize. The maximize button also
restores the window. Licenses is available in the system menu (`Alt+Space`)
or through an optional `<WindowButton command="licenses" />`. Apps without
`WindowTitleBar` use the standard frame.

Title-bar styles use the native renderer's inline style subset. A
`WindowButton` accepts numeric `padding` and per-side overrides, as well as
`width`, `height`, `backgroundColor`, and `borderRadius`. Padding insets the
glyph or label inside the button. Set `width` or `height` to change the hit area.

Within the title bar, `position: 'relative'` offsets a child from its normal
layout position and preserves its space in the row. `position: 'absolute'`
anchors a child to the edges of its immediate parent container and removes
it from the row or column layout. Use numeric `top`, `right`, `bottom`, and
`left` insets. Give a parent group with only absolute children its own
`width` and `height` to establish the anchoring area.

```tsx
<WindowButton command="close" style={{
  width: 52, padding: 4, paddingLeft: 14, borderRadius: 8,
}} />
```

Windows inputs and textareas use native drag selection and the Windows edit
menu. A `readOnly` field still permits selection and copying. For a custom
right-click action, attach `onContextMenu` to a rendered element. The event
supplies client coordinates, and `preventDefault()` suppresses the edit
menu when the callback is on a field. Selection is confined to native fields.

### WebAssembly target

`--target wasm` builds a `wasm32-wasip1` command module for a WASI runtime.
The compiled component, state, and callbacks use the same stdio page protocol.
The existing Tk or Skia host can render it through Wasmtime.

```sh
npm run setup -- --wasm
compiler/target/debug/reactc build App.tsx --target wasm --outdir dist/reactc/app-wasm
python3 host/native_page.py --binary dist/reactc/app-wasm/App.wasm --demo --smoke
```

Use `reactc.exe` when running the Windows compiler from WSL. It builds with
the pinned Linux x86-64 WASI SDK in WSL. Use a local Wasmtime on the system
running the page. On Windows, put it on `PATH` or pass `--wasmtime PATH`.
To open the UI, omit `--smoke` and select `--renderer skia` if installed.

WASI filesystem access is restricted to directories you grant. Use
`--wasi-dir "$PWD/data::/data"` to expose a host directory as `/data`.
Run `sh tools/install-ada.sh --wasi` if the emitted C needs Ada URL support.
The verified subset covers UTF-8 path-based reads and writes, promise
directory listing, `Readable.from`, and `fs.createReadStream`. The WASI
adapter returns `ENOSYS` for ownership and permission changes, `mkdtemp`,
and the descriptor overload of `readFile`.

`--http-origin` still uses this project's `fetch` binding with the host's
HTTP transport. Run the page host with `--http` for this mode. Direct
`node:http`, `node:https`, `node:net`, `node:child_process`, `node:zlib`,
and `node:crypto` imports are unavailable on WASI. Some combinations of
otherwise supported calls also cause Porffor to emit libuv code and fail
at build time. The WASI target uses a 64 MiB Porffor arena with garbage
collection disabled. A browser renderer and browser-facing bindings remain
separate work.

For a standalone host that embeds Wasmtime, see the
[Linux and Android runtime](../native/wasm/README.md). The Linux Tk/Skia host
accepts it through `--wasm-runtime`.

## HTTP and Node APIs

`--http-origin http://127.0.0.1:4000` enables the async page driver and binds
unshadowed `fetch(...)` calls to the native host HTTP service. The binding
accepts relative paths starting with `/` and absolute URLs on the configured
HTTP(S) origin. An explicitly configured `http://127.0.0.1` origin also
accepts `http://localhost` URLs on the same port and sends them to IPv4.
It supports `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS`.
Request headers (for example `Authorization: Bearer …`) may be a plain
object, `[name, value]` pairs or a `Headers` instance; `Headers` is
available as a global. String bodies default to `text/plain;charset=UTF-8`
and `URLSearchParams` bodies to `application/x-www-form-urlencoded`; both
are UTF-8 up to 64 KiB, and GET/HEAD refuse bodies. Headers the host owns,
such as `Host`, `Content-Length`, `Origin`, `Connection`, and `Proxy-*` or
`Sec-*`, are refused, and the request headers are limited to 64 entries and
8 KiB. The response exposes `status`, `statusText`, `ok`, `url`, `headers`
(`get`, `has`, `forEach`, `entries`), `text()` and `json()` over buffered
UTF-8 up to 64 KiB. Transport failures reject the promise; HTTP errors
resolve with their status, headers and body. Redirects are not followed,
cookies are not kept, and streaming or binary bodies are outside this subset.
The only accepted option besides `method`, `headers` and `body` is `cache`,
because the host never caches. The Linux protocol host can serve it with
`host/native_page.py --http`; Windows apps use WinHTTP.

`reactc` passes explicit `node:` imports for `fs`, `fs/promises`, `stream`,
`net`, `child_process`, `zlib`, `crypto`, `http`, and `https` to Porffor
on Linux and Windows. This includes `webcrypto` from `node:crypto`.
The linker selects libraries from the generated C. Direct HTTP and HTTPS
can also emit `porf_uws.cpp`, and Windows builds retain its adapted C++ source
alongside the raw bridge and target C files.

- Linux uses the system development libraries. On Ubuntu install
  `libuv1-dev`, `zlib1g-dev`, `libbrotli-dev`, `libzstd-dev`, and
  `libssl-dev`. Run `sh tools/install-ada.sh` for the URL helpers and
  `sh tools/install-node-libs.sh` for Porffor's uSockets dependency.
- Windows uses the MinGW x64 C and C++ toolchain. From the build environment
  run `sh tools/install-ada.sh --windows` and
  `sh tools/install-node-libs.sh --windows`. The second installer uses
  Git, CMake, Ninja, Perl and Make. The native libraries link statically into
  the Windows executable. HTTPS uses OpenSSL and adds the Windows root store
  to its default trust configuration.

The host-backed `fetch` binding has no dependency on these optional libraries.
Use `--async-page` and await Node I/O in an async component or event handler.
The Windows subprocess adapter covers launching executables with `spawn`,
`execFile`, `execFileSync`, and shell commands through `cmd.exe /d /s /c`
for `exec`, `execSync` and `shell: true`.

On Windows, `node:path` is a port of Node's `path.win32` (with `path.posix`
alongside), and `node:url`'s `fileURLToPath`/`pathToFileURL` use Windows
file URLs. `crypto.scrypt`/`scryptSync` are implemented (RFC 7914). A server
entry may use top-level `await`; reactc wraps the entry body in an async
function and reports a rejection like Node (exit code 1). Exports from the
entry are refused.

### Worker threads and fork

`new Worker(...)` from `node:worker_threads` and `fork(...)` from
`node:child_process` run as OS threads inside the one executable, not as new
processes. reactc compiles each worker or child file as its own Porffor
program, makes its symbols private to it and links it into the server. Every
instance gets its own JavaScript globals, heap and libuv loop, so two copies
of the same worker run at once without sharing state.

```js
import { Worker } from 'node:worker_threads';
const worker = new Worker(new URL('./resize.worker.js', import.meta.url), { workerData: { size: 64 } });
worker.on('message', result => console.log(result));

import { fork } from 'node:child_process';
const child = fork('./job.js', ['--fast']);
child.send({ start: true });
child.on('exit', code => console.log('job ended', code));
```

The syntax rule is that the file must be known when compiling. The first
argument has to be a string literal, a template literal without
substitutions, or `new URL('<literal>', import.meta.url)`, and it must start
with `./` or `../`. It resolves against the file that contains the call;
Node resolves plain strings against the working directory, so keep the two
the same if the code also runs under Node. A computed path is a compile
error that says so.

Supported:

- Worker: `workerData`, `argv`, `isMainThread`, `threadId`, `parentPort`
  (`postMessage`, `on('message')`, `close`), `worker.postMessage`,
  `worker.terminate()` (returns a promise for the exit code), the `online`,
  `message`, `error` and `exit` events, and `process.exit()` ending only that
  worker.
- fork: `process.send`, `process.on('message')`, `process.connected`,
  `process.disconnect()`, `process.argv` from the fork arguments,
  `child.send`, `child.disconnect()`, `child.kill()`, and the `spawn`,
  `message`, `disconnect`, `exit` and `close` events.

Worker messages and `workerData` are structured clones, as in Node:
`undefined`, `NaN`, `-0`, BigInt, plain objects, arrays (holes kept),
`Date`, `RegExp`, `Map`, `Set`, `Error` types (with `stack` and `cause`),
`ArrayBuffer`, typed arrays, `DataView`, boxed primitives, and shared or
cyclic references within one message. Class instances arrive as plain
objects. Functions, symbols, `WeakMap`/`WeakSet` and promises throw a
`DataCloneError` from `postMessage` or the `Worker` constructor. `fork()`
children use Node's default JSON unless `serialization: 'advanced'` is
passed, which gives them the same structured clone.

Limits: every thread has its own heap, so messages are always copies. A
transfer list is accepted, but transferred buffers are copied, not
detached. `SharedArrayBuffer` throws a `DataCloneError` instead of being
shared, and `MessageChannel`/`MessagePort` are not provided. Messages
travel over a token-protected loopback socket. Workers cannot start
workers, and a worker that would link the uWS HTTP server is refused. A
forked child shares the parent's process, so its `process.pid`, environment
changes and working directory are the parent's. `terminate()` and `kill()`
do not interrupt running code: they close the message channel, and the
thread ends once its event loop has nothing left to do (a worker can listen
for `parentPort`'s `close` event, a fork child for `disconnect`, and call
`process.exit()`). A thread busy in a loop cannot be stopped from outside. Set `REACTC_THREAD_TRACE=1` to log thread starts and
exits (and, on Linux, a backtrace if the process crashes).

### Shared-memory threads (`@reactc/threads`)

Worker threads copy messages. [`@reactc/threads`](../packages/reactc-threads/README.md)
instead shares one heap between threads that run in parallel, as in Java. Every
object, array, `Map`, `Set` and closure is the same object on every thread.

```js
import { Thread, spawn, parallel, synchronized } from '@reactc/threads';

class Job extends Thread { run() { return work(); } }   // Java style
const a = new Job().start();
const b = spawn(work, 2);                                // functional style
synchronized(shared, () => shared.items.push(1));       // monitor on any object
a.join(); b.join();                                      // result, or the thread's error
```

Importing it (also as `reactc:threads`) switches a server build to the shared
heap. reactc runs `src/reactc-shared-heap/transform.mjs` over Porffor's C
(kept as `app.porffor.c`) and links the thread runtime. It works for Windows
and Linux targets, and the manifest records `"sharedHeap": true`. It cannot be
combined with `worker_threads`/`fork` in one program. `run()` may be async:
each thread runs its own event loop (timers, promise jobs and a libuv loop),
and waiting in it is a safe region. A thread is also a promise (`await thread`,
`Promise.all(threads)`). See the
[package README](../packages/reactc-threads/README.md) for usage and limits.
Set `REACTC_SHARED_TRACE=1` to log thread starts, joins and collections.

### Windows filesystem and streams

`reactc` links Porffor's `node:fs`, `node:fs/promises`, and `node:stream`
with a shared Windows filesystem adapter. Install the MinGW x64 C++ toolchain
and run `sh tools/install-ada.sh --windows` once from the build environment.
Porffor can emit its URL parser when it bundles filesystem or stream
internals. The Windows executable links that dependency statically.

The Windows adapter supports UTF-8 paths, binary and text reads and writes,
append, open and close, positioned I/O, stats, directory listing and
nonrecursive `mkdir` and `rmdir`, rename, unlink, copy, `realpath.native`,
flush and truncate. It preserves the separate protocol descriptors. Promise
and callback APIs use Porffor's deferred execution or the libuv thread pool
when the app links libuv. Use
`--async-page` for a React page that awaits those APIs or consumes streams.

It also supports recursive `mkdir` and `rm`, `mkdtemp`, `chmod`/`fchmod`
(the read-only bit) and `utimes`/`futimes`. The supported path inputs are
strings and UTF-8 byte arrays. Ownership changes, `lstat`, link operations
and file watching are outside this coverage. Unsupported filesystem
operations in the adapter return `ENOSYS`.

## Not done yet

- Routing, Tailwind translation and most browser-API bindings are not
  implemented. See [docs/LIMITS.md](../docs/LIMITS.md).
- File dialogs are unavailable in the generic Windows host.
- rolldown treats `src/x.js` and `src\x.js` as different modules on Windows.
  Build every path a component at a time, or the runtime is bundled twice.
