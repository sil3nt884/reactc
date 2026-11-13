// node:worker_threads for reactc servers. Workers are native threads: reactc
// compiles each literal worker entry (new Worker('./w.js') or
// new Worker(new URL('./w.js', import.meta.url))) into its own program in the
// same executable, and src/reactc-threads.c starts it on an OS thread with its
// own heap and event loop. Messages are structured clones (fork: JSON unless
// serialization is 'advanced', as in Node) sent as lines over a loopback
// socket that only the token holder may use.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { decodeMessage, deserialize, encodeMessage, serialize } from './clone.js';

const STATIC_RULE = 'reactc compiles workers at build time: pass a literal path, as in ' +
  'new Worker("./worker.js") or new Worker(new URL("./worker.js", import.meta.url))';

function nativeThreadId() {
  let id = 0;
  Porffor.c`id = (f64)reactc_thread_id();`;
  return id;
}

// Locals written by inline C are initialised: the bundler removes a variable
// it never sees assigned, and cannot see into the C.
function nativeThreadData() {
  let out = '';
  Porffor.c`{ const char *data = reactc_thread_data(); out = porf_bstr_of(data, (u32)strlen(data)); }`;
  return out;
}

function nativeThreadStart(entryText, dataText) {
  let id = 0;
  Porffor.c`{ char small1[32]; char small2[1024]; char *entry = porf_str_cstr(entryText, small1, 32); char *data = porf_str_cstr(dataText, small2, 1024); id = (f64)reactc_thread_start(atoi(entry), data); if (entry != small1) free(entry); if (data != small2) free(data); }`;
  return id;
}

function nativeThreadStatus(idText) {
  let code = 0;
  Porffor.c`{ char small[32]; char *text = porf_str_cstr(idText, small, 32); code = (f64)reactc_thread_status(atoi(text)); if (text != small) free(text); }`;
  return code;
}

// The startup data is read as ASCII, so non-ASCII text travels escaped.
function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g,
    character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

// One message per line in both directions; `token` is checked on the first line.
function attach(socket, token, advanced, onReady, onMessage, onClose) {
  let buffer = '';
  let ready = token === null;
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!ready) {
        if (line !== token) { socket.destroy(); return; }
        ready = true;
        onReady();
      } else if (line) {
        onMessage(decodeMessage(line, advanced));
      }
    }
  });
  socket.on('error', () => {});
  socket.on('close', onClose);
}

const startup = nativeThreadData();
export const isMainThread = startup === '';
const info = isMainThread ? null : JSON.parse(startup);
export const threadId = isMainThread ? 0 : nativeThreadId();
const advanced = isMainThread || info.advanced;
export const workerData = isMainThread ? null : deserialize(info.workerData);
export const resourceLimits = {};
export const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

// process.argv as Node gives a fork child or a worker started with argv.
if (!isMainThread && Array.isArray(info.argv)) {
  process.argv = [process.argv[0] ?? 'reactc', info.filename, ...info.argv.map(String)];
}

// In a worker: the channel to the thread that started it.
function openChannel() {
  const channel = new EventEmitter();
  const queue = [];
  let socket = null;
  let open = false;
  channel.post = value => {
    const line = encodeMessage(value, advanced);
    if (open) socket.write(line);
    else queue.push(line);
  };
  channel.close = () => { if (socket) socket.end(); };
  socket = net.connect(info.port, '127.0.0.1', () => {
    socket.write(info.token + '\n');
    open = true;
    for (const line of queue) socket.write(line);
    queue.length = 0;
  });
  attach(socket, null, advanced, () => {}, value => channel.emit('message', value), () => {
    open = false;
    channel.emit('close');
  });
  // Like Node, the channel keeps a worker alive only while it is listened to.
  if (typeof socket.unref === 'function') socket.unref();
  channel.listen = () => { if (typeof socket.ref === 'function') socket.ref(); };
  channel.forget = () => { if (typeof socket.unref === 'function') socket.unref(); };
  return channel;
}

const channel = isMainThread ? null : openChannel();

function createParentPort() {
  const port = new EventEmitter();
  port.postMessage = value => channel.post(value);
  port.close = () => channel.close();
  port.ref = () => channel.listen();
  port.unref = () => channel.forget();
  port.on('newListener', name => { if (name === 'message') channel.listen(); });
  channel.on('message', value => port.emit('message', value));
  channel.on('close', () => port.emit('close'));
  return port;
}

export const parentPort = isMainThread || info.fork ? null : createParentPort();

// In a forked child: process.send and process 'message' events, as in Node.
if (!isMainThread && info.fork) {
  process.send = (value, callback) => {
    channel.post(value);
    if (typeof callback === 'function') setImmediate(callback);
    return true;
  };
  process.connected = true;
  process.disconnect = () => { process.connected = false; channel.close(); };
  channel.on('message', value => { if (typeof process.emit === 'function') process.emit('message', value); });
  channel.on('close', () => {
    process.connected = false;
    if (typeof process.emit === 'function') process.emit('disconnect');
  });
  if (typeof process.on === 'function') {
    const on = process.on.bind(process);
    process.on = (name, listener) => {
      if (name === 'message') channel.listen();
      return on(name, listener);
    };
  }
}

// The starting side of a thread: launch, handshake, messages and exit.
class ThreadHandle extends EventEmitter {
  constructor(spec, data, fork, argv, advanced) {
    super();
    if (!spec || typeof spec !== 'object' || typeof spec.__reactcWorker !== 'number') throw new TypeError(STATIC_RULE);
    // Cloned now, so an uncloneable workerData throws from the constructor.
    const clonedData = serialize(data);
    this._advanced = advanced;
    this.threadId = -1;
    this._queue = [];
    this._socket = null;
    this._exited = false;
    this._stopping = false;
    const token = crypto.randomBytes(16).toString('hex');
    this._server = net.createServer(socket => {
      if (this._socket) { socket.destroy(); return; }
      attach(socket, token, advanced, () => {
        this._socket = socket;
        this._server.close();
        for (const line of this._queue) socket.write(line);
        this._queue.length = 0;
        this.emit(fork ? 'spawn' : 'online');
      }, value => this.emit('message', value), () => { this._socket = null; });
    });
    this._server.listen(0, '127.0.0.1', () => {
      const payload = asciiJson({ port: this._server.address().port, token, fork, advanced, workerData: clonedData, filename: spec.filename, argv });
      this.threadId = nativeThreadStart(String(spec.__reactcWorker), payload);
      if (!this.threadId) {
        this._server.close();
        this._exited = true;
        this.emit('error', new Error('reactc could not start a thread for ' + spec.filename));
        return;
      }
      // Polls the thread's state; this also keeps the process alive while it runs.
      this._timer = setInterval(() => {
        const code = nativeThreadStatus(String(this.threadId));
        if (code !== -1) this._finish(code);
      }, 15);
    });
  }

  _send(value) {
    const line = encodeMessage(value, this._advanced);
    if (this._socket) this._socket.write(line);
    else if (!this._exited) this._queue.push(line);
  }

  _finish(code) {
    if (this._exited) return;
    this._exited = true;
    clearInterval(this._timer);
    this._server.close();
    if (this._socket) this._socket.destroy();
    this._done(code);
  }

  // Closes the channel. The thread ends once its event loop is idle; a busy
  // thread cannot be stopped from outside.
  _stop() {
    this._stopping = true;
    if (this._socket) this._socket.end();
  }

  ref() {
    if (this._timer && typeof this._timer.ref === 'function') this._timer.ref();
    return this;
  }

  unref() {
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
    return this;
  }
}

export class Worker extends ThreadHandle {
  constructor(spec, options = {}) {
    super(spec, options.workerData, false, Array.isArray(options.argv) ? options.argv : null, true);
  }

  postMessage(value) { this._send(value); }

  terminate() {
    if (this._exited) return Promise.resolve(undefined);
    const exited = new Promise(resolve => this.once('exit', resolve));
    this._stop();
    return exited;
  }

  _done(code) {
    if (code !== 0 && !this._stopping) this.emit('error', new Error('Worker exited with code ' + code));
    this.emit('exit', code);
  }
}

// child_process.fork for compiled children: a thread with process.send.
export class ThreadChildProcess extends ThreadHandle {
  constructor(spec, args, options) {
    super(spec, undefined, true, args || [], options?.serialization === 'advanced');
    this.pid = process.pid;
    this.connected = true;
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
    this.spawnfile = spec.filename;
    this.spawnargs = [spec.filename, ...(args || [])];
  }

  send(value, callback) {
    this._send(value);
    if (typeof callback === 'function') setImmediate(() => callback(null));
    return true;
  }

  disconnect() {
    this.connected = false;
    this._stop();
  }

  kill() {
    this.killed = true;
    this.disconnect();
    return true;
  }

  _done(code) {
    this.connected = false;
    this.exitCode = code;
    this.emit('disconnect');
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

export function forkThread(spec, args, options) {
  if (!Array.isArray(args)) { options = args; args = []; }
  return new ThreadChildProcess(spec, args, options);
}

export function markAsUntransferable() {}
export function receiveMessageOnPort() { return undefined; }

export default {
  isMainThread, parentPort, workerData, threadId, resourceLimits, SHARE_ENV, Worker, markAsUntransferable,
  receiveMessageOnPort,
};
