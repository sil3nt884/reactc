import { callGatewayAsync, updateNativeNetworkStatus } from './page-runtime.js';

// Native fetch for reactc apps. The host performs the request for the
// configured origin; nothing runs in a browser. Supported: every standard
// method, request headers (including Authorization), text, JSON and
// URL-encoded bodies, and response status, headers and text bodies.

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
// Headers a browser controls itself; the host sets these.
const FORBIDDEN = /^(?:accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie2|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*)$/;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const REQUEST_BODY_LIMIT = 65536;
const HEADER_LIMIT = 8192;

function headerName(name) {
  const text = String(name);
  if (!TOKEN.test(text)) throw new TypeError('Invalid header name: ' + text);
  return text.toLowerCase();
}

function headerValue(value) {
  const text = String(value).trim();
  if (/[\0\r\n]/.test(text)) throw new TypeError('Invalid header value');
  return text;
}

export class Headers {
  constructor(init) {
    this._map = new Map();
    if (init === undefined || init === null) return;
    if (init instanceof Headers) {
      init.forEach((value, name) => this.append(name, value));
    } else if (Array.isArray(init)) {
      for (const pair of init) {
        if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('Header pairs must be [name, value]');
        this.append(pair[0], pair[1]);
      }
    } else if (typeof init === 'object') {
      for (const name of Object.keys(init)) this.append(name, init[name]);
    } else {
      throw new TypeError('Headers must be an object, an array of pairs or Headers');
    }
  }
  append(name, value) {
    const key = headerName(name);
    const text = headerValue(value);
    this._map.set(key, this._map.has(key) ? this._map.get(key) + ', ' + text : text);
  }
  set(name, value) { this._map.set(headerName(name), headerValue(value)); }
  get(name) { const key = headerName(name); return this._map.has(key) ? this._map.get(key) : null; }
  has(name) { return this._map.has(headerName(name)); }
  delete(name) { this._map.delete(headerName(name)); }
  forEach(callback) { for (const [name, value] of this.entries()) callback(value, name, this); }
  entries() { return [...this._map.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1))[Symbol.iterator](); }
  keys() { return [...this.entries()].map(pair => pair[0])[Symbol.iterator](); }
  values() { return [...this.entries()].map(pair => pair[1])[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
}

function requestBody(body, headers) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain;charset=UTF-8');
    return body;
  }
  // Recognising URLSearchParams here (by global, constructor or methods) would
  // link Porffor's URL library into every app that uses fetch.
  throw new TypeError('Native fetch bodies must be strings: use JSON.stringify(data), or params.toString() ' +
    'with Content-Type: application/x-www-form-urlencoded');
}

export function createFetch(origin) {
  const ipv4Loopback = /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin);
  const localhost = ipv4Loopback ? origin.replace('127.0.0.1', 'localhost') : null;
  return async function nativeFetch(url, init = {}) {
    if (typeof url !== 'string') throw new TypeError('Native fetch requires a string URL');
    const absoluteOrigin = url.startsWith(origin + '/') ? origin :
      localhost && url.startsWith(localhost + '/') ? localhost : null;
    const path = absoluteOrigin ? url.slice(absoluteOrigin.length) : url;
    if (!/^\/(?!\/)[!-~]*$/.test(path) || /[\\#]/.test(path) || path.length > 2048) {
      throw new TypeError('Native fetch requires a path on the configured HTTP origin (' + origin + ')');
    }
    for (const key of Object.keys(init)) {
      if (!['method', 'headers', 'body', 'cache'].includes(key)) throw new TypeError('Unsupported native fetch option: ' + key);
    }
    // The native host never caches, which matches every cache mode below.
    if (init.cache !== undefined && !['default', 'no-store', 'no-cache', 'reload'].includes(init.cache)) {
      throw new TypeError('Unsupported native fetch cache mode: ' + init.cache);
    }
    const method = init.method === undefined ? 'GET' : String(init.method).toUpperCase();
    if (!METHODS.includes(method)) throw new TypeError('Unsupported native HTTP method: ' + method);
    const headers = new Headers(init.headers);
    const body = requestBody(init.body, headers);
    if ((method === 'GET' || method === 'HEAD') && body !== undefined) {
      throw new TypeError('Request with GET/HEAD method cannot have body');
    }
    if (body !== undefined && (body.length > REQUEST_BODY_LIMIT || body.includes('\0'))) {
      throw new TypeError('Native fetch bodies are limited to 64 KiB of text');
    }
    const pairs = [...headers.entries()];
    for (const [name] of pairs) {
      if (FORBIDDEN.test(name)) throw new TypeError('The native host sets the ' + name + ' header itself');
    }
    if (pairs.length > 64 || pairs.reduce((total, [name, value]) => total + name.length + value.length + 4, 0) > HEADER_LIMIT) {
      throw new TypeError('Native fetch headers are limited to 64 entries and 8 KiB');
    }

    const args = { origin, path, method };
    if (pairs.length) args.headers = pairs;
    if (body !== undefined) args.body = body;
    const read = method === 'GET' || method === 'HEAD';
    const reply = await callGatewayAsync(read ? 'native.http.read' : 'native.http.write', args);
    if (reply?.ok === true) updateNativeNetworkStatus(true);
    else if (reply?.error === 'Native HTTP request failed') updateNativeNetworkStatus(false);
    if (reply?.ok !== true || !Number.isInteger(reply.status) || reply.status < 100 ||
        reply.status > 599 || typeof reply.body !== 'string') {
      throw new TypeError(reply?.error || 'Native HTTP request failed');
    }
    const responseHeaders = new Headers();
    if (Array.isArray(reply.headers)) {
      for (const pair of reply.headers) {
        if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' && TOKEN.test(pair[0])) {
          responseHeaders.append(pair[0], pair[1]);
        }
      }
    }
    let bodyUsed = false;
    function consume() {
      if (bodyUsed) throw new TypeError('Response body has already been consumed');
      bodyUsed = true;
      return reply.body;
    }
    return {
      status: reply.status,
      statusText: typeof reply.statusText === 'string' ? reply.statusText : '',
      ok: reply.status >= 200 && reply.status < 300,
      url: (absoluteOrigin || origin) + path,
      redirected: false,
      type: 'basic',
      headers: responseHeaders,
      get bodyUsed() { return bodyUsed; },
      async text() { return consume(); },
      async json() { return JSON.parse(consume()); },
    };
  };
}
