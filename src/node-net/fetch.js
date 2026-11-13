// fetch over node:net and node:tls, using HTTP/1.1 or HTTP/2.
import crypto from 'node:crypto';
import net from 'node:net';
import stream from 'node:stream';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { Http2Session, REFUSED_STREAM } from './http2.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
// --- Headers ----------------------------------------------------------------------

export class Headers {
  constructor(init) {
    this._map = new Map();   // lower-case name -> [values]
    if (!init) return;
    if (init instanceof Headers) init = init.entries();
    const entries = Array.isArray(init) ? init : (typeof init[Symbol.iterator] === 'function' ? Array.from(init) : Object.entries(init));
    for (const [name, value] of entries) this.append(name, value);
  }
  append(name, value) {
    const key = headerName(name);
    if (!this._map.has(key)) this._map.set(key, []);
    this._map.get(key).push(headerValue(value));
  }
  set(name, value) { this._map.set(headerName(name), [headerValue(value)]); }
  get(name) {
    const values = this._map.get(headerName(name));
    return values ? values.join(', ') : null;
  }
  getSetCookie() { return (this._map.get('set-cookie') || []).slice(); }
  has(name) { return this._map.has(headerName(name)); }
  delete(name) { this._map.delete(headerName(name)); }
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

function headerName(name) {
  const key = String(name).toLowerCase();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key)) throw new TypeError('Invalid header name');
  return key;
}

function headerValue(value) {
  const text = String(value);
  if (/[\0\r\n]/.test(text)) throw new TypeError('Invalid header value');
  return text.replace(/^[ \t]+|[ \t]+$/g, '');
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

function quoteFormField(value) {
  return String(value).replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');
}

function multipart(body) {
  const boundary = 'reactc-' + crypto.randomBytes(18).toString('hex');
  const parts = [];
  for (const [name, value] of body) {
    let head = '--' + boundary + '\r\nContent-Disposition: form-data; name="' + quoteFormField(name) + '"';
    if (typeof value === 'string') {
      parts.push(head + '\r\n\r\n' + value.replace(/\r\n|\r|\n/g, '\r\n') + '\r\n');
    } else {
      head += '; filename="' + quoteFormField(value.name) + '"\r\nContent-Type: ' + (value.type || 'application/octet-stream');
      parts.push(head + '\r\n\r\n', value, '\r\n');
    }
  }
  parts.push('--' + boundary + '--\r\n');
  return new Blob(parts, { type: 'multipart/form-data; boundary=' + boundary });
}

function findBytes(bytes, needle, from) {
  for (let offset = from; offset <= bytes.length - needle.length; offset++) {
    let index = 0;
    while (index < needle.length && bytes[offset + index] === needle[index]) index++;
    if (index === needle.length) return offset;
  }
  return -1;
}

function parseMultipart(bytes, boundary) {
  const data = new FormData();
  const delimiter = encoder.encode('\r\n--' + boundary);
  const headerEnd = encoder.encode('\r\n\r\n');
  // Include a CRLF before the first boundary so every part uses the same scan.
  bytes = concat([encoder.encode('\r\n'), bytes], bytes.length + 2);
  let start = findBytes(bytes, delimiter, 0);
  while (start >= 0) {
    start += delimiter.length;
    if (bytes[start] === 45 && bytes[start + 1] === 45) return data;
    if (bytes[start] !== 13 || bytes[start + 1] !== 10) break;
    const headersEnd = findBytes(bytes, headerEnd, start + 2);
    if (headersEnd < 0) break;
    const headers = decoder.decode(bytes.subarray(start + 2, headersEnd));
    const disposition = /^content-disposition:\s*form-data([^\r\n]*)/im.exec(headers)?.[1] || '';
    const name = /(?:^|;)\s*name="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1];
    const type = /^content-type:\s*([^\r\n]*)/im.exec(headers)?.[1] || 'application/octet-stream';
    const content = headersEnd + 4;
    let next = findBytes(bytes, delimiter, content);
    while (next >= 0) {
      const after = next + delimiter.length;
      if ((bytes[after] === 45 && bytes[after + 1] === 45) || (bytes[after] === 13 && bytes[after + 1] === 10)) break;
      next = findBytes(bytes, delimiter, after);
    }
    if (name === undefined || next < 0) break;
    const part = bytes.slice(content, next);
    if (filename === undefined) data.append(name, decoder.decode(part));
    else data.append(name, new Blob([part], { type }), filename);
    start = next;
  }
  throw new TypeError('Invalid multipart form body');
}

function extractBody(body) {
  if (body == null) return { source: null, type: null, live: false };
  if (body instanceof FormData) body = multipart(body);
  if (body instanceof Blob) return { source: body, type: body.type || null, live: false };
  if (body instanceof URLSearchParams) {
    return { source: encoder.encode(body.toString()), type: 'application/x-www-form-urlencoded;charset=UTF-8', live: false };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return { source: new Uint8Array(bytesOf(body)), type: null, live: false };
  }
  if (body instanceof ReadableStream) return { source: body, type: null, live: true };
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const iterator = body[Symbol.asyncIterator]();
    const source = new ReadableStream({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(bytesOf(value));
      },
      cancel(reason) { return iterator.return?.(reason); },
    }, { highWaterMark: 0 });
    return { source, type: null, live: true };
  }
  return { source: encoder.encode(String(body)), type: 'text/plain;charset=UTF-8', live: false };
}

function bodyStream(source) {
  if (source === null || source instanceof ReadableStream) return source;
  if (source instanceof Blob) return source.stream();
  return new ReadableStream({
    start(controller) { controller.enqueue(source); controller.close(); },
  });
}

function unusable(body) {
  return body !== null && (body.locked || stream.Readable.isDisturbed(body));
}

class Body {
  get body() { return this._stream; }
  get bodyUsed() { return this._stream !== null && stream.Readable.isDisturbed(this._stream); }
  async bytes() {
    if (unusable(this.body)) throw new TypeError('Body has already been consumed or locked');
    if (this.body === null) return new Uint8Array(0);
    const reader = this.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return concat(chunks, total);
        chunks.push(value);
        total += value.length;
      }
    } finally {
      reader.releaseLock();
    }
  }
  async arrayBuffer() { return (await this.bytes()).buffer; }
  async text() { return decoder.decode(await this.bytes()); }
  async json() { return JSON.parse(await this.text()); }
  async blob() { return new Blob([await this.bytes()], { type: this.headers.get('content-type') || '' }); }
  async formData() {
    const type = this.headers.get('content-type') || '';
    if (/^multipart\/form-data(?:\s*;|$)/i.test(type)) {
      const match = /;\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(type);
      if (!match) throw new TypeError('Missing multipart boundary');
      return parseMultipart(await this.bytes(), match[1] || match[2]);
    }
    if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(type)) {
      throw new TypeError('Body does not have a form content type');
    }
    const data = new FormData();
    for (const [name, value] of new URLSearchParams(await this.text())) data.append(name, value);
    return data;
  }
  _cloneStream() {
    if (unusable(this.body)) throw new TypeError('Body has already been consumed or locked');
    if (this.body === null) return null;
    const [original, clone] = this.body.tee();
    this._stream = original;
    return clone;
  }
}

// Adapt pushed socket chunks to a WHATWG stream. A pull acknowledges HTTP/2
// bytes only when a reader requests them.
class SocketBody {
  constructor(consume, cancel) {
    let wake;
    this.chunks = [];
    this.stream = new ReadableStream({
      start: controller => { this.controller = controller; },
      pull: async controller => {
        if (!this.chunks.length && !this.done) await new Promise(resolve => { wake = resolve; });
        wake = undefined;
        if (this.chunks.length) {
          const chunk = this.chunks.shift();
          controller.enqueue(chunk);
          if (consume) consume(chunk.length);
        }
        if (this.done && !this.chunks.length) controller.close();
      },
      cancel: () => {
        this.chunks.length = 0;
        this._finish();
        if (cancel) cancel();
      },
    }, { highWaterMark: 0 });
    this.wake = () => { if (wake) wake(); };
  }
  _push(chunk) { if (!this.done) { this.chunks.push(chunk); this.wake(); } }
  _finish() {
    this.done = true;
    this.wake();
    const settled = this.settled;
    this.settled = undefined;
    if (settled) settled();
  }
  _end() { this._finish(); }
  _fail(error) {
    if (this.done) return;
    this.chunks.length = 0;
    this.controller.error(error);
    this._finish();
  }
  onSettled(notify) {
    if (this.done) notify();
    else this.settled = notify;
  }
}

export class Response extends Body {
  constructor(body = null, init = {}) {
    super();
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? '';
    this.headers = new Headers(init.headers);
    this.ok = this.status >= 200 && this.status < 300;
    this.url = init.url ?? '';
    this.redirected = Boolean(init.redirected);
    this.type = init.type ?? 'default';
    if (body instanceof SocketBody) {
      this._socketBody = body;
      this._stream = body.stream;
    } else {
      const { source, type } = extractBody(body);
      if (type && !this.headers.has('content-type')) this.headers.set('content-type', type);
      this._stream = bodyStream(source);
    }
  }
  clone() { return new Response(this._cloneStream(), this); }
  static json(data, init = {}) {
    const text = JSON.stringify(data);
    if (text === undefined) throw new TypeError('Data is not JSON serializable');
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new Response(text, { ...init, headers });
  }
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

const idle = new Map();
const http2 = new Map();
const httpsProtocols = ['h2', 'http/1.1'];
const refusedHttp2Stream = new WeakSet();
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

async function connect(url, options) {
  const secure = url.protocol === 'https:';
  const cleartextHttp2 = !secure && options.cleartextHttp2;
  const port = Number(url.port || (secure ? 443 : 80));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const key = url.origin + (secure ? tlsKey(options.tls) : cleartextHttp2 ? ':h2' : '');
  const session = http2.get(key);
  if (session && session.accepting) return session;
  const pool = idle.get(key);
  while (pool && pool.length) {
    const socket = pool.pop();
    if (!socket.destroyed) return { socket, key };
  }
  const socket = await new Promise((resolve, reject) => {
    const tlsOptions = options.tls || {};
    const connectOptions = { host, port, rejectUnauthorized: tlsOptions.rejectUnauthorized !== false };
    if (secure) {
      connectOptions.ALPNProtocols = httpsProtocols;
      connectOptions.minVersion = 'TLSv1.2';
      // RFC 9113 forbids TLS 1.2 renegotiation and non-AEAD cipher suites.
      connectOptions.secureOptions = tls.constants?.SSL_OP_NO_RENEGOTIATION ?? 0x40000000;
      connectOptions.ciphers = 'ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20';
    }
    if (!net.isIP(host)) connectOptions.servername = host;
    for (const name of ['ca', 'cert', 'key']) if (tlsOptions[name] !== undefined) connectOptions[name] = tlsOptions[name];
    const socket = secure ? tls.connect(connectOptions) : net.connect({ host, port });
    const signal = options.signal;
    const cleanup = () => signal?.removeEventListener?.('abort', abort);
    const abort = () => { cleanup(); socket.destroy(); reject(signal.reason ?? abortError()); };
    const fail = error => { cleanup(); socket.destroy(); reject(new TypeError('fetch failed: ' + (error && error.message ? error.message : error))); };
    socket.once('error', fail);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener?.('abort', abort);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      cleanup();
      socket.removeListener('error', fail);
      resolve(socket);
    });
  });
  const useHttp2 = secure ? socket.alpnProtocol === 'h2' : cleartextHttp2;
  if (!useHttp2) return { socket, key };
  const existing = http2.get(key);
  if (existing && existing.accepting) {
    socket.destroy();
    return existing;
  }
  try {
    const session = new Http2Session(socket, () => {
      if (http2.get(key) === session) http2.delete(key);
    });
    http2.set(key, session);
    return session;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function release(connection) {
  const { socket, key } = connection;
  if (socket.destroyed) return;
  socket.removeAllListeners('data');
  socket.removeAllListeners('end');
  socket.removeAllListeners('close');
  socket.removeAllListeners('error');
  socket.removeAllListeners('drain');
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

function responseDecoder(headers, body) {
  const codecs = (headers.get('content-encoding') || '').toLowerCase().split(',').map(value => value.trim()).filter(value => value && value !== 'identity');
  if (!codecs.length || codecs.some(value => !['gzip', 'x-gzip', 'deflate', 'br'].includes(value))) return null;
  const transforms = codecs.reverse().map(value => value === 'br' ? zlib.createBrotliDecompress() : value === 'deflate' ? zlib.createInflate() : zlib.createGunzip());
  const destroy = () => { for (const transform of transforms) transform.destroy(); };
  for (const transform of transforms) transform.on('error', error => {
    body._fail(error);
    destroy();
  });
  const output = transforms[transforms.length - 1];
  output.on('data', chunk => body._push(new Uint8Array(chunk)));
  output.on('end', () => body._end());
  for (let index = 1; index < transforms.length; index++) transforms[index - 1].pipe(transforms[index]);
  const input = transforms[0];
  return {
    write(bytes, callback) { input.write(bytes, callback); },
    end() { input.end(); },
    destroy,
  };
}

// Sends one request on a connection and resolves with the response as soon as
// its headers arrive; the body streams into response.body.
async function exchange(url, method, headers, body, options) {
  const connection = await connect(url, options);
  if (connection instanceof Http2Session) return exchangeHttp2(connection, url, method, headers, body, options.signal);
  const { socket } = connection;
  if (options.signal?.aborted) {
    socket.destroy();
    throw options.signal.reason ?? abortError();
  }
  if (typeof socket.ref === 'function') socket.ref();
  const reader = body instanceof ReadableStream ? body.getReader() : null;
  const target = (url.pathname || '/') + (url.search || '');
  let head = `${method} ${target} HTTP/1.1\r\nHost: ${url.host}\r\n`;
  for (const [name, value] of headers.entries()) head += `${name}: ${value}\r\n`;
  if (reader) head += 'Transfer-Encoding: chunked\r\n';
  head += '\r\n';

  return new Promise((resolve, reject) => {
    let buffered = new Uint8Array(0);
    let response = null, stream = null;
    let mode = null, remaining = 0, decompressor = null, keepAlive = true, finished = false;
    let chunkState = 'size';
    let uploading = reader !== null;
    let resumeUpload;

    const signal = options.signal;
    const onAbort = () => fail(signal.reason ?? abortError());
    if (signal) {
      if (signal.aborted) { socket.destroy(); reject(signal.reason ?? abortError()); return; }
      if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort);
    }

    function cleanupSignal() {
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
    }

    function stopUpload() {
      if (uploading) void reader.cancel().catch(() => {});
      if (resumeUpload) resumeUpload();
    }

    function fail(error) {
      if (finished) return;
      finished = true;
      cleanupSignal();
      stopUpload();
      if (decompressor) decompressor.destroy();
      socket.destroy();
      if (stream) stream._fail(error);
      else reject(error instanceof Error ? error : new TypeError('fetch failed: ' + error));
    }

    function deliver(bytes) {
      if (!bytes.length) return;
      if (decompressor) decompressor.write(bytes);
      else stream._push(bytes);
    }

    function done() {
      if (finished) return;
      finished = true;
      cleanupSignal();
      stopUpload();
      if (decompressor) decompressor.end();
      else stream._end();
      if (keepAlive && mode !== 'close' && !uploading) release(connection);
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
      stream = new SocketBody(undefined, () => {
        if (decompressor) decompressor.destroy();
        if (!finished) { finished = true; cleanupSignal(); stopUpload(); socket.destroy(); }
      });
      keepAlive = (responseHeaders.get('connection') || '').toLowerCase() !== 'close';
      if (method === 'HEAD' || code === 204 || code === 205 || code === 304) mode = 'none';
      else if ((responseHeaders.get('transfer-encoding') || '').toLowerCase().includes('chunked')) mode = 'chunked';
      else if (responseHeaders.has('content-length')) { mode = 'length'; remaining = Number(responseHeaders.get('content-length')); }
      else mode = 'close';
      response = new Response(mode === 'none' ? null : stream, { status: code, statusText: status[2] ?? '', headers: responseHeaders, url: url.href, type: 'basic' });
      if (mode !== 'none') decompressor = responseDecoder(responseHeaders, stream);
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
      try {
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
          if (onHeaders(text) === false) return;
        }
        onBody();
      } catch (error) {
        fail(error);
      }
    });
    socket.on('end', () => { if (mode === 'close') done(); else if (!finished) fail(new TypeError('fetch failed: connection closed early')); });
    socket.on('close', () => { if (!finished) { if (mode === 'close') done(); else fail(new TypeError('fetch failed: connection closed')); } });
    socket.on('error', error => fail(new TypeError('fetch failed: ' + error.message)));
    socket.on('drain', () => { if (resumeUpload) resumeUpload(); });
    if (reader) {
      void (async () => {
        try {
          if (!socket.write(encoder.encode(head))) await new Promise(resolve => { resumeUpload = resolve; });
          while (!finished) {
            const { value, done } = await reader.read();
            if (finished) return;
            if (done) { uploading = false; socket.write(encoder.encode('0\r\n\r\n')); return; }
            const bytes = bytesOf(value);
            if (!bytes.length) continue;
            const prefix = encoder.encode(bytes.length.toString(16) + '\r\n');
            const frame = concat([prefix, bytes, encoder.encode('\r\n')], prefix.length + bytes.length + 2);
            if (!socket.write(frame)) await new Promise(resolve => { resumeUpload = resolve; });
          }
        } catch (error) {
          fail(error);
        } finally {
          reader.releaseLock();
        }
      })();
    } else {
      socket.write(encoder.encode(head));
      if (body && body.length) socket.write(body);
    }
  });
}

function exchangeHttp2(session, url, method, headers, body, signal) {
  return new Promise((resolve, reject) => {
    let id;
    let ended = false;
    let response;
    let status = 0;
    let fields = new Headers();
    let decompressor = null;
    let reader;
    let uploading = false;
    async function upload() {
      if (!reader || uploading) return;
      uploading = true;
      let done, value;
      try {
        do { ({ done, value } = await reader.read()); }
        while (!done && bytesOf(value).length === 0);
        uploading = false;
        if (done) { reader.releaseLock(); reader = undefined; }
        if (!ended) session.upload(id, done ? undefined : bytesOf(value), done);
      } catch (error) {
        uploading = false;
        fail(error);
        session.cancel(id);
      }
    }
    const stream = new SocketBody(
      length => { if (!decompressor) session.acknowledge(id, length); },
      () => { if (decompressor) decompressor.destroy(); finish(); session.cancel(id); },
    );
    function finish() {
      ended = true;
      if (reader) {
        const pending = reader;
        void pending.cancel().catch(() => {}).finally(() => {
          if (reader === pending) { pending.releaseLock(); reader = undefined; }
        });
      }
      signal?.removeEventListener?.('abort', abort);
    }
    function fail(error) {
      if (ended) return;
      finish();
      if (decompressor) decompressor.destroy();
      if (response) stream._fail(error);
      else reject(error);
    }
    function abort() {
      fail(signal.reason ?? abortError());
      if (id !== undefined) session.cancel(id);
    }
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener?.('abort', abort);
    try {
      if (body instanceof ReadableStream) reader = body.getReader();
      id = session.request(url, method, headers, body, {
        upload,
        header(name, value) {
          if (response || ended) return;
          if (name === ':status') status = Number(value);
          else fields.append(name, value);
        },
        headers() {
          if (response || ended) return;
          if (status < 200) { fields = new Headers(); return; }
          const hasBody = method !== 'HEAD' && status !== 204 && status !== 205 && status !== 304;
          if (hasBody) decompressor = responseDecoder(fields, stream);
          response = new Response(hasBody ? stream : null, { status, statusText: '', headers: fields, url: url.href, type: 'basic' });
          resolve(response);
        },
        data(bytes) {
          if (ended) return;
          if (decompressor) {
            decompressor.write(bytes, () => session.acknowledge(id, bytes.length));
          }
          else stream._push(bytes);
        },
        end() {
          if (ended || !response) return;
          const unfinishedUpload = reader !== undefined;
          if (decompressor) decompressor.end();
          else stream._end();
          finish();
          if (unfinishedUpload) session.cancel(id);
        },
        close(code) {
          const error = new TypeError('fetch failed: HTTP/2 stream closed (' + code + ')');
          if (code === REFUSED_STREAM && !response) refusedHttp2Stream.add(error);
          fail(error);
        },
        fail,
      });
      session.flush();
      void upload();
    } catch (error) {
      fail(error);
      if (id !== undefined) session.close(error);
    }
  });
}

function abortError() {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

// --- fetch ------------------------------------------------------------------------

export class Request extends Body {
  constructor(input, init = {}) {
    super();
    this.url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    this.method = (init.method ?? input.method ?? 'GET').toUpperCase();
    this.headers = new Headers(init.headers ?? input.headers);
    const supplied = init.body != null;
    const body = supplied || !(input instanceof Request) ? extractBody(init.body) : input._body;
    this._body = body;
    this.duplex = 'half';
    if (supplied && body.live && init.duplex !== 'half') throw new TypeError('Streaming bodies require duplex: "half"');
    this._stream = supplied || !(input instanceof Request) ? bodyStream(body.source) : input.body;
    if ((this.method === 'GET' || this.method === 'HEAD') && this.body !== null) throw new TypeError('Request with GET/HEAD method cannot have body');
    if (unusable(this.body)) throw new TypeError('Body has already been consumed or locked');
    if (body.type && !this.headers.has('content-type')) this.headers.set('content-type', body.type);
    this.redirect = init.redirect ?? input.redirect ?? 'follow';
    this.signal = init.signal ?? input.signal ?? null;
    this.credentials = init.credentials ?? input.credentials ?? 'include';
  }
  clone() {
    const copy = new Request(this);
    copy._stream = this._cloneStream();
    return copy;
  }
}

export async function fetch(input, init = {}) {
  return fetchRequest(new Request(input, init), init);
}

export function createPageFetch(origin, beginNetworkRequest, updateNetworkStatus) {
  const base = origin ? new URL(origin) : undefined;
  const localhost = base?.hostname === '127.0.0.1' ? new URL(origin.replace('127.0.0.1', 'localhost')).origin : null;
  function checkOrigin(url) {
    if (base && url.origin !== base.origin && url.origin !== localhost) {
      throw new TypeError('Native fetch requires a URL on the configured HTTP origin (' + base.origin + ')');
    }
    if (url.origin === localhost) url.hostname = base.hostname;
  }
  return async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url, base);
    checkOrigin(url);
    request.url = url.href;
    const settled = beginNetworkRequest();
    try {
      const response = await fetchRequest(request, init, checkOrigin, updateNetworkStatus);
      if (settled) response._socketBody ? response._socketBody.onSettled(settled) : settled();
      return response;
    } catch (error) {
      if (settled) settled();
      throw error;
    }
  };
}

async function fetchRequest(request, init, checkOrigin, updateNetworkStatus) {
  let url = new URL(request.url);
  const initialOrigin = url.origin;
  // RFC 9113 requires prior knowledge for HTTP/2 on cleartext origins.
  const priorKnowledge = init.httpVersion === '2';
  let method = request.method;
  if (!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(method) || ['CONNECT', 'TRACE', 'TRACK'].includes(method)) {
    throw new TypeError('Invalid HTTP method');
  }
  if ((method === 'GET' || method === 'HEAD') && request.body != null) throw new TypeError('Request with GET/HEAD method cannot have body');
  if (request.signal?.aborted) throw request.signal.reason ?? abortError();
  const live = request._body.live;
  let body = live ? request.body : request.body === null ? null : await request.bytes();
  const redirectMode = request.redirect;
  const useCookies = request.credentials !== 'omit';
  let redirected = false;
  let retried = false;
  for (let hops = 0; ; hops++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('fetch failed: unsupported protocol ' + url.protocol);
    const headers = new Headers(request.headers);
    for (const name of ['host', 'transfer-encoding', 'content-length', 'upgrade']) headers.delete(name);
    if (!headers.has('accept')) headers.set('accept', '*/*');
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br');
    if (!headers.has('user-agent')) headers.set('user-agent', 'reactc');
    if (!headers.has('connection')) headers.set('connection', 'keep-alive');
    if (body && !live) headers.set('content-length', String(body.length));
    else if (!body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) headers.set('content-length', '0');
    if (useCookies) { const cookie = cookieHeader(url); if (cookie && !headers.has('cookie')) headers.set('cookie', cookie); }
    let response;
    try {
      response = await exchange(url, method, headers, body, {
        signal: request.signal,
        tls: init.tls,
        cleartextHttp2: priorKnowledge && url.origin === initialOrigin,
      });
      if (updateNetworkStatus) updateNetworkStatus(true);
    } catch (error) {
      if (!retried && !(live && body) && refusedHttp2Stream.has(error)) {
        retried = true;
        hops--;
        continue;
      }
      if (updateNetworkStatus && !request.signal?.aborted) updateNetworkStatus(false);
      throw error;
    }
    if (useCookies) storeCookies(url, response.headers);
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (redirectMode === 'manual') return response;
      if (response.body) await response.body.cancel();
      if (redirectMode === 'error') throw new TypeError('fetch failed: redirect mode is "error"');
      if (hops >= 20) throw new TypeError('fetch failed: too many redirects');
      if ((response.status === 303 && method !== 'HEAD') || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = null;
        for (const name of ['content-encoding', 'content-language', 'content-location', 'content-type']) request.headers.delete(name);
      } else if (body && live) {
        throw new TypeError('fetch failed: cannot replay a streaming request body');
      }
      const next = new URL(location, url);
      if (checkOrigin) checkOrigin(next);
      if (next.origin !== url.origin) {
        request.headers.delete('authorization');
        request.headers.delete('cookie');
      }
      url = next;
      redirected = true;
      retried = false;
      continue;
    }
    response.redirected = redirected;
    response.url = url.href;
    return response;
  }
}

export default fetch;
