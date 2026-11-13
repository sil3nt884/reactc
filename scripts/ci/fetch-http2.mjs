import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomFillSync } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer, createSecureServer } from 'node:http2';
import { createServer as createHttpsServer } from 'node:https';
import { gzipSync } from 'node:zlib';

const [client, cert, key] = process.argv.slice(2);
const tls = { cert: readFileSync(cert), key: readFileSync(key) };
const binary = randomFillSync(Buffer.alloc(200000));
binary[binary.length - 1] = 255;
const compressed = gzipSync(binary);
const parallel = new WeakMap();
let reset;
const cancelled = new Promise(resolve => { reset = resolve; });
let received = false;

function serve(req, res) {
  res.setHeader('x-http-version', req.httpVersion);
  switch (req.url) {
    case '/parallel': {
      const session = req.stream.session;
      const previous = parallel.get(session);
      if (!previous) parallel.set(session, res);
      else {
        parallel.delete(session);
        previous.end('multiplexed');
        res.end('multiplexed');
      }
      break;
    }
    case '/echo':
    case '/stream-echo': {
      let length = 0;
      const streaming = req.url === '/stream-echo';
      req.on('data', chunk => {
        length += chunk.length;
        if (streaming) received = true;
      });
      req.on('end', () => {
        if (streaming) received = false;
        res.end(String(length));
      });
      break;
    }
    case '/first-upload-chunk': {
      const started = Date.now();
      const timer = setInterval(() => {
        if (!received && Date.now() - started < 1000) return;
        clearInterval(timer);
        res.end(received ? 'received' : 'missing');
      }, 10);
      break;
    }
    case '/multipart': {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res.end(String(req.headers['content-type'].startsWith('multipart/form-data; boundary=') &&
          body.includes('name="message"\r\n\r\nhello') && body.includes('filename="upload.txt"') && body.includes('\r\nabc\r\n')));
      });
      break;
    }
    case '/form-response':
      res.setHeader('content-type', 'multipart/form-data; boundary="reactc-test"');
      res.end(Buffer.concat([
        Buffer.from('--reactc-test\r\nContent-Disposition: form-data; name="message"\r\n\r\nhello\r\n' +
          '--reactc-test\r\nContent-Disposition: form-data; name="file"; filename="download.bin"\r\n\r\n'),
        Buffer.from([0, 255, 128]), Buffer.from('\r\n--reactc-test--\r\n'),
      ]));
      break;
    case '/binary':
      res.end(binary);
      break;
    case '/compressed':
      res.setHeader('content-encoding', 'gzip');
      res.end(compressed);
      break;
    case '/cancel':
      req.stream.once('close', () => reset(req.stream.rstCode));
      res.write('a partial response');
      break;
    case '/redirect':
      res.writeHead(302, { location: '/version' }).end();
      break;
    case '/goaway':
      req.stream.session.goaway();
      res.end(req.httpVersion);
      break;
    default:
      res.end(req.httpVersion);
  }
}

const servers = [
  [createServer(serve), 'http'],
  [createSecureServer({ ...tls, allowHTTP1: true, ALPNCallback: ({ protocols }) => protocols[0] }, serve), 'https'],
  [createHttpsServer({ ...tls, ALPNProtocols: ['http/1.1'] }, serve), 'https'],
  [createHttpsServer({ ...tls, ALPNProtocols: [] }, serve), 'https'],
  [createHttpServer(serve), 'http'],
];
const sessions = new Set();
try {
  const urls = await Promise.all(servers.map(async ([server, scheme]) => {
    server.on('session', session => {
      sessions.add(session);
      session.once('close', () => sessions.delete(session));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return scheme + '://127.0.0.1:' + server.address().port;
  }));
  const child = spawn(client, urls, {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
    stdio: 'inherit',
    timeout: 15000,
  });
  const [code, signal] = await once(child, 'exit');
  assert.equal(signal, null);
  assert.equal(code, 0);
  const timeout = AbortSignal.timeout(1000);
  assert.deepEqual(await Promise.race([cancelled, once(timeout, 'abort').then(() => -1)]), 8);
} finally {
  for (const session of sessions) session.destroy();
  for (const [server] of servers) server.close();
}
