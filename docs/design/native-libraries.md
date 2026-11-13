# Design: calling native libraries from JavaScript

Status: implemented as [`@reactc/native`](../../packages/reactc-native/README.md), with signatures declared at runtime rather than at build time. On x86-64, integer and floating arguments travel in separate register classes (System V) or fixed positions (Windows x64), so one generic C caller (src/reactc-ffi.h) serves every signature without per-function code generation or libffi. Callbacks use 64 assembly entry stubs that save the argument registers and dispatch to JavaScript. Verified on Windows and Linux with a test library (every integer width, floats, stack-spilling calls, UTF-8 strings, buffers, structs in and out, variadic calls, callbacks) and with system libraries (kernel32, msvcrt, libc, libm, qsort with a JS comparator). The original proposal follows.

## Goal

Call functions in native libraries (`.dll`, `.so`, or static `.a`/`.lib`)
directly from JavaScript in reactc programs, for example SQLite, image
codecs or an existing C library. Node can do this through N-API addons or
community FFI packages. Both are heavy: addons need a C++ build per platform,
and FFI packages pay a runtime marshalling cost on every call.

## Why reactc can do better

reactc compiles JavaScript to C. A function whose signature is known at build
time can become an ordinary C call in the generated program, with no
marshalling layer and no addon. Porffor already lets reactc's own runtime
embed C (`Porffor.c\`...\``). This design gives that ability to programs
safely, with types.

## API

```js
import { library } from '@reactc/native';

const sqlite = library('sqlite3', {
  sqlite3_libversion: { returns: 'cstring' },
  sqlite3_open: { args: ['cstring', 'pointer*'], returns: 'i32' },
  sqlite3_close: { args: ['pointer'], returns: 'i32' },
});

console.log(sqlite.sqlite3_libversion());
```

- **Build-time signatures.** The library name and the signature object must
  be literals, like worker paths. reactc reads them at build time and
  generates one C wrapper per function.
- **Linking.**
  - `library('sqlite3', …)` links `-lsqlite3` at build time when the library
    is found (static or import library), so the call is direct.
  - `library('./libfoo.so', …, { load: 'runtime' })` loads it with
    `dlopen`/`LoadLibrary` when the program starts, and calls through a
    function pointer.
- **Configuration.** `reactc.config.json` gains `native.libraries` (search
  paths, extra link flags per target), so projects can ship their own
  libraries.

## Types

| Type | JavaScript | C |
| --- | --- | --- |
| `i8`…`i64`, `u8`…`u64` | number (BigInt for 64-bit) | fixed-width integers |
| `f32`, `f64` | number | `float`, `double` |
| `bool` | boolean | `int` |
| `cstring` | string, copied to UTF-8 for the call | `const char *` |
| `buffer` | `Uint8Array`/`ArrayBuffer`, passed in place | `uint8_t *` plus length |
| `pointer` | an opaque handle object | `void *` |
| `pointer*` | an out-parameter that receives a handle | `void **` |
| `struct` | plain object, laid out by a declared field list | `struct` by value or pointer |
| `callback` | JS function, called from C | function pointer to a generated trampoline |

## Callbacks and memory

- **Callbacks.** C calling back into JavaScript goes through generated
  trampolines. A callback that arrives on another OS thread is queued to the
  program's event loop, unless the program uses `@reactc/threads`, in which
  case it can run on a registered thread at a safepoint.
- **Buffers.** Buffers passed in place stay valid during the call. Keeping
  one past the call needs `pin(buffer)`, which marks it for the collector.
  Porffor's collector never moves objects, so pinned memory keeps its
  address.
- **Handles.** Pointer handles can carry an optional finalizer
  (`{ free: 'sqlite3_close' }`), run when the handle is collected or released
  explicitly.

## Steps

1. Numbers, `cstring` and `pointer` with build-time linking: call
   `sqlite3_libversion` and `sqlite3_open` on Windows and Linux.
2. `buffer` and `pointer*` out-parameters: enough for SQLite queries
   (`sqlite3_prepare_v2`, `step`, `column_*`).
3. Runtime loading (`dlopen`/`LoadLibrary`).
4. Structs, callbacks and finalizers.
5. A worked SQLite example; this lifts the native-addon limit in LIMITS.md
   for libraries with a C API.

## Open questions

- **C++ APIs.** Only C ABIs are planned; C++ libraries need a C shim.
- **Header parsing.** Generating signatures from `.h` files would save
  typing, but literal signatures come first.
