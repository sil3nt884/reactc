// Checks reactc's worker message codec (src/node-threads/clone.js) against
// Node's own structuredClone: both clones of every value must have the same
// fingerprint, and values that cannot be cloned must throw DataCloneError in
// both.
//
// The fingerprint is a SHA-256 of a canonical description of the whole value
// graph: types and prototypes, -0/NaN/invalid dates, holes, non-enumerable
// error causes, buffer bytes and view offsets, and shared or cyclic references
// numbered in visit order. It does not depend on how a Node version defines
// deep equality.
//
//   node scripts/check-thread-clone.mjs
import { createHash } from 'node:crypto';
import { decodeMessage, encodeMessage } from '../src/node-threads/clone.js';

const roundTrip = value => decodeMessage(encodeMessage(value, true), true);
const cyclic = { name: 'loop' };
cyclic.self = cyclic;
const shared = { shared: true };
const sparse = [1, , 3];
sparse.length = 5;
const caused = new RangeError('outer', { cause: new TypeError('inner') });
const bytes = new Uint8Array([0, 1, 2, 250, 255]);

const values = {
  primitives: [1, -0, NaN, Infinity, -Infinity, 'text ünïcode Ω\nline', true, null, undefined, 123456789012345678901234567890n],
  object: { a: 1, nested: { b: [1, 2, { c: 'd' }] }, 'odd key': undefined },
  sparse,
  date: new Date(1700000000000),
  invalidDate: new Date(NaN),
  regexp: /a+b?/giu,
  map: new Map([[1, 'one'], ['two', { 2: true }], [{ key: 'object' }, [3]]]),
  set: new Set([1, 'a', { b: 2 }]),
  error: new Error('plain'),
  caused,
  buffer: bytes.buffer.slice(0),
  bytes,
  floats: new Float64Array([1.5, -2.25, NaN]),
  bigints: new BigInt64Array([-1n, 2n ** 62n]),
  offsetView: new Uint16Array(new Uint8Array([9, 9, 1, 0, 2, 0]).buffer, 2, 2),
  dataView: new DataView(new Uint8Array([1, 2, 3]).buffer),
  boxed: [Object(1), Object('s'), Object(false), Object(5n)],
  nodeBuffer: Buffer.from('héllo'),
  classInstance: new (class Point { constructor() { this.x = 1; } })(),
};

const VIEWS = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView];
// Not Buffer: allocating one can change Node's shared pool, which backs
// Buffer.from values under test.
const hex = (buffer, offset = 0, length = buffer.byteLength) =>
  Array.from(new Uint8Array(buffer, offset, length), byte => byte.toString(16).padStart(2, '0')).join('');

function describe(value) {
  const ids = new Map();
  const walk = item => {
    switch (typeof item) {
      case 'number': return Object.is(item, -0) ? 'num:-0' : 'num:' + String(item);
      case 'string': return 'str:' + JSON.stringify(item);
      case 'boolean': case 'undefined': return typeof item + ':' + String(item);
      case 'bigint': return 'big:' + item.toString();
      case 'symbol': case 'function': return typeof item;
    }
    if (item === null) return 'null';
    if (ids.has(item)) return 'ref#' + ids.get(item);
    const id = ids.size;
    ids.set(item, id);
    const tag = '#' + id + ' ' + Object.prototype.toString.call(item) + ' proto=' +
      (Object.getPrototypeOf(item)?.constructor?.name ?? 'null');
    const own = () => Object.keys(item).map(key => JSON.stringify(key) + '=' + walk(item[key])).join(',');
    if (Array.isArray(item)) {
      const slots = [];
      for (let i = 0; i < item.length; i++) slots.push(i in item ? walk(item[i]) : 'hole');
      return tag + ' len=' + item.length + ' [' + slots.join(',') + ']';
    }
    if (item instanceof Date) { const time = item.getTime(); return tag + ' time=' + (Number.isNaN(time) ? 'invalid' : time); }
    if (item instanceof RegExp) return tag + ' ' + item.source + '/' + item.flags + ' lastIndex=' + item.lastIndex;
    if (item instanceof Map) return tag + ' {' + [...item].map(([key, entry]) => walk(key) + '=>' + walk(entry)).join(',') + '}';
    if (item instanceof Set) return tag + ' {' + [...item].map(walk).join(',') + '}';
    if (item instanceof Error) {
      const cause = Object.getOwnPropertyDescriptor(item, 'cause');
      return tag + ' name=' + item.name + ' message=' + JSON.stringify(item.message) + ' stack=' + JSON.stringify(item.stack) +
        (cause ? ' cause(' + (cause.enumerable ? 'enumerable' : 'hidden') + ')=' + walk(cause.value) : '') + ' own={' + own() + '}';
    }
    if (item instanceof ArrayBuffer) return tag + ' bytes=' + hex(item);
    if (VIEWS.some(View => item instanceof View)) {
      return tag + ' offset=' + item.byteOffset + ' length=' + item.byteLength + ' view=' + hex(item.buffer, item.byteOffset, item.byteLength) +
        ' buffer=' + walk(item.buffer);
    }
    if (item instanceof Number || item instanceof String || item instanceof Boolean || item instanceof BigInt) {
      return tag + ' boxed=' + walk(item.valueOf());
    }
    return tag + ' {' + own() + '}';
  };
  return walk(value);
}
const fingerprint = value => createHash('sha256').update(describe(value)).digest('hex');

let failed = 0;
const check = (name, ok) => {
  if (!ok) { failed++; console.log(`FAIL ${name}`); }
};
// References: identity inside one message is kept (the fingerprint numbers
// them), across messages it is not.
const mapLoop = new Map();
mapLoop.set('me', mapLoop);
const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
Object.assign(values, {
  cycle: cyclic,
  sharedReference: { first: shared, second: shared, list: [shared] },
  mapCycle: mapLoop,
  viewsOfOneBuffer: { whole: new Uint8Array(backing), part: new Uint16Array(backing, 2, 2), view: new DataView(backing, 4, 4) },
});
for (const [name, value] of Object.entries(values)) {
  // each value is cloned once by each side, before anything else runs
  const oursClone = roundTrip(value);
  const nodeClone = structuredClone(value);
  const same = fingerprint(oursClone) === fingerprint(nodeClone);
  check(name, same);
  if (!same) console.log(`  reactc: ${describe(oursClone).slice(0, 400)}\n  node:   ${describe(nodeClone).slice(0, 400)}`);
}
check('fresh objects', roundTrip(cyclic) !== cyclic);

// Uncloneable values throw DataCloneError, like Node.
for (const [name, value] of Object.entries({
  function: { run() {} }, symbol: Symbol('s'), weakMap: new WeakMap(), promise: Promise.resolve(), shared: new SharedArrayBuffer(4),
})) {
  let ours = null, node = null;
  try { roundTrip(value); } catch (error) { ours = error.name; }
  try { structuredClone(value); } catch (error) { node = error.name; }
  // Node shares a SharedArrayBuffer; reactc threads have separate heaps.
  check(`throws ${name}`, ours === 'DataCloneError' && (node === 'DataCloneError' || name === 'shared'));
}

// Default fork serialisation stays Node's JSON.
check('json mode', decodeMessage(encodeMessage({ a: [1, 'b'] }, false), false).a[1] === 'b');
check('one line', !encodeMessage({ text: 'a\nb\r ' }, true).slice(0, -1).includes('\n'));

console.log(failed ? `${failed} clone checks failed` : 'PASS: worker message clone matches structuredClone');
process.exit(failed ? 1 : 0);
