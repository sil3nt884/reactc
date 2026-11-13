# Design: native TCP and UDP streams, and fetch over them

Status: UDP uses libuv. Native fetch uses HTTP/1.1 and HTTP/2 over
`node:net`/`node:tls`, including desktop builds configured with
`--http-origin`. WASI uses the host transport. See
[known limits](../LIMITS.md#http-client-fetch) for current API coverage.

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

### 4. Fetch over TCP

HTTPS negotiates `h2` with ALPN and falls back to HTTP/1.1. Cleartext
HTTP/2 uses explicit prior knowledge. nghttp2 supplies the HTTP/2 state
machine and HPACK. The Fetch layer manages redirects, cookies and response
consumption across both transports.

### 5. UI apps

The page core uses its libuv loop for sockets. On Windows, Win32 runs on
its own thread. WASI continues to forward configured-origin requests to the
host.

## Open questions

- **QUIC/HTTP/3.** Later. libuv has no QUIC, so it would need a library such
  as ngtcp2 or msquic.
- **Raw sockets and ICMP.** Not planned. They need privileges and differ per
  operating system.
