// @reactc/native: call functions in native libraries (anything with a C ABI:
// C, and C-exported Rust, Zig, Go or C++) from reactc programs. Signatures
// are declared in JavaScript, at runtime; JS numbers, BigInts, booleans,
// strings, typed arrays and plain objects (as C structs) are converted for
// each call. The native side is src/reactc-ffi.h (Porffor inline C below).

// --- native bridge ----------------------------------------------------------

function cOpen(pathAddressHi, pathAddressLo) {
  let ok = 0;
  Porffor.c`{ const uint64_t path = REACTC_U64(pathAddressHi, pathAddressLo); reactc_ffi_result = reactc_ffi_open((const char *)(uintptr_t)path); ok = reactc_ffi_result ? 1 : 0; }`;
  return ok;
}

function cSymbol(libraryHi, libraryLo, nameHi, nameLo) {
  let ok = 0;
  Porffor.c`{ const uint64_t library = REACTC_U64(libraryHi, libraryLo); const uint64_t name = REACTC_U64(nameHi, nameLo); reactc_ffi_result = reactc_ffi_symbol(library, (const char *)(uintptr_t)name); ok = reactc_ffi_result ? 1 : 0; }`;
  return ok;
}

function cBegin() {
  Porffor.c`reactc_ffi_begin();`;
}

function cPushBits(hi, lo, floating) {
  let ok = 0;
  Porffor.c`ok = (f64)reactc_ffi_push(REACTC_U64(hi, lo), (int)REACTC_NUM(floating));`;
  return ok;
}

function cPushDouble(value) {
  let ok = 0;
  Porffor.c`ok = (f64)reactc_ffi_push(reactc_ffi_bits_of(REACTC_NUM(value)), 1);`;
  return ok;
}

function cCall(fnHi, fnLo, returnsFloat, variadic) {
  let ok = 0;
  Porffor.c`ok = (f64)reactc_ffi_call(REACTC_U64(fnHi, fnLo), (int)REACTC_NUM(returnsFloat), (int)REACTC_NUM(variadic));`;
  return ok;
}

function cResultHi() {
  let out = 0;
  Porffor.c`out = (f64)(uint32_t)(reactc_ffi_result >> 32);`;
  return out;
}

function cResultLo() {
  let out = 0;
  Porffor.c`out = (f64)(uint32_t)reactc_ffi_result;`;
  return out;
}

function cResultDouble() {
  let out = 0;
  Porffor.c`out = reactc_ffi_double_of(reactc_ffi_result);`;
  return out;
}

function cResultFloat32() {
  let out = 0;
  Porffor.c`{ const uint32_t bits = (uint32_t)reactc_ffi_result; float value; memcpy(&value, &bits, 4); out = (f64)value; }`;
  return out;
}

function cAlloc(size) {
  Porffor.c`reactc_ffi_result = reactc_ffi_alloc((uint64_t)REACTC_NUM(size));`;
}

function cFree(hi, lo) {
  Porffor.c`reactc_ffi_free(REACTC_U64(hi, lo));`;
}

function cRead(hi, lo, kind) {
  Porffor.c`reactc_ffi_result = reactc_ffi_read(REACTC_U64(hi, lo), (int)REACTC_NUM(kind));`;
}

function cWriteBits(hi, lo, kind, valueHi, valueLo) {
  Porffor.c`reactc_ffi_write(REACTC_U64(hi, lo), (int)REACTC_NUM(kind), REACTC_U64(valueHi, valueLo));`;
}

function cWriteDouble(hi, lo, kind, value) {
  Porffor.c`reactc_ffi_write(REACTC_U64(hi, lo), (int)REACTC_NUM(kind), reactc_ffi_bits_of(REACTC_NUM(value)));`;
}

function cStrlen(hi, lo) {
  Porffor.c`reactc_ffi_result = reactc_ffi_strlen(REACTC_U64(hi, lo));`;
}

function cErrorLength() {
  let out = 0;
  Porffor.c`out = (f64)strlen(reactc_ffi_error);`;
  return out;
}

function cErrorByte(position) {
  let out = 0;
  Porffor.c`out = (f64)(unsigned char)reactc_ffi_error[(int)REACTC_NUM(position)];`;
  return out;
}

function cSetDispatcher(fn) {
  Porffor.c`reactc_ffi_js_dispatch = fn;`;
}

function cWindowsAbi() {
  let out = 0;
  Porffor.c`out = (f64)reactc_ffi_windows_abi();`;
  return out;
}

function cCallbackAddress(slot) {
  Porffor.c`reactc_ffi_result = reactc_ffi_callback_address((int)REACTC_NUM(slot));`;
}

function cCallbackSlot() {
  let out = 0;
  Porffor.c`out = (f64)reactc_ffi_callback_slot();`;
  return out;
}

function cCallbackFrame(position) {
  Porffor.c`reactc_ffi_result = reactc_ffi_callback_frame((int)REACTC_NUM(position));`;
}

function cCallbackStack(position) {
  Porffor.c`reactc_ffi_result = reactc_ffi_callback_stack((int)REACTC_NUM(position));`;
}

function cCallbackReturn(hi, lo, floating) {
  Porffor.c`reactc_ffi_callback_return(REACTC_U64(hi, lo), (int)REACTC_NUM(floating));`;
}

// Compiled by reactc the bridge works; under plain Node Porffor.c is not
// defined and nothing native can be called.
const compiled = (() => {
  try { cBegin(); return true; } catch { return false; }
})();

function requireCompiled() {
  if (!compiled) throw new Error('@reactc/native calls native code, so it runs only in programs compiled by reactc');
}

// --- values -------------------------------------------------------------------

const TWO32 = 4294967296;

function split(bits) {
  const value = BigInt.asUintN(64, bits);
  return [Number(value >> 32n), Number(value & 0xffffffffn)];
}

function resultBits() {
  return (BigInt(cResultHi()) << 32n) | BigInt(cResultLo());
}

function lastError() {
  let text = '';
  const length = cErrorLength();
  for (let i = 0; i < length; i++) text += String.fromCharCode(cErrorByte(i));
  return text;
}

export class NativeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NativeError';
  }
}

// read/write kinds in reactc-ffi.h
const KIND = { i8: 1, u8: 2, bool: 2, i16: 3, u16: 4, i32: 5, u32: 6, i64: 7, u64: 7, isize: 7, usize: 7, pointer: 7, cstring: 7, f32: 8, f64: 9 };
const SIZE = { i8: 1, u8: 1, bool: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, isize: 8, usize: 8, pointer: 8, cstring: 8, f32: 4, f64: 8 };

function isStruct(type) {
  return type instanceof StructType;
}

/** Bytes a value of `type` occupies in C memory. */
export function sizeof(type) {
  if (isStruct(type)) return type.size;
  const size = SIZE[type];
  if (!size) throw new TypeError('unknown native type: ' + type);
  return size;
}

function alignof(type) {
  return isStruct(type) ? type.align : SIZE[type];
}

function toBits(type, value) {
  switch (type) {
    case 'bool': return value ? 1n : 0n;
    case 'i64': case 'u64': case 'isize': case 'usize':
      return BigInt.asUintN(64, typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value))));
    case 'pointer': case 'cstring': case 'buffer':
      if (value === null || value === undefined) return 0n;
      return BigInt.asUintN(64, typeof value === 'bigint' ? value : BigInt(value));
    default:
      return BigInt.asUintN(64, BigInt(Math.trunc(Number(value))));
  }
}

function fromBits(type, bits) {
  switch (type) {
    case 'void': return undefined;
    case 'bool': return (bits & 0xffn) !== 0n;
    case 'i8': return Number(BigInt.asIntN(8, bits));
    case 'u8': return Number(BigInt.asUintN(8, bits));
    case 'i16': return Number(BigInt.asIntN(16, bits));
    case 'u16': return Number(BigInt.asUintN(16, bits));
    case 'i32': return Number(BigInt.asIntN(32, bits));
    case 'u32': return Number(BigInt.asUintN(32, bits));
    case 'i64': case 'isize': return BigInt.asIntN(64, bits);
    case 'u64': case 'usize': case 'pointer': return BigInt.asUintN(64, bits);
    default: throw new TypeError('unknown native type: ' + type);
  }
}

// --- memory ---------------------------------------------------------------------

/** Allocates `size` zeroed bytes of C memory; returns its address (BigInt). */
export function alloc(size) {
  requireCompiled();
  cAlloc(size);
  const address = resultBits();
  if (address === 0n) throw new NativeError('out of memory');
  return address;
}

/** Frees memory from alloc() or toCString(). */
export function free(address) {
  requireCompiled();
  if (!address) return;
  const [hi, lo] = split(address);
  cFree(hi, lo);
}

/** Reads a value of `type` at address + offset. */
export function read(address, type, offset = 0) {
  requireCompiled();
  if (isStruct(type)) return type.read(address + BigInt(offset));
  const [hi, lo] = split(address + BigInt(offset));
  cRead(hi, lo, KIND[type]);
  if (type === 'f32' || type === 'f64') return cResultDouble();
  if (type === 'cstring') return cstring(resultBits());
  return fromBits(type, resultBits());
}

/** Writes `value` as `type` at address + offset. */
export function write(address, type, value, offset = 0) {
  requireCompiled();
  if (isStruct(type)) { type.write(address + BigInt(offset), value); return; }
  const [hi, lo] = split(address + BigInt(offset));
  if (type === 'f32' || type === 'f64') { cWriteDouble(hi, lo, KIND[type], Number(value)); return; }
  const [vh, vl] = split(toBits(type, value));
  cWriteBits(hi, lo, KIND[type], vh, vl);
}

function utf8(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) { code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00); i++; }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

function fromUtf8(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let code, extra;
    if (b < 0x80) { code = b; extra = 0; } else if (b < 0xe0) { code = b & 31; extra = 1; } else if (b < 0xf0) { code = b & 15; extra = 2; } else { code = b & 7; extra = 3; }
    i++;
    for (let k = 0; k < extra && i < bytes.length; k++, i++) code = (code << 6) | (bytes[i] & 63);
    text += code > 0xffff ? String.fromCharCode(0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 1023)) : String.fromCharCode(code);
  }
  return text;
}

/** Copies a JS string into new C memory as NUL-terminated UTF-8. Free it with free(). */
export function toCString(text) {
  const bytes = utf8(String(text));
  const address = alloc(bytes.length + 1);
  for (let i = 0; i < bytes.length; i++) write(address, 'u8', bytes[i], i);
  return address;
}

/** Reads a NUL-terminated UTF-8 string at address (null for a null pointer). */
export function cstring(address) {
  requireCompiled();
  if (!address) return null;
  const [hi, lo] = split(address);
  cStrlen(hi, lo);
  const length = Number(resultBits());
  const bytes = new Array(length);
  for (let i = 0; i < length; i++) bytes[i] = read(address, 'u8', i);
  return fromUtf8(bytes);
}

/** Copies `length` bytes at address into a new Uint8Array. */
export function readBytes(address, length) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = read(address, 'u8', i);
  return out;
}

function bytesOf(view) {
  if (view instanceof Uint8Array) return view;
  if (view instanceof ArrayBuffer) return new Uint8Array(view);
  if (ArrayBuffer.isView(view)) return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  throw new TypeError('expected a typed array or ArrayBuffer');
}

// --- structs ----------------------------------------------------------------------

/** A C struct layout: struct({ x: 'f64', y: 'f64', name: 'cstring' }). Plain
 * JS objects passed where this type is expected are laid out in C memory. */
export class StructType {
  constructor(fields) {
    this.fields = [];
    let offset = 0;
    let align = 1;
    for (const name of Object.keys(fields)) {
      const type = fields[name];
      const fieldAlign = alignof(type);
      offset = Math.ceil(offset / fieldAlign) * fieldAlign;
      this.fields.push({ name, type, offset });
      offset += sizeof(type);
      if (fieldAlign > align) align = fieldAlign;
    }
    this.align = align;
    this.size = Math.ceil(offset / align) * align || align;
  }

  /** Writes `object`'s fields at address. cstring fields allocate copies,
   * returned so the caller can free them. */
  write(address, object, owned = []) {
    for (const field of this.fields) {
      const value = object[field.name];
      if (field.type === 'cstring' && typeof value === 'string') {
        const copy = toCString(value);
        owned.push(copy);
        write(address, 'pointer', copy, field.offset);
      } else if (isStruct(field.type)) {
        field.type.write(address + BigInt(field.offset), value ?? {}, owned);
      } else {
        write(address, field.type, value ?? 0, field.offset);
      }
    }
    return owned;
  }

  /** Reads a struct at address into a new plain object. */
  read(address, into = {}) {
    for (const field of this.fields) into[field.name] = read(address, field.type, field.offset);
    return into;
  }

  /** Allocates C memory holding `object` (free it with free()). */
  alloc(object = {}) {
    const address = alloc(this.size);
    this.write(address, object);
    return address;
  }
}

export function struct(fields) {
  return new StructType(fields);
}

// --- calls ------------------------------------------------------------------------

function normalise(signature) {
  if (Array.isArray(signature)) return { returns: signature[0] ?? 'void', args: signature[1] ?? [], variadic: false };
  return { returns: signature.returns ?? 'void', args: signature.args ?? [], variadic: Boolean(signature.variadic) };
}

function pushArgument(type, value, cleanups) {
  if (type === 'f64') return cPushDouble(Number(value));
  if (type === 'f32') {
    const scratch = new DataView(new ArrayBuffer(4));
    scratch.setFloat32(0, Number(value), true);
    return cPushBits(0, scratch.getUint32(0, true), 1);
  }
  let bits;
  if (type instanceof CallbackType) {
    if (typeof value === 'function') {
      const pointer = callback(type.signature, value);
      cleanups.push(() => releaseCallback(pointer));
      bits = pointer;
    } else {
      bits = toBits('pointer', value);
    }
  } else if (type === 'cstring' && typeof value === 'string') {
    const copy = toCString(value);
    cleanups.push(() => free(copy));
    bits = copy;
  } else if ((type === 'buffer' || type === 'pointer') && value !== null && typeof value === 'object' && (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)) {
    // copied into C memory for the call, and back afterwards (C may write it)
    const bytes = bytesOf(value);
    const copy = alloc(bytes.length);
    for (let i = 0; i < bytes.length; i++) write(copy, 'u8', bytes[i], i);
    cleanups.push(() => { for (let i = 0; i < bytes.length; i++) bytes[i] = read(copy, 'u8', i); free(copy); });
    bits = copy;
  } else if (isStruct(type) || (type === 'pointer' && value !== null && typeof value === 'object' && value.__struct)) {
    // a JS object laid out as the struct; changes C makes are read back
    const layout = isStruct(type) ? type : value.__struct;
    const object = value ?? {};
    const copy = alloc(layout.size);
    const owned = layout.write(copy, object);
    cleanups.push(() => { layout.read(copy, object); for (const extra of owned) free(extra); free(copy); });
    bits = copy;
  } else {
    bits = toBits(type, value);
  }
  const [hi, lo] = split(bits);
  return cPushBits(hi, lo, 0);
}

// --- callbacks: native code calling JavaScript ---------------------------------------

const CALLBACK_SLOTS = 64;
const callbacks = new Array(CALLBACK_SLOTS).fill(null);
let dispatcherSet = false;
const scratch = new DataView(new ArrayBuffer(8));

function doubleOf(bits) {
  scratch.setBigUint64(0, BigInt.asUintN(64, bits), true);
  return scratch.getFloat64(0, true);
}

function float32Of(bits) {
  scratch.setUint32(0, Number(bits & 0xffffffffn), true);
  return scratch.getFloat32(0, true);
}

function decode(type, bits) {
  if (type === 'f64') return doubleOf(bits);
  if (type === 'f32') return float32Of(bits);
  if (type === 'cstring') return cstring(bits);
  if (isStruct(type)) return type.read(bits);
  return fromBits(type, bits);
}

function encode(type, value) {
  if (type === 'f64') { scratch.setFloat64(0, Number(value), true); return scratch.getBigUint64(0, true); }
  if (type === 'f32') { scratch.setFloat32(0, Number(value), true); return BigInt(scratch.getUint32(0, true)); }
  if (type === 'void') return 0n;
  return toBits(type, value);
}

// Called by reactc_ffi_dispatch (C) for every callback invocation: decodes
// the arguments from the saved registers and stack by the signature.
function dispatch() {
  const entry = callbacks[cCallbackSlot()];
  if (!entry) return;
  const windows = cWindowsAbi() === 1;
  const values = [];
  let ints = 0, floats = 0, stacked = 0;
  for (let i = 0; i < entry.args.length; i++) {
    const type = entry.args[i];
    const floating = type === 'f32' || type === 'f64';
    if (windows) {
      if (i < 4) cCallbackFrame(floating ? 4 + i : i);
      else cCallbackStack(i - 4);
    } else if (floating) {
      if (floats < 8) cCallbackFrame(6 + floats++);
      else cCallbackStack(stacked++);
    } else if (ints < 6) cCallbackFrame(ints++);
    else cCallbackStack(stacked++);
    values.push(decode(type, resultBits()));
  }
  const result = entry.fn(...values);
  const floating = entry.returns === 'f32' || entry.returns === 'f64';
  const [hi, lo] = split(encode(entry.returns, result));
  cCallbackReturn(hi, lo, floating ? 1 : 0);
}

/** Makes a C function pointer that calls `fn`:
 *
 *   const compare = callback({ args: ['pointer', 'pointer'], returns: 'i32' }, (a, b) => ...);
 *
 * It stays valid until releaseCallback(pointer); at most 64 exist at once.
 * Native code must call it on the thread running JavaScript, for example
 * during the native call it was passed to. */
export function callback(signature, fn) {
  requireCompiled();
  if (typeof fn !== 'function') throw new TypeError('callback needs a function');
  if (!dispatcherSet) { cSetDispatcher(dispatch); dispatcherSet = true; }
  const slot = callbacks.indexOf(null);
  if (slot < 0) throw new NativeError('at most 64 callbacks may exist at once; release some with releaseCallback()');
  const { returns, args } = normalise(signature);
  callbacks[slot] = { fn, args, returns };
  cCallbackAddress(slot);
  return resultBits();
}

/** Frees a callback made by callback(). */
export function releaseCallback(address) {
  cCallbackAddress(0);
  const slot = Number((BigInt(address) - resultBits()) / 16n);
  if (slot >= 0 && slot < CALLBACK_SLOTS) callbacks[slot] = null;
}

/** A parameter type for a function pointer: pass a JS function directly and
 * it is turned into a C callback for the duration of that call. */
export class CallbackType {
  constructor(signature) { this.signature = signature; }
}

export function callbackType(signature) {
  return new CallbackType(signature);
}

/** Makes a JS function that calls the native function at `address`. */
export function func(address, signature, name = 'native function') {
  requireCompiled();
  const { returns, args, variadic } = normalise(signature);
  const [fnHi, fnLo] = split(address);
  const returnsFloat = returns === 'f32' || returns === 'f64' ? 1 : 0;
  return function (...values) {
    if (!variadic && values.length !== args.length) {
      throw new TypeError(`${name} takes ${args.length} argument${args.length === 1 ? '' : 's'}, got ${values.length}`);
    }
    const cleanups = [];
    try {
      cBegin();
      for (let i = 0; i < values.length; i++) {
        // extra variadic arguments: numbers are doubles, BigInts are 64-bit integers
        const type = i < args.length ? args[i] : (typeof values[i] === 'number' && !Number.isInteger(values[i]) ? 'f64' : typeof values[i] === 'string' ? 'cstring' : 'i64');
        if (!pushArgument(type, values[i], cleanups)) throw new NativeError(`${name}: at most 32 arguments`);
      }
      if (!cCall(fnHi, fnLo, returnsFloat, variadic ? 1 : 0)) throw new NativeError(`${name}: ${lastError()}`);
      if (returns === 'f64') return cResultDouble();
      if (returns === 'f32') return cResultFloat32();
      if (returns === 'cstring') return cstring(resultBits());
      if (isStruct(returns)) return returns.read(resultBits());   // a returned struct pointer, read into an object
      return fromBits(returns, resultBits());
    } finally {
      for (const cleanup of cleanups) cleanup();
    }
  };
}

/** Opens a native library and binds the named functions:
 *
 *   const m = library('libm.so.6', { cos: { args: ['f64'], returns: 'f64' } });
 *   m.cos(0)   // 1
 *
 * `path` is a file name or path ('' for the program itself, which on Linux
 * includes libc). Signatures are { args, returns, variadic } or [returns, args].
 * The returned object also has symbol(name) for raw addresses. */
export function library(path, signatures = {}) {
  requireCompiled();
  const pathCopy = toCString(path);
  const [ph, pl] = split(pathCopy);
  const opened = cOpen(ph, pl);
  free(pathCopy);
  if (!opened) throw new NativeError(lastError());
  const handle = resultBits();
  const [lh, ll] = split(handle);
  const symbol = name => {
    const nameCopy = toCString(name);
    const [nh, nl] = split(nameCopy);
    const found = cSymbol(lh, ll, nh, nl);
    free(nameCopy);
    if (!found) throw new NativeError(lastError());
    return resultBits();
  };
  const bound = { handle, path, symbol };
  for (const name of Object.keys(signatures)) bound[name] = func(symbol(name), signatures[name], name);
  return bound;
}

/** The C pointer size and the system's native library suffix. */
export const platform = {
  pointerSize: 8,
  suffix: typeof process !== 'undefined' && process.platform === 'win32' ? '.dll' : '.so',
};

export default { library, func, struct, StructType, callback, releaseCallback, callbackType, CallbackType, alloc, free, read, write, readBytes, toCString, cstring, sizeof, NativeError, platform };
