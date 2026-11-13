# Design: native TCP and UDP streams, and fetch over them

Status: steps 1, 3 and 4 are implemented and verified on Windows and Linux. UDP is `node:dgram` on libuv (src/reactc-dgram.h, src/node-net/dgram.js). `fetch` is an HTTP/1.1 client over `node:net`/`node:tls` (src/node-net/fetch.js), injected into servers and into UI apps built without `--http-origin`. Still open: the `node:net` CI coverage test (step 2) and switching `--http-origin` UI apps to the new client (step 5).

## Goal

Programs built with reactc get full control of the network: TCP and UDP
sockets as native streams, the same in UI apps and servers on Windows and
Linux. `fetch` becomes an HTTP client written on top of TCP instead of a
request handed to the host. Programs can implement their own protocols over
TCP or UDP with the same interfaces.

## What exists today

| | Servers | UI apps |
| --- | --- | --- |
| TCP (`node:net`) | Yes: Porffor's implementation on libuv. A Windows `.exe` probe echoed data, and sockets have `setNoDelay`, `setKeepAlive`, `pause`/`resume`, `setTimeout`, `cork` and `unref`. | Allowed in async-page builds, which link libuv into the app's core. |
| UDP (`node:dgram`) | No: "node builtin module 'node:dgram' is not implemented" | No |
| TLS | `https` through uSockets and OpenSSL | Not exposed |
| `fetch` | Not provided | Host transport (WinHTTP on Windows, the Python host on Linux). This is where the limits come from: no cookies, no redirects, no streaming, bodies up to 64 KiB, no binary data. |

## Proposal

### 1. UDP: `node:dgram` on libuv

reactc provides `node:dgram` in its replacement layer, the same way it
provides `worker_threads`. The JavaScript API follows Node:

```js
import dgram from 'node:dgram';
const socket = dgram.createSocket('udp4');
socket.on('message', (msg, rinfo) => { ... });
socket.bind(41234);
socket.send(Buffer.from('ping'), 41234, '127.0.0.1');
```

- **Native side.** libuv's `uv_udp_*` handles carry it (bind, send,
  `recv_start`, broadcast, multicast membership, TTL), through the same
  event-queue bridge Porffor's TCP uses, so datagrams arrive as loop events.
- **Coverage.** `createSocket('udp4' | 'udp6')`, `bind`, `send` (Buffer,
  string, arrays of them), `message`, `listening`, `error`, `close`,
  `address`, `setBroadcast`, `setTTL`, `addMembership` and
  `dropMembership`, `ref`/`unref`.
- **Windows.** Windows builds use the same libuv, linked statically.

### 2. TCP stays `node:net`, and gains tests

`node:net` works. The work is to check the rest of its surface (server
backlog, `allowHalfOpen`, IPv6, error codes) and add a native test to CI.

### 3. TLS as streams: `node:tls`

`tls.connect` and `tls.createServer` over the OpenSSL reactc already links
for `https`. This is needed so `fetch` can speak HTTPS from JavaScript.

### 4. fetch over TCP, written in JavaScript

`fetch` becomes an HTTP/1.1 client in reactc's runtime, over `node:net` and
`node:tls`:

- streaming request and response bodies (`ReadableStream`, `response.body`)
- binary bodies (`ArrayBuffer`, `Uint8Array`, `Blob`) and no size limit
- redirects (`redirect: 'follow' | 'manual' | 'error'`) and a cookie jar per
  program
- keep-alive connection pooling, chunked transfer, and gzip/Brotli decoding
  (zlib is already linked)
- `AbortController` and timeouts

The host transport stays available behind a flag while the new client
matures. It is removed once the new client covers the existing checks.

### 5. UI apps: one event loop

UI apps already link libuv in async-page mode. The Windows host runs its
Win32 message loop on one thread and the compiled core on another, so the
core's libuv loop runs on the core thread, which keeps sockets and the page
runtime together. To confirm: that page events and socket events interleave
fairly on that thread, which needs a UI test.

## Steps

1. `node:dgram` on libuv, with a native echo test on Windows and Linux.
2. A `node:net` coverage test in CI.
3. `node:tls` streams.
4. The JavaScript `fetch` client, behind a flag, with streaming, binary,
   redirects, cookies and HTTPS.
5. Switch UI apps to it and remove the old limits from LIMITS.md.

## Open questions

- **QUIC/HTTP/3.** Later. libuv has no QUIC, so it would need a library such
  as ngtcp2 or msquic.
- **Raw sockets and ICMP.** Not planned. They need privileges and differ per
  operating system.
