// fetch over TCP for reactc programs: an HTTP/1.1 client written on node:net
// and node:tls, so a program controls its own HTTP and nothing is handed to a
// host. Streaming request and response bodies, binary data without a size
// limit, chunked transfer, gzip/deflate/Brotli decoding, redirects, an
// in-memory cookie jar, keep-alive connection reuse, AbortSignal and TLS
// options (fetch(url, { tls: { ca, rejectUnauthorized } })).
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content', 301: 'Moved Permanently',
  302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  409: 'Conflict', 413: 'Payload Too Large', 429: 'Too Many Requests', 500: 'Internal Server Error',
  502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

// --- Headers ----------------------------------------------------------------------

export class Headers {
  constructor(init) {
    this._map = new Map();   // lower-case name -> [values]
    if (!init) return;
    if (init instanceof Headers) { init.forEach((value, name) => this.append(name, value)); return; }
    const entries = Array.isArray(init) ? init : (typeof init[Symbol.iterator] === 'function' ? Array.from(init) : Object.entries(init));
    for (const [name, value] of entries) this.append(name, value);
  }
  append(name, value) {
    const key = String(name).toLowerCase();
    if (!this._map.has(key)) this._map.set(key, []);
    this._map.get(key).push(String(value));
  }
  set(name, value) { this._map.set(String(name).toLowerCase(), [String(value)]); }
  get(name) {
    const values = this._map.get(String(name).toLowerCase());
    return values ? values.join(', ') : null;
  }
  getSetCookie() { return (this._map.get('set-cookie') || []).slice(); }
  has(name) { return this._map.has(String(name).toLowerCase()); }
  delete(name) { this._map.delete(String(name).toLowerCase()); }
  forEach(callback, thisArg) {
    for (const [name, value] of this.entries()) callback.call(thisArg, value, name, this);
  }
  *entries() {
    for (const name of Array.from(this._map.keys()).sort()) {
      if (name === 'set-cookie') for (const value of this._map.get(name)) yield [name, value];
      else yield [name, this.get(name)];
    }
  }
  *keys() { for (const [name] of this.entries()) yield name; }
  *values() { for (const [, value] of this.entries()) yield value; }
  [Symbol.iterator]() { return this.entries(); }
}

// --- bodies -----------------------------------------------------------------------

function bytesOf(body) {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return encoder.encode(String(body));
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

// A request body as bytes, with its default content type.
async function requestBody(body) {
  if (body === undefined || body === null) return { bytes: null, type: null };
  if (typeof body === 'string') return { bytes: encoder.encode(body), type: 'text/plain;charset=UTF-8' };
  if (typeof URLSearchParams === 'function' && body instanceof URLSearchParams) {
    return { bytes: encoder.encode(body.toString()), type: 'application/x-www-form-urlencoded;charset=UTF-8' };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { bytes: bytesOf(body), type: null };
  if (typeof body.getReader === 'function' || typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of iterate(body)) { const bytes = bytesOf(chunk); chunks.push(bytes); total += bytes.length; }
    return { bytes: concat(chunks, total), type: null };
  }
  return { bytes: encoder.encode(String(body)), type: 'text/plain;charset=UTF-8' };
}

async function* iterate(stream) {
  if (typeof stream[Symbol.asyncIterator] === 'function') { yield* stream; return; }
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

// A readable body: chunks pushed by the connection, read once.
class BodyStream {
  constructor() {
    this._chunks = [];
    this._waiters = [];
    this._done = false;
    this._error = null;
    this.locked = false;
  }
  _push(chunk) { this._chunks.push(chunk); this._wake(); }
  _end() { this._done = true; this._wake(); }
  _fail(error) { this._error = error; this._wake(); }
  _wake() { const waiters = this._waiters; this._waiters = []; for (const waiter of waiters) waiter(); }
  async _next() {
    while (!this._chunks.length && !this._done && !this._error) await new Promise(resolve => this._waiters.push(resolve));
    if (this._error) throw this._error;
    if (this._chunks.length) return { done: false, value: this._chunks.shift() };
    return { done: true, value: undefined };
  }
  getReader() {
    if (this.locked) throw new TypeError('ReadableStream is locked');
    this.locked = true;
    return { read: () => this._next(), releaseLock: () => { this.locked = false; }, cancel: async () => { this._end(); } };
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      const { done, value } = await this._next();
      if (done) return;
      yield value;
    }
  }
}

// --- Response ---------------------------------------------------------------------

export class Response {
  constructor(body = null, init = {}) {
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? STATUS_TEXT[this.status] ?? '';
    this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    this.ok = this.status >= 200 && this.status < 300;
    this.url = init.url ?? '';
    this.redirected = Boolean(init.redirected);
    this.type = 'basic';
    this.bodyUsed = false;
    if (body instanceof BodyStream) this._stream = body;
    else {
      this._stream = new BodyStream();
      if (body !== null && body !== undefined) this._stream._push(bytesOf(body));
      this._stream._end();
    }
  }
  get body() { return this._stream; }
  async bytes() {
    if (this.bodyUsed) throw new TypeError('Body has already been consumed');
    this.bodyUsed = true;
    const chunks = [];
    let total = 0;
    for await (const chunk of this._stream) { chunks.push(chunk); total += chunk.length; }
    return concat(chunks, total);
  }
  async arrayBuffer() { const bytes = await this.bytes(); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
  async text() { return decoder.decode(await this.bytes()); }
  async json() { return JSON.parse(await this.text()); }
  clone() { throw new Error('Response.clone is not supported'); }
}

// --- cookies ----------------------------------------------------------------------

const jar = [];   // { name, value, domain, hostOnly, path, expires, secure }

function storeCookies(url, headers) {
  for (const line of headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(';');
    const equals = pair.indexOf('=');
    if (equals <= 0) continue;
    const cookie = { name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim(), domain: url.hostname, hostOnly: true, path: '/', expires: null, secure: false };
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.split('=');
      const name = key.trim().toLowerCase();
      const value = rest.join('=').trim();
      if (name === 'domain' && value) { cookie.domain = value.replace(/^\./, '').toLowerCase(); cookie.hostOnly = false; }
      else if (name === 'path' && value.startsWith('/')) cookie.path = value;
      else if (name === 'max-age') cookie.expires = Date.now() + Number(value) * 1000;
      else if (name === 'expires') cookie.expires = Date.parse(value);
      else if (name === 'secure') cookie.secure = true;
    }
    const index = jar.findIndex(item => item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path);
    if (index >= 0) jar.splice(index, 1);
    if (cookie.expires === null || cookie.expires > Date.now()) jar.push(cookie);
  }
}

function cookieHeader(url) {
  const host = url.hostname.toLowerCase();
  const now = Date.now();
  const matches = jar.filter(cookie =>
    (cookie.expires === null || cookie.expires > now) &&
    (cookie.hostOnly ? host === cookie.domain : host === cookie.domain || host.endsWith('.' + cookie.domain)) &&
    url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === 'https:'));
  return matches.map(cookie => cookie.name + '=' + cookie.value).join('; ');
}

/** Clears the program's cookie jar. */
export function clearCookies() { jar.length = 0; }

// --- connections ------------------------------------------------------------------

const idle = new Map();   // "https:host:port[:tls#n]" -> [socket]
// Requests with their own TLS options (ca, client certificate, verification
// off) never share connections with other requests: a connection verified
// under one set of trust settings must not serve a request with another.
const tlsIds = new WeakMap();
let nextTlsId = 1;
function tlsKey(options) {
  if (!options) return '';
  if (!tlsIds.has(options)) tlsIds.set(options, nextTlsId++);
  return ':tls#' + tlsIds.get(options);
}

function connect(url, options) {
  const secure = url.protocol === 'https:';
  const port = Number(url.port || (secure ? 443 : 80));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const key = (secure ? 'https:' : 'http:') + host + ':' + port + (secure ? tlsKey(options.tls) : '');
  const pool = idle.get(key);
  while (pool && pool.length) {
    const socket = pool.pop();
    if (!socket.destroyed) return Promise.resolve({ socket, key, reused: true });
  }
  return new Promise((resolve, reject) => {
    const tlsOptions = options.tls || {};
    const connectOptions = { host, port, rejectUnauthorized: tlsOptions.rejectUnauthorized !== false };
    if (!net.isIP(host)) connectOptions.servername = host;
    for (const name of ['ca', 'cert', 'key']) if (tlsOptions[name] !== undefined) connectOptions[name] = tlsOptions[name];
    const socket = secure ? tls.connect(connectOptions) : net.connect({ host, port });
    const fail = error => { socket.destroy(); reject(new TypeError('fetch failed: ' + (error && error.message ? error.message : error))); };
    socket.once('error', fail);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      socket.removeListener('error', fail);
      resolve({ socket, key, reused: false });
    });
  });
}

function release(connection) {
  const { socket, key } = connection;
  if (socket.destroyed) return;
  socket.removeAllListeners('data');
  socket.removeAllListeners('end');
  socket.removeAllListeners('close');
  socket.removeAllListeners('error');
  socket.on('error', () => socket.destroy());
  if (typeof socket.unref === 'function') socket.unref();
  if (!idle.has(key)) idle.set(key, []);
  idle.get(key).push(socket);
}

// --- one request ------------------------------------------------------------------

function indexOfCrlfCrlf(bytes) {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) return i;
  }
  return -1;
}

function indexOfCrlf(bytes, from) {
  for (let i = from; i + 1 < bytes.length; i++) if (bytes[i] === 13 && bytes[i + 1] === 10) return i;
  return -1;
}

function decodeBody(bytes, encoding) {
  const name = (encoding || '').trim().toLowerCase();
  if (!name || name === 'identity') return bytes;
  if (name === 'gzip' || name === 'x-gzip') return new Uint8Array(zlib.gunzipSync(bytes));
  if (name === 'deflate') return new Uint8Array(zlib.inflateSync(bytes));
  if (name === 'br') return new Uint8Array(zlib.brotliDecompressSync(bytes));
  throw new TypeError('fetch failed: unsupported content-encoding ' + name);
}

// Sends one request on a connection and resolves with the response as soon as
// its headers arrive; the body streams into response.body.
async function exchange(url, method, headers, body, options) {
  const connection = await connect(url, options);
  const { socket } = connection;
  if (typeof socket.ref === 'function') socket.ref();
  const target = (url.pathname || '/') + (url.search || '');
  let head = `${method} ${target} HTTP/1.1\r\nHost: ${url.host}\r\n`;
  for (const [name, value] of headers.entries()) head += `${name}: ${value}\r\n`;
  head += '\r\n';
  socket.write(encoder.encode(head));
  if (body && body.length) socket.write(body);

  return new Promise((resolve, reject) => {
    let buffered = new Uint8Array(0);
    let response = null, stream = null;
    let mode = null, remaining = 0, encoding = '', keepAlive = true, decoded = [], decodedLength = 0, finished = false;
    let chunkState = 'size';

    const signal = options.signal;
    const onAbort = () => fail(signal.reason ?? abortError());
    if (signal) {
      if (signal.aborted) { socket.destroy(); reject(signal.reason ?? abortError()); return; }
      if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort);
    }

    function cleanupSignal() {
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
    }

    function fail(error) {
      if (finished) return;
      finished = true;
      cleanupSignal();
      socket.destroy();
      if (stream) stream._fail(error);
      else reject(error instanceof Error ? error : new TypeError('fetch failed: ' + error));
    }

    function deliver(bytes) {
      if (!bytes.length) return;
      if (encoding) { decoded.push(bytes); decodedLength += bytes.length; }
      else stream._push(bytes);
    }

    function done() {
      if (finished) return;
      finished = true;
      cleanupSignal();
      if (encoding) {
        try { const whole = decodeBody(concat(decoded, decodedLength), encoding); if (whole.length) stream._push(whole); }
        catch (error) { stream._fail(error); socket.destroy(); return; }
      }
      stream._end();
      if (keepAlive && mode !== 'close') release(connection);
      else socket.destroy();
    }

    function onHeaders(text) {
      const lines = text.split('\r\n');
      const status = /^HTTP\/1\.[01] (\d{3})(?: (.*))?$/.exec(lines[0]);
      if (!status) { fail(new TypeError('fetch failed: bad HTTP response')); return false; }
      const responseHeaders = new Headers();
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');
        if (colon > 0) responseHeaders.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
      }
      const code = Number(status[1]);
      if (code >= 100 && code < 200 && code !== 101) return 'continue';
      stream = new BodyStream();
      response = new Response(stream, { status: code, statusText: status[2] ?? '', headers: responseHeaders, url: url.href });
      keepAlive = (responseHeaders.get('connection') || '').toLowerCase() !== 'close';
      encoding = responseHeaders.get('content-encoding') || '';
      if (method === 'HEAD' || code === 204 || code === 304) mode = 'none';
      else if ((responseHeaders.get('transfer-encoding') || '').toLowerCase().includes('chunked')) mode = 'chunked';
      else if (responseHeaders.has('content-length')) { mode = 'length'; remaining = Number(responseHeaders.get('content-length')); }
      else mode = 'close';
      resolve(response);
      return true;
    }

    function onBody() {
      if (mode === 'none') { done(); return; }
      if (mode === 'length') {
        const take = Math.min(remaining, buffered.length);
        deliver(buffered.slice(0, take));
        buffered = buffered.slice(take);
        remaining -= take;
        if (remaining === 0) done();
        return;
      }
      if (mode === 'close') { deliver(buffered); buffered = new Uint8Array(0); return; }
      // chunked
      while (true) {
        if (chunkState === 'size') {
          const end = indexOfCrlf(buffered, 0);
          if (end < 0) return;
          const size = parseInt(decoder.decode(buffered.slice(0, end)).split(';')[0].trim(), 16);
          buffered = buffered.slice(end + 2);
          if (size === 0) { chunkState = 'trailer'; continue; }
          remaining = size;
          chunkState = 'data';
        } else if (chunkState === 'data') {
          if (buffered.length < remaining + 2) {
            // deliver what is here, keep the CRLF accounting
            if (buffered.length > 0 && buffered.length <= remaining) {
              deliver(buffered); remaining -= buffered.length; buffered = new Uint8Array(0);
            }
            return;
          }
          deliver(buffered.slice(0, remaining));
          buffered = buffered.slice(remaining + 2);
          chunkState = 'size';
        } else {
          const end = indexOfCrlf(buffered, 0);
          if (end < 0) return;
          buffered = buffered.slice(end + 2);
          if (end === 0) { done(); return; }
        }
      }
    }

    socket.on('data', chunk => {
      if (finished) return;
      const bytes = chunk instanceof Uint8Array ? chunk : bytesOf(chunk);
      const merged = new Uint8Array(buffered.length + bytes.length);
      merged.set(buffered, 0);
      merged.set(bytes, buffered.length);
      buffered = merged;
      while (!response) {
        const end = indexOfCrlfCrlf(buffered);
        if (end < 0) return;
        const text = decoder.decode(buffered.slice(0, end));
        buffered = buffered.slice(end + 4);
        const result = onHeaders(text);
        if (result === false) return;
        if (result === 'continue') continue;
      }
      onBody();
    });
    socket.on('end', () => { if (mode === 'close') done(); else if (!finished) fail(new TypeError('fetch failed: connection closed early')); });
    socket.on('close', () => { if (!finished) { if (mode === 'close') done(); else fail(new TypeError('fetch failed: connection closed')); } });
    socket.on('error', error => fail(new TypeError('fetch failed: ' + error.message)));
  });
}

function abortError() {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

// --- fetch ------------------------------------------------------------------------

export class Request {
  constructor(input, init = {}) {
    this.url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    this.method = (init.method ?? input.method ?? 'GET').toUpperCase();
    this.headers = new Headers(init.headers ?? input.headers);
    this.body = init.body ?? input.body ?? null;
    this.redirect = init.redirect ?? input.redirect ?? 'follow';
    this.signal = init.signal ?? input.signal ?? null;
    this.credentials = init.credentials ?? input.credentials ?? 'include';
  }
}

export async function fetch(input, init = {}) {
  const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  let url = new URL(request.url);
  let method = request.method;
  let { bytes: body, type } = await requestBody(request.body);
  const redirectMode = request.redirect;
  const useCookies = request.credentials !== 'omit';
  let redirected = false;
  for (let hops = 0; ; hops++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('fetch failed: unsupported protocol ' + url.protocol);
    const headers = new Headers(request.headers);
    if (!headers.has('accept')) headers.set('accept', '*/*');
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br');
    if (!headers.has('user-agent')) headers.set('user-agent', 'reactc');
    if (!headers.has('connection')) headers.set('connection', 'keep-alive');
    if (type && !headers.has('content-type')) headers.set('content-type', type);
    if (body) headers.set('content-length', String(body.length));
    else if (method === 'POST' || method === 'PUT' || method === 'PATCH') headers.set('content-length', '0');
    if (useCookies) { const cookie = cookieHeader(url); if (cookie && !headers.has('cookie')) headers.set('cookie', cookie); }
    const response = await exchange(url, method, headers, body, { signal: request.signal, tls: init.tls });
    if (useCookies) storeCookies(url, response.headers);
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (redirectMode === 'manual') return response;
      if (redirectMode === 'error') throw new TypeError('fetch failed: redirect mode is "error"');
      if (hops >= 20) throw new TypeError('fetch failed: too many redirects');
      await response.bytes().catch(() => {});
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = null;
        type = null;
      }
      url = new URL(location, url);
      redirected = true;
      continue;
    }
    response.redirected = redirected;
    response.url = url.href;
    return response;
  }
}

export default fetch;
