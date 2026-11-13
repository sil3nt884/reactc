// Values that JSON cannot carry, and a JSON-printable description of them that
// shows whether each type survived a trip between threads.
export function richValue() {
  const value = {
    when: new Date(1700000000000), pattern: /x+/gi, map: new Map([['k', 1n]]), set: new Set([1, 'two']),
    bytes: new Uint8Array([1, 2, 255]), floats: new Float64Array([0.5, NaN]), missing: undefined,
    negativeZero: -0, big: 2n ** 70n, error: new RangeError('bad', { cause: 'why' }), text: 'héllo Ω\nnext',
  };
  value.self = value;
  return value;
}

export function describe(value) {
  return {
    date: value.when instanceof Date && value.when.getTime(),
    pattern: value.pattern instanceof RegExp && String(value.pattern),
    map: value.map instanceof Map && typeof value.map.get('k') === 'bigint' && String(value.map.get('k')),
    set: value.set instanceof Set && [...value.set],
    bytes: value.bytes instanceof Uint8Array && [...value.bytes],
    floats: value.floats instanceof Float64Array && String([...value.floats]),
    missing: 'missing' in value && value.missing === undefined,
    negativeZero: Object.is(value.negativeZero, -0),
    big: String(value.big),
    error: value.error instanceof RangeError && value.error.message + '/' + value.error.cause,
    text: value.text,
    cycle: value.self === value,
  };
}
