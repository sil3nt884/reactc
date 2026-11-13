# @reactc/native

Call functions in native libraries from programs compiled by reactc. Any
library with a C ABI works: C, and C-exported functions from Rust, Zig, Go,
C++ or anything else that builds a `.dll` or `.so`. You write signatures in
JavaScript; there are no addons to build and no glue code.

```js
import { library, struct, callbackType, read } from '@reactc/native';

const libm = library('libm.so.6', { cos: { args: ['f64'], returns: 'f64' } });
libm.cos(0);   // 1
```

Importing the package compiles reactc's native call runtime into the program.
It works in servers and UI apps, on Windows and Linux (x86-64). It does not
work for the WebAssembly target, which cannot load native libraries.

## Loading libraries

```js
const lib = library(path, signatures);
```

- **`path`** is a file name the system can find (`'kernel32.dll'`,
  `'libm.so.6'`), a path (`'./mylib.dll'`), or `''` for the program itself.
  On Linux, `''` includes libc.
- **`signatures`** maps each function name to `{ args, returns, variadic }`,
  or to the short form `[returns, args]`.
- **`lib.symbol(name)`** returns a raw function address. `func(address,
  signature)` turns any function pointer into a JS function.

## Types

| Type | You pass | C sees | Returned as |
| --- | --- | --- | --- |
| `i8` `i16` `i32` `u8` `u16` `u32` | number | that integer | number |
| `i64` `u64` `isize` `usize` | BigInt (or number) | 64-bit integer | BigInt |
| `f32` `f64` | number | `float` / `double` | number |
| `bool` | boolean | `int` | boolean |
| `cstring` | string (copied to UTF-8 for the call) | `const char *` | string, read as UTF-8 |
| `buffer` | `Uint8Array`, any typed array or `ArrayBuffer` | pointer to its bytes; what C writes is copied back | — |
| `pointer` | BigInt address, `null`, a typed array, or a struct object | `void *` | BigInt address |
| `struct({...})` | a plain JS object | pointer to the struct; what C changes is read back into the object | object (from a returned struct pointer) |
| `callbackType(sig)` | a JS function | function pointer, valid during the call | — |
| `void` | — | — | `undefined` |

`variadic: true` declares a C function with `...` (for example `printf`).
Extra arguments are passed by their JavaScript type: integers and BigInts as
64-bit integers, other numbers as doubles, strings as `cstring`.

## Structs

```js
const Point = struct({ x: 'f64', y: 'f64', id: 'i32', name: 'cstring' });
const geometry = library('./geometry.dll', {
  point_move: { args: [Point, 'f64'], returns: 'void' },
  point_new: { args: ['f64', 'f64'], returns: 'pointer' },
});

const p = { x: 3, y: 4, id: 1, name: 'from JS' };
geometry.point_move(p, 1.5);         // p.x and p.id now hold what C wrote
const q = Point.read(geometry.point_new(6, 8));   // { x: 6, y: 8, id: 7, name: 'made in C' }
```

Fields are laid out with C's alignment rules and may be numbers, `cstring`,
`pointer` or nested structs. `Point.alloc(object)` returns C memory that holds
the object; free it with `free()`.

## Callbacks

C can call your JavaScript functions:

```js
const libc = library('', {   // 'msvcrt.dll' on Windows
  qsort: { args: ['buffer', 'usize', 'usize', callbackType({ args: ['pointer', 'pointer'], returns: 'i32' })], returns: 'void' },
});
const numbers = new Int32Array([5, -2, 9, 0, 3]);
libc.qsort(numbers, 5, 4, (a, b) => read(a, 'i32') - read(b, 'i32'));   // [-2, 0, 3, 5, 9]
```

- **`callbackType(signature)`** as a parameter type makes a callback for the
  duration of that call.
- **`callback(signature, fn)`** makes one that lasts until
  `releaseCallback(pointer)`, for libraries that keep it.
- **Same thread only.** Native code must call a callback on the thread that
  runs JavaScript, for example during the call it was passed to.

## Memory

| | |
| --- | --- |
| `alloc(size)` / `free(address)` | zeroed C memory |
| `read(address, type, offset?)` / `write(address, type, value, offset?)` | one value |
| `readBytes(address, length)` | a copy as a `Uint8Array` |
| `toCString(text)` / `cstring(address)` | strings to and from C (UTF-8) |
| `sizeof(type)` | bytes a type or struct occupies |

## Limits

- **Platform.** x86-64 only.
- **Call shape.** At most 32 arguments per call. Variadic calls on Linux take
  at most 6 integer and 8 floating arguments.
- **Structs by value.** Arguments and returns of structs by value are not
  supported; pass pointers.
- **Callbacks.** At most 64 live callbacks. A callback's arguments must fit
  the registers plus stack arguments of integer and floating types.
- **Copies.** Buffers and strings are copied for each call.
- **Compiled programs only.** It runs only in programs compiled by reactc.
