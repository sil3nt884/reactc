// Structured clone for reactc worker messages. Every thread has its own heap,
// so a message is serialised to a JSON-safe tree, sent as one line and rebuilt
// on the other side, following the HTML structured clone rules that Node's
// postMessage uses: primitives incl. undefined, NaN, -0 and BigInt; plain
// objects and arrays (with holes); Date, RegExp, Map, Set, Error types,
// ArrayBuffer, typed arrays, DataView and boxed primitives; shared and cyclic
// references. Functions, symbols, WeakMap/WeakSet, promises and
// SharedArrayBuffer throw a DataCloneError, as they cannot be copied.
//
// Encoding: JSON strings, booleans, null and finite numbers stand for
// themselves; everything else is an array whose first item is a tag.

const VIEWS = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array,
};
const ERRORS = { Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError };
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function cloneError(message) {
  const error = new Error(message);
  error.name = 'DataCloneError';
  error.code = 25;
  return error;
}

function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? ALPHABET[c & 63] : '=');
  }
  return out;
}

function unbase64(text) {
  const clean = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let bits = 0, count = 0, at = 0;
  for (let i = 0; i < clean.length; i++) {
    bits = (bits << 6) | ALPHABET.indexOf(clean[i]);
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes[at++] = (bits >> count) & 255;
    }
  }
  return bytes;
}

function viewName(value) {
  for (const name in VIEWS) if (value instanceof VIEWS[name]) return name;
  return value instanceof DataView ? 'DataView' : null;
}

function errorName(value) {
  for (const name in ERRORS) if (name !== 'Error' && value instanceof ERRORS[name]) return name;
  return 'Error';
}

function numberCode(value) {
  if (value !== value) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  return '-0';
}

export function serialize(value) {
  const ids = new Map();
  const encode = item => {
    switch (typeof item) {
      case 'string': case 'boolean': return item;
      case 'number': return Number.isFinite(item) && !(item === 0 && 1 / item < 0) ? item : ['N', numberCode(item)];
      case 'undefined': return ['U'];
      case 'bigint': return ['B', item.toString()];
      case 'symbol': throw cloneError(String(item) + ' could not be cloned.');
      case 'function': throw cloneError((item.name || 'function') + ' could not be cloned.');
    }
    if (item === null) return null;
    if (ids.has(item)) return ['R', ids.get(item)];
    const id = ids.size;
    ids.set(item, id);
    if (Array.isArray(item)) {
      let dense = true;
      for (let i = 0; i < item.length; i++) if (!(i in item)) { dense = false; break; }
      if (dense) return ['A', id, ...item.map(encode)];
      const out = ['a', id, item.length];
      for (const key of Object.keys(item)) out.push(key, encode(item[key]));
      return out;
    }
    if (item instanceof Date) return ['D', id, encode(item.getTime())];
    if (item instanceof RegExp) return ['X', id, item.source, item.flags];
    if (item instanceof Map) {
      const out = ['M', id];
      for (const [key, entry] of item) out.push(encode(key), encode(entry));
      return out;
    }
    if (item instanceof Set) {
      const out = ['S', id];
      for (const entry of item) out.push(encode(entry));
      return out;
    }
    if (item instanceof Error) {
      const out = ['E', id, errorName(item), String(item.message ?? '')];
      out.push(typeof item.stack === 'string' ? item.stack : null);
      if ('cause' in item) out.push(encode(item.cause));
      return out;
    }
    if (typeof SharedArrayBuffer === 'function' && item instanceof SharedArrayBuffer) {
      throw cloneError('SharedArrayBuffer cannot be shared between reactc threads: each thread has its own heap.');
    }
    if (item instanceof ArrayBuffer) return ['AB', id, base64(new Uint8Array(item))];
    const view = viewName(item);
    // A view keeps its whole backing buffer and offset, and views of one
    // buffer stay views of one cloned buffer.
    if (view) return ['V', id, view, encode(item.buffer), item.byteOffset, view === 'DataView' ? item.byteLength : item.length];
    if (item instanceof Number) return ['P', id, 'number', encode(item.valueOf())];
    if (item instanceof String) return ['P', id, 'string', item.valueOf()];
    if (item instanceof Boolean) return ['P', id, 'boolean', item.valueOf()];
    if (item instanceof BigInt) return ['P', id, 'bigint', item.valueOf().toString()];
    if (item instanceof WeakMap || item instanceof WeakSet || item instanceof Promise) {
      throw cloneError(Object.prototype.toString.call(item) + ' could not be cloned.');
    }
    const out = ['O', id];
    for (const key of Object.keys(item)) out.push(key, encode(item[key]));
    return out;
  };
  return encode(value);
}

export function deserialize(tree) {
  const objects = [];
  const decode = item => {
    if (!Array.isArray(item)) return item;
    const tag = item[0];
    switch (tag) {
      case 'N': return item[1] === 'NaN' ? NaN : item[1] === 'Infinity' ? Infinity : item[1] === '-Infinity' ? -Infinity : -0;
      case 'U': return undefined;
      case 'B': return BigInt(item[1]);
      case 'R': return objects[item[1]];
    }
    const id = item[1];
    switch (tag) {
      case 'A': {
        const out = [];
        objects[id] = out;
        for (let i = 2; i < item.length; i++) out.push(decode(item[i]));
        return out;
      }
      case 'a': {
        const out = new Array(item[2]);
        objects[id] = out;
        for (let i = 3; i < item.length; i += 2) out[item[i]] = decode(item[i + 1]);
        return out;
      }
      case 'D': return (objects[id] = new Date(decode(item[2])));
      case 'X': return (objects[id] = new RegExp(item[2], item[3]));
      case 'M': {
        const out = new Map();
        objects[id] = out;
        for (let i = 2; i < item.length; i += 2) out.set(decode(item[i]), decode(item[i + 1]));
        return out;
      }
      case 'S': {
        const out = new Set();
        objects[id] = out;
        for (let i = 2; i < item.length; i++) out.add(decode(item[i]));
        return out;
      }
      case 'E': {
        const out = new (ERRORS[item[2]] || Error)(item[3]);
        objects[id] = out;
        if (item[4] !== null) out.stack = item[4];
        if (item.length > 5) {
          Object.defineProperty(out, 'cause', { value: decode(item[5]), writable: true, enumerable: false, configurable: true });
        }
        return out;
      }
      case 'AB': return (objects[id] = unbase64(item[2]).buffer);
      case 'V': {
        const buffer = decode(item[3]);
        const View = item[2] === 'DataView' ? DataView : VIEWS[item[2]];
        return (objects[id] = new View(buffer, item[4], item[5]));
      }
      case 'P': {
        const kind = item[2];
        const primitive = kind === 'number' ? decode(item[3]) : kind === 'bigint' ? BigInt(item[3]) : item[3];
        return (objects[id] = Object(primitive));
      }
      case 'O': {
        const out = {};
        objects[id] = out;
        for (let i = 2; i < item.length; i += 2) out[item[i]] = decode(item[i + 1]);
        return out;
      }
    }
    throw cloneError('unknown structured clone tag ' + tag);
  };
  return decode(tree);
}

// One message as a line of text; JSON escapes any newline inside strings.
export function encodeMessage(value, advanced) {
  return JSON.stringify(advanced ? serialize(value) : value) + '\n';
}

export function decodeMessage(line, advanced) {
  const parsed = JSON.parse(line);
  return advanced ? deserialize(parsed) : parsed;
}
