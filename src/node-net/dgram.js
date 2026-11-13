// node:dgram for reactc programs: UDP sockets on Porffor's libuv loop
// (src/reactc-dgram.h). Follows Node's API: createSocket, bind, send, close,
// address, broadcast, TTL, multicast and ref/unref.
import net from 'node:net';
// A real reference keeps Porffor's libuv backend in the program: the sockets
// run on its loop.
globalThis.__reactc_dgram_net = net;

// A small event emitter: UI builds have no node:events.
class EventEmitter {
  constructor() { this._listeners = new Map(); }
  on(name, listener) {
    if (!this._listeners.has(name)) this._listeners.set(name, []);
    this._listeners.get(name).push(listener);
    return this;
  }
  addListener(name, listener) { return this.on(name, listener); }
  once(name, listener) {
    const wrapper = (...args) => { this.off(name, wrapper); listener.apply(this, args); };
    wrapper.listener = listener;
    return this.on(name, wrapper);
  }
  off(name, listener) {
    const list = this._listeners.get(name);
    if (list) this._listeners.set(name, list.filter(item => item !== listener && item.listener !== listener));
    return this;
  }
  removeListener(name, listener) { return this.off(name, listener); }
  removeAllListeners(name) { if (name === undefined) this._listeners.clear(); else this._listeners.delete(name); return this; }
  listenerCount(name) { return (this._listeners.get(name) || []).length; }
  emit(name, ...args) {
    const list = this._listeners.get(name);
    if (!list || list.length === 0) {
      if (name === 'error') throw args[0];
      return false;
    }
    for (const listener of list.slice()) listener.apply(this, args);
    return true;
  }
}

// --- native bridge ------------------------------------------------------------

function cSetDispatcher(fn) {
  Porffor.c`reactc_udp_js = fn;`;
}

function cCreate(family) {
  let out = 0;
  Porffor.c`out = (f64)reactc_udp_create((int)REACTC_NUM(family));`;
  return out;
}

function cBind(id, host, port, reuse, ipv6Only) {
  let out = 0;
  Porffor.c`{ char *h = porf_node_bytes(host, NULL); out = (f64)reactc_udp_bind((int)REACTC_NUM(id), h, (int)REACTC_NUM(port), (int)REACTC_NUM(reuse), (int)REACTC_NUM(ipv6Only)); free(h); }`;
  return out;
}

function cSend(id, data, length, host, port, request) {
  let out = 0;
  Porffor.c`{ char *h = porf_node_bytes(host, NULL); out = (f64)reactc_udp_send((int)REACTC_NUM(id), porf_node_u8(data), (size_t)REACTC_NUM(length), h, (int)REACTC_NUM(port), (int)REACTC_NUM(request)); free(h); }`;
  return out;
}

function cClose(id) {
  let out = 0;
  Porffor.c`out = (f64)reactc_udp_close((int)REACTC_NUM(id));`;
  return out;
}

function cSockname(id) {
  let out = 0;
  Porffor.c`out = (f64)reactc_udp_sockname((int)REACTC_NUM(id));`;
  return out;
}

function cOption(id, option, value, group, iface) {
  let out = 0;
  Porffor.c`{ char *g = porf_node_bytes(group, NULL); char *i = porf_node_bytes(iface, NULL); out = (f64)reactc_udp_option((int)REACTC_NUM(id), (int)REACTC_NUM(option), (int)REACTC_NUM(value), g, i); free(g); free(i); }`;
  return out;
}

function cEventKind() { let out = 0; Porffor.c`out = (f64)reactc_udp_event_kind;`; return out; }
function cEventId() { let out = 0; Porffor.c`out = (f64)reactc_udp_event_id;`; return out; }
function cEventStatus() { let out = 0; Porffor.c`out = (f64)reactc_udp_event_status;`; return out; }
function cEventRequest() { let out = 0; Porffor.c`out = (f64)reactc_udp_event_request;`; return out; }
function cEventPort() { let out = 0; Porffor.c`out = (f64)reactc_udp_event_port;`; return out; }
function cEventFamily() { let out = 0; Porffor.c`out = (f64)reactc_udp_event_family;`; return out; }
function cEventLength() { let out = 0; Porffor.c`out = (f64)reactc_udp_event_len;`; return out; }
function cEventCopy(target) {
  Porffor.c`if (reactc_udp_event_data) memcpy(porf_node_u8(target), reactc_udp_event_data, reactc_udp_event_len);`;
}
function cEventAddressByte(position) {
  let out = 0;
  Porffor.c`out = (f64)(unsigned char)reactc_udp_event_address[(int)REACTC_NUM(position)];`;
  return out;
}
function cErrorNameByte(code, position) {
  let out = 0;
  Porffor.c`{ const char *name = reactc_udp_error_name((int)REACTC_NUM(code)); out = (f64)(unsigned char)name[(int)REACTC_NUM(position)]; }`;
  return out;
}

// --- helpers --------------------------------------------------------------------

function eventAddress() {
  let text = '';
  for (let i = 0; i < 63; i++) {
    const byte = cEventAddressByte(i);
    if (!byte) break;
    text += String.fromCharCode(byte);
  }
  return text;
}

function errnoError(code, syscall, address, port) {
  let name = '';
  for (let i = 0; i < 32; i++) {
    const byte = cErrorNameByte(code, i);
    if (!byte) break;
    name += String.fromCharCode(byte);
  }
  const where = address ? ` ${address}${port !== undefined ? ':' + port : ''}` : '';
  const error = new Error(`${syscall} ${name}${where}`);
  error.code = name;
  error.errno = code;
  error.syscall = syscall;
  if (address) error.address = address;
  if (port !== undefined) error.port = port;
  return error;
}

function toBytes(message) {
  if (typeof message === 'string') return new TextEncoder().encode(message);
  if (message instanceof Uint8Array) return message;
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  throw new TypeError('The "msg" argument must be a string, Buffer, TypedArray or DataView');
}

// one contiguous array starting at offset 0, which the native side reads directly
function payload(message, offset, length) {
  const parts = Array.isArray(message) ? message.map(toBytes) : [toBytes(message)];
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  if (offset !== undefined) return out.slice(offset, length === undefined ? undefined : offset + length);
  return out;
}

const sockets = new Map();   // id -> Socket
let dispatcherSet = false;

// Called from libuv callbacks (src/reactc-dgram.h) for every socket event.
function dispatch() {
  const socket = sockets.get(cEventId());
  if (!socket) return;
  const kind = cEventKind();
  if (kind === 1) {
    const data = new Uint8Array(cEventLength());
    cEventCopy(data);
    const family = cEventFamily() === 6 ? 'IPv6' : 'IPv4';
    const message = typeof Buffer === 'function' ? Buffer.from(data.buffer, 0, data.length) : data;
    socket.emit('message', message, { address: eventAddress(), family, port: cEventPort(), size: data.length });
  } else if (kind === 2) {
    const request = cEventRequest();
    const callback = socket._sends.get(request);
    socket._sends.delete(request);
    const status = cEventStatus();
    if (callback) callback(status < 0 ? errnoError(status, 'send') : null, status < 0 ? 0 : socket._sizes.get(request));
    socket._sizes.delete(request);
  } else if (kind === 3) {
    socket.emit('error', errnoError(cEventStatus(), 'recvmsg'));
  } else if (kind === 4) {
    sockets.delete(socket._id);
    socket._id = 0;
    socket.emit('close');
  }
}

export class Socket extends EventEmitter {
  constructor(options, listener) {
    super();
    const type = typeof options === 'string' ? options : options?.type;
    if (type !== 'udp4' && type !== 'udp6') throw new TypeError(`Bad socket type specified. Valid types are: udp4, udp6`);
    this.type = type;
    this._reuseAddr = Boolean(typeof options === 'object' && options.reuseAddr);
    this._ipv6Only = Boolean(typeof options === 'object' && options.ipv6Only);
    this._family = type === 'udp6' ? 6 : 4;
    this._id = 0;
    this._bound = false;
    this._sends = new Map();
    this._sizes = new Map();
    this._nextRequest = 1;
    if (typeof listener === 'function') this.on('message', listener);
    if (!dispatcherSet) { cSetDispatcher(dispatch); dispatcherSet = true; }
  }

  _open() {
    if (this._id) return;
    const id = cCreate(this._family);
    if (id < 0) throw errnoError(id, 'socket');
    this._id = id;
    sockets.set(id, this);
  }

  bind(port, address, callback) {
    let options = {};
    if (port !== null && typeof port === 'object') { options = port; callback = address; }
    else {
      if (typeof port === 'function') { callback = port; port = 0; address = undefined; }
      if (typeof address === 'function') { callback = address; address = undefined; }
      options = { port, address };
    }
    this._open();
    if (typeof callback === 'function') this.once('listening', callback);
    const host = options.address ?? '';
    const bindPort = Number(options.port ?? 0);
    const status = cBind(this._id, host, bindPort, options.exclusive === false || this._reuseAddr ? 1 : 0, this._ipv6Only ? 1 : 0);
    if (status < 0) {
      const error = errnoError(status, 'bind', host || (this._family === 6 ? '::' : '0.0.0.0'), bindPort);
      setTimeout(() => this.emit('error', error), 0);
      return this;
    }
    this._bound = true;
    setTimeout(() => this.emit('listening'), 0);
    return this;
  }

  send(message, ...rest) {
    let offset, length;
    if (typeof rest[0] === 'number' && typeof rest[1] === 'number' && rest.length >= 3 && typeof rest[2] === 'number') {
      offset = rest.shift();
      length = rest.shift();
    }
    let [port, address, callback] = rest;
    if (typeof address === 'function') { callback = address; address = undefined; }
    const data = payload(message, offset, length);
    // sending before bind binds to a random port first, as Node does
    if (!this._bound) this.bind(0);
    const request = this._nextRequest++;
    if (typeof callback === 'function') { this._sends.set(request, callback); this._sizes.set(request, data.length); }
    const host = address ?? (this._family === 6 ? '::1' : '127.0.0.1');
    const status = cSend(this._id, data, data.length, host, Number(port), request);
    if (status < 0) {
      this._sends.delete(request);
      this._sizes.delete(request);
      const error = errnoError(status, 'send', host, Number(port));
      if (typeof callback === 'function') setTimeout(() => callback(error), 0);
      else setTimeout(() => this.emit('error', error), 0);
    }
  }

  close(callback) {
    if (typeof callback === 'function') this.once('close', callback);
    if (this._id) cClose(this._id);
    else setTimeout(() => this.emit('close'), 0);
    return this;
  }

  address() {
    if (!this._id) throw errnoError(-9, 'getsockname');
    const status = cSockname(this._id);
    if (status < 0) throw errnoError(status, 'getsockname');
    return { address: eventAddress(), family: cEventFamily() === 6 ? 'IPv6' : 'IPv4', port: cEventPort() };
  }

  _option(option, value, group = '', iface = '') {
    this._open();
    const status = cOption(this._id, option, value, group, iface ?? '');
    if (status < 0) throw errnoError(status, 'setsockopt');
  }

  setBroadcast(flag) { this._option(1, flag ? 1 : 0); }
  setTTL(ttl) { this._option(2, ttl); return ttl; }
  setMulticastTTL(ttl) { this._option(3, ttl); return ttl; }
  setMulticastLoopback(flag) { this._option(4, flag ? 1 : 0); return flag; }
  addMembership(group, iface) { this._option(5, 0, group, iface); }
  dropMembership(group, iface) { this._option(6, 0, group, iface); }
  ref() { if (this._id) this._option(7, 1); return this; }
  unref() { if (this._id) this._option(7, 0); return this; }
}

export function createSocket(options, listener) {
  return new Socket(options, listener);
}

export default { createSocket, Socket };
