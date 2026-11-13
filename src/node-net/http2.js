// The native session parses HTTP/2 frames and HPACK. Keep TLS, sockets and
// the Fetch response lifecycle on the JavaScript side.
function open() {
  let result = 0;
  Porffor.c`result = (f64)(uintptr_t)reactc_h2_open();`;
  return result;
}

function free(handle) {
  Porffor.c`reactc_h2_free((reactc_h2 *)(uintptr_t)REACTC_NUM(handle));`;
}

function submit(handle, fields, count, body, length, live) {
  let result = 0;
  Porffor.c`result = (f64)reactc_h2_submit((reactc_h2 *)(uintptr_t)REACTC_NUM(handle), porf_node_u8(fields), (size_t)REACTC_NUM(count), (const uint8_t *)porf_node_u8(body), (size_t)REACTC_NUM(length), (int)REACTC_NUM(live));`;
  return result;
}

function feed(handle, stream, data, length, eof) {
  let result = 0;
  Porffor.c`result = (f64)reactc_h2_feed((reactc_h2 *)(uintptr_t)REACTC_NUM(handle), (int)REACTC_NUM(stream), (const uint8_t *)porf_node_u8(data), (size_t)REACTC_NUM(length), (int)REACTC_NUM(eof));`;
  return result;
}

function receive(handle, data, length) {
  let result = 0;
  Porffor.c`{ reactc_h2 *h2 = (reactc_h2 *)(uintptr_t)REACTC_NUM(handle); result = (f64)nghttp2_session_mem_recv2(h2->session, (const uint8_t *)porf_node_u8(data), (size_t)REACTC_NUM(length)); }`;
  return result;
}

function send(handle) {
  let result = 0;
  Porffor.c`{ reactc_h2 *h2 = (reactc_h2 *)(uintptr_t)REACTC_NUM(handle); result = (f64)nghttp2_session_mem_send2(h2->session, &h2->output); }`;
  return result;
}

function copyOutput(handle, data, length) {
  Porffor.c`memcpy(porf_node_u8(data), ((reactc_h2 *)(uintptr_t)REACTC_NUM(handle))->output, (size_t)REACTC_NUM(length));`;
}

function eventKind(handle) {
  let result = 0;
  Porffor.c`{ reactc_h2_event *event = ((reactc_h2 *)(uintptr_t)REACTC_NUM(handle))->first; result = event ? (f64)event->kind : 0; }`;
  return result;
}

function eventStream(handle) {
  let result = 0;
  Porffor.c`result = (f64)((reactc_h2 *)(uintptr_t)REACTC_NUM(handle))->first->stream;`;
  return result;
}

function eventDetail(handle) {
  let result = 0;
  Porffor.c`result = (f64)((reactc_h2 *)(uintptr_t)REACTC_NUM(handle))->first->detail;`;
  return result;
}

function eventSize(handle) {
  let result = 0;
  Porffor.c`result = (f64)((reactc_h2 *)(uintptr_t)REACTC_NUM(handle))->first->size;`;
  return result;
}

function popEvent(handle, data, length) {
  Porffor.c`{ reactc_h2 *h2 = (reactc_h2 *)(uintptr_t)REACTC_NUM(handle); if (REACTC_NUM(length)) memcpy(porf_node_u8(data), h2->first->bytes, (size_t)REACTC_NUM(length)); reactc_h2_pop(h2); }`;
}

function consume(handle, stream, length) {
  Porffor.c`nghttp2_session_consume_stream(((reactc_h2 *)(uintptr_t)REACTC_NUM(handle))->session, (int32_t)REACTC_NUM(stream), (size_t)REACTC_NUM(length));`;
}

function reset(handle, stream) {
  Porffor.c`nghttp2_submit_rst_stream(((reactc_h2 *)(uintptr_t)REACTC_NUM(handle))->session, NGHTTP2_FLAG_NONE, (int32_t)REACTC_NUM(stream), NGHTTP2_CANCEL);`;
}

function reusable(handle) {
  let result = 0;
  Porffor.c`result = (f64)nghttp2_session_check_request_allowed(((reactc_h2 *)(uintptr_t)REACTC_NUM(handle))->session);`;
  return result;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const empty = new Uint8Array(0);
const HEADER = 1, HEADERS = 2, DATA = 3, CLOSE = 4, GOAWAY = 5, END = 6, UPLOAD = 7;
export const REFUSED_STREAM = 7;
const connectionHeaders = /^(connection|keep-alive|proxy-connection|transfer-encoding|upgrade|host)$/;

function requestFields(url, method, headers) {
  const fields = [
    [':method', method], [':authority', url.host],
    [':scheme', url.protocol.slice(0, -1)], [':path', (url.pathname || '/') + url.search],
  ];
  const nominated = (headers.get('connection') || '').toLowerCase().split(',').map(name => name.trim());
  for (const [name, value] of headers.entries()) {
    if (connectionHeaders.test(name) || nominated.includes(name)) continue;
    if (name === 'te' && value.toLowerCase() !== 'trailers') continue;
    fields.push([name, value]);
  }
  return fields;
}

function protocolError(message) {
  return new TypeError('fetch failed: HTTP/2 ' + message);
}

export class Http2Session {
  constructor(socket, retire) {
    this.handle = open();
    if (!this.handle) throw protocolError('session initialization failed');
    this.socket = socket;
    this.retire = retire;
    this.streams = new Map();
    this.accepting = true;
    socket.on('error', error => this.close(error));
    socket.on('end', () => this.close(protocolError('connection ended')));
    socket.on('close', () => this.close(protocolError('connection closed')));
    socket.on('drain', () => {
      this.writeBlocked = false;
      try { this.flush(); } catch (error) { this.close(error); }
    });
    socket.on('data', chunk => {
      if (!this.handle) return;
      try {
        // Porffor's inline byte helper expects a view starting at offset zero.
        const data = new Uint8Array(chunk);
        if (receive(this.handle, data, data.length) !== data.length) throw protocolError('could not decode frames');
        this.flush();
      } catch (error) {
        this.close(error);
      }
    });
  }

  request(url, method, headers, body, handlers) {
    const fields = requestFields(url, method, headers);
    const encoded = encoder.encode(fields.map(([name, value]) => name + '\0' + value + '\0').join(''));
    const live = body instanceof ReadableStream;
    const bytes = !live && body && body.length ? new Uint8Array(body) : empty;
    const stream = submit(this.handle, encoded, fields.length, bytes, bytes.length, live ? 1 : 0);
    if (stream < 0) throw protocolError('could not submit request (' + stream + ')');
    this.streams.set(stream, handlers);
    this.socket.ref();
    return stream;
  }

  flush() {
    if (this.flushing) { this.flushAgain = true; return; }
    this.flushing = true;
    try {
      do {
        this.flushAgain = false;
        this.drain();
      } while (this.handle && this.flushAgain);
    } finally {
      this.flushing = false;
    }
  }

  drain() {
    // Sending can itself close streams that were queued when GOAWAY arrived.
    // Drain events after each batch of writes.
    while (this.handle && !this.writeBlocked) {
      const length = send(this.handle);
      if (length < 0) throw protocolError('could not encode frames');
      if (!length) break;
      const data = new Uint8Array(length);
      copyOutput(this.handle, data, length);
      this.writeBlocked = this.socket.write(data) === false;
    }
    while (this.handle) {
      const kind = eventKind(this.handle);
      if (!kind) break;
      const stream = eventStream(this.handle);
      const detail = eventDetail(this.handle);
      const size = eventSize(this.handle);
      const data = size ? new Uint8Array(size) : empty;
      popEvent(this.handle, data, size);
      if (kind === GOAWAY) {
        this.stopAccepting();
        for (const [id, handlers] of this.streams) {
          if (id > detail) {
            this.streams.delete(id);
            handlers.close(REFUSED_STREAM);
          }
        }
        continue;
      }
      const handlers = this.streams.get(stream);
      if (!handlers) continue;
      if (kind === HEADER) handlers.header(decoder.decode(data.subarray(0, detail)), decoder.decode(data.subarray(detail)));
      if (kind === HEADERS) handlers.headers();
      if (kind === DATA) handlers.data(data);
      if (kind === END) handlers.end();
      if (kind === UPLOAD) handlers.upload();
      if (kind === CLOSE) {
        this.streams.delete(stream);
        handlers.close(detail);
      }
    }
    if (!this.handle) return;
    if (!reusable(this.handle)) this.stopAccepting();
    if (!this.streams.size) {
      if (this.accepting) this.socket.unref();
      else this.close(protocolError('session ended'));
    }
  }

  acknowledge(stream, bytes) {
    if (this.handle && this.streams.has(stream)) {
      consume(this.handle, stream, bytes);
      try { this.flush(); } catch (error) { this.close(error); }
    }
  }

  upload(stream, data, done) {
    if (!this.handle || !this.streams.has(stream)) return;
    const bytes = done ? empty : new Uint8Array(data);
    if (feed(this.handle, stream, bytes, bytes.length, done ? 1 : 0) < 0) throw protocolError('could not resume upload');
    this.flush();
  }

  cancel(stream) {
    if (this.handle && this.streams.has(stream)) {
      reset(this.handle, stream);
      try { this.flush(); } catch (error) { this.close(error); }
    }
  }

  stopAccepting() {
    if (this.accepting) {
      this.accepting = false;
      this.retire();
    }
  }

  close(error) {
    if (!this.handle) return;
    this.stopAccepting();
    free(this.handle);
    this.handle = 0;
    this.socket.destroy();
    for (const handlers of this.streams.values()) handlers.fail(error);
    this.streams.clear();
  }
}
