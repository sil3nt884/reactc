// Node API coverage probe for reactc server builds. Each check runs in
// isolation and the program prints one JSON report: {"api": "ok" | "error ..."}.
import assert from 'node:assert';
import { spawnSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import querystring from 'node:querystring';
import readline from 'node:readline';
import { Readable, Transform, pipeline } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import util from 'node:util';
import zlib from 'node:zlib';

const report = {};
const windows = process.platform === 'win32';
const work = path.join(os.tmpdir(), 'reactc-node-probe-' + process.pid);

async function check(name, run) {
  try {
    const result = await run();
    report[name] = result === undefined || result === true ? 'ok' : 'error: unexpected ' + JSON.stringify(result);
  } catch (error) {
    report[name] = 'error: ' + (error && error.message ? error.message : String(error));
  }
}

const same = (actual, expected) => (actual === expected ? true : { actual, expected });

await check('path', () => same(path.basename(path.join('a', 'b', 'c.txt'), '.txt') + path.extname('x.tar.gz') +
  path.parse('/r/f.js').name + (path.isAbsolute(path.resolve('x')) ? 'abs' : 'rel'), 'c.gzfabs'));
await check('os', () => same([typeof os.platform(), typeof os.tmpdir(), typeof os.homedir(), os.EOL.length > 0,
  os.cpus().length > 0, typeof os.hostname(), os.totalmem() > 0].join(','), 'string,string,string,true,true,string,true'));
await check('process', () => same([process.argv.length > 0, typeof process.env.PATH === 'string' || typeof process.env.Path === 'string',
  typeof process.cwd(), process.pid > 0, typeof process.hrtime.bigint(), process.memoryUsage().rss > 0].join(','),
  'true,true,string,true,bigint,true'));
await check('process.nextTick', () => new Promise(resolve => process.nextTick(() => resolve(true))));
await check('timers', async () => {
  const order = [];
  await new Promise(resolve => {
    setTimeout(() => { order.push('timeout'); resolve(); }, 5);
    setImmediate(() => order.push('immediate'));
    queueMicrotask(() => order.push('microtask'));
  });
  let ticks = 0;
  await new Promise(resolve => { const timer = setInterval(() => { if (++ticks === 3) { clearInterval(timer); resolve(); } }, 2); });
  await sleep(2);
  return same(order.join(',') + ':' + ticks, 'microtask,immediate,timeout:3');
});
await check('fs sync', () => {
  fs.mkdirSync(path.join(work, 'nested', 'deep'), { recursive: true });
  const file = path.join(work, 'nested', 'a.txt');
  fs.writeFileSync(file, 'héllo');
  fs.appendFileSync(file, ' wörld');
  const text = fs.readFileSync(file, 'utf8');
  fs.renameSync(file, file + '.moved');
  const listing = fs.readdirSync(path.join(work, 'nested')).sort().join(',');
  const size = fs.statSync(file + '.moved').size;
  fs.copyFileSync(file + '.moved', file + '.copy');
  fs.unlinkSync(file + '.moved');
  return same([text, listing, size, fs.existsSync(file + '.copy'), fs.existsSync(file + '.moved')].join('|'),
    'héllo wörld|a.txt.moved,deep|13|true|false');
});
await check('fs/promises', async () => {
  const file = path.join(work, 'p.json');
  await fsp.writeFile(file, JSON.stringify({ n: 1 }));
  const data = JSON.parse(await fsp.readFile(file, 'utf8'));
  const stat = await fsp.stat(file);
  const names = await fsp.readdir(work);
  return same([data.n, stat.isFile(), names.includes('p.json')].join(','), '1,true,true');
});
await check('fs callbacks', () => new Promise((resolve, reject) =>
  fs.readFile(path.join(work, 'p.json'), 'utf8', (error, text) => (error ? reject(error) : resolve(same(text, '{"n":1}'))))));
await check('fs streams', async () => {
  const file = path.join(work, 's.txt');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    out.on('error', reject);
    out.end('line1\nline2\n', resolve);
  });
  let text = '';
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8' })) text += chunk;
  return same(text, 'line1\nline2\n');
});
await check('fs rm recursive', async () => {
  await fsp.rm(path.join(work, 'nested'), { recursive: true, force: true });
  return same(fs.existsSync(path.join(work, 'nested')), false);
});
await check('events', async () => {
  const emitter = new EventEmitter();
  const seen = [];
  emitter.on('x', value => seen.push(value));
  emitter.once('x', value => seen.push('once:' + value));
  emitter.emit('x', 1);
  emitter.emit('x', 2);
  setTimeout(() => emitter.emit('ready', 'go'), 1);
  const [value] = await once(emitter, 'ready');
  return same(seen.join(',') + ':' + value + ':' + emitter.listenerCount('x'), '1,once:1,2:go:1');
});
await check('buffer', () => {
  const buffer = Buffer.from('Ωmega', 'utf8');
  return same([buffer.length, buffer.toString('base64'), Buffer.from('ff00', 'hex')[0],
    Buffer.concat([Buffer.from('a'), Buffer.from('b')]).toString(), Buffer.byteLength('é'),
    Buffer.alloc(3).fill(7)[2]].join('|'), '6|zqltZWdh|255|ab|2|7');
});
await check('TextEncoder/Decoder', () => same(new TextDecoder().decode(new TextEncoder().encode('ü')), 'ü'));
await check('crypto hash/hmac', () => same(
  crypto.createHash('sha256').update('abc').digest('hex').slice(0, 16) + ':' +
  crypto.createHmac('sha256', 'key').update('msg').digest('base64').slice(0, 8),
  'ba7816bf8f01cfea:LZPLwb4W'));
await check('crypto random', () => same([crypto.randomUUID().length, crypto.randomBytes(16).length,
  crypto.randomInt(0, 1) === 0].join(','), '36,16,true'));
await check('crypto pbkdf2/timingSafeEqual', () => {
  const key = crypto.pbkdf2Sync('pw', 'salt', 1000, 16, 'sha256');
  return same(key.length + ':' + crypto.timingSafeEqual(Buffer.from('ab'), Buffer.from('ab')), '16:true');
});
await check('crypto scrypt', async () => {
  const sync = crypto.scryptSync('pw', 'salt', 16).toString('hex');
  // RFC 7914 test vector 3.
  const rfc = crypto.scryptSync('password', 'NaCl', 64, { N: 1024, r: 8, p: 16 }).toString('hex').slice(0, 32);
  const callback = await new Promise((resolve, reject) =>
    crypto.scrypt('pw', 'salt', 16, (error, key) => (error ? reject(error) : resolve(key.toString('hex')))));
  return same([sync, rfc, callback === sync].join('|'), 'c0b515908e61334cae6d6003c00be60e|fdbabe1c9d3472007856e7190d01e9fe|true');
});
await check('url', () => {
  const url = new URL('https://user@example.com:8080/p/a?x=1&y=two#h');
  const params = new URLSearchParams({ a: '1', b: 'two words' });
  params.append('c', 'ü');
  return same([url.hostname, url.port, url.searchParams.get('y'), params.toString(),
    fileURLToPath(pathToFileURL(path.resolve('f.txt'))) === path.resolve('f.txt')].join('|'),
    'example.com|8080|two|a=1&b=two+words&c=%C3%BC|true');
});
await check('querystring', () => same(querystring.stringify({ a: [1, 2], b: 'x y' }) + '|' + querystring.parse('a=1&a=2&b=x').a.join(','),
  'a=1&a=2&b=x%20y|1,2'));
await check('util', async () => {
  const later = util.promisify((value, callback) => setTimeout(() => callback(null, value * 2), 1));
  return same([util.format('%s=%d %j', 'n', 42, { a: 1 }), util.inspect({ a: [1, 2] }), await later(21),
    util.types.isPromise(Promise.resolve()), util.isDeepStrictEqual({ a: 1 }, { a: 1 })].join('|'),
    'n=42 {"a":1}|{ a: [ 1, 2 ] }|42|true|true');
});
await check('string_decoder', () => {
  const decoder = new StringDecoder('utf8');
  const bytes = Buffer.from('€');
  return same(decoder.write(bytes.subarray(0, 1)) + decoder.write(bytes.subarray(1)) + decoder.end(), '€');
});
await check('stream', async () => {
  const upper = new Transform({ transform(chunk, _encoding, done) { done(null, String(chunk).toUpperCase()); } });
  let text = '';
  await new Promise((resolve, reject) => pipeline(Readable.from(['a', 'b']), upper, async function* (source) {
    for await (const chunk of source) text += chunk;
  }, error => (error ? reject(error) : resolve())));
  return same(text, 'AB');
});
await check('readline', async () => {
  const lines = [];
  const reader = readline.createInterface({ input: Readable.from(['one\ntw', 'o\nthree']) });
  for await (const line of reader) lines.push(line);
  return same(lines.join(','), 'one,two,three');
});
await check('zlib', () => {
  const data = Buffer.from('compress me '.repeat(20));
  return same([zlib.gunzipSync(zlib.gzipSync(data)).equals(data), zlib.inflateSync(zlib.deflateSync(data)).equals(data),
    zlib.brotliDecompressSync(zlib.brotliCompressSync(data)).equals(data)].join(','), 'true,true,true');
});
await check('assert', () => {
  assert.deepStrictEqual({ a: [1] }, { a: [1] });
  assert.throws(() => assert.strictEqual(1, 2));
});
await check('structuredClone/AbortController', () => {
  const copy = structuredClone({ d: new Date(0), m: new Map([[1, 2]]) });
  const controller = new AbortController();
  controller.abort();
  return same([copy.d.getTime(), copy.m.get(1), controller.signal.aborted].join(','), '0,2,true');
});
await check('child_process', () => {
  const result = windows ? spawnSync('cmd.exe', ['/c', 'echo', 'hi'], { encoding: 'utf8' })
    : spawnSync('sh', ['-c', 'echo hi'], { encoding: 'utf8' });
  const exec = execSync(windows ? 'cmd.exe /c echo there' : 'echo there', { encoding: 'utf8' });
  return same(result.stdout.trim() + ':' + result.status + ':' + exec.trim(), 'hi:0:there');
});
await check('dns', () => new Promise((resolve, reject) =>
  dns.lookup('localhost', (error, address) => (error ? reject(error) : resolve(same(typeof address, 'string'))))));
await check('net', () => new Promise((resolve, reject) => {
  const server = net.createServer(socket => socket.end('pong'));
  server.listen(0, '127.0.0.1', () => {
    const client = net.connect(server.address().port, '127.0.0.1');
    let text = '';
    client.on('data', chunk => { text += chunk; });
    client.on('end', () => { server.close(); resolve(same(text, 'pong')); });
    client.on('error', reject);
  });
}));
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    response.setHeader('X-Probe', 'yes');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ method: request.method, auth: request.headers.authorization ?? null, body }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await check('http client', () => new Promise((resolve, reject) => {
  const request = http.request({ host: '127.0.0.1', port, path: '/x', method: 'PUT',
    headers: { Authorization: 'Bearer z', 'Content-Type': 'text/plain' } }, response => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { text += chunk; });
    response.on('end', () => resolve(same(response.headers['x-probe'] + ':' + text, 'yes:{"method":"PUT","auth":"Bearer z","body":"data"}')));
  });
  request.on('error', reject);
  request.end('data');
}));
await check('global fetch', async () => {
  const response = await fetch('http://127.0.0.1:' + port + '/f', { method: 'PATCH', headers: { Authorization: 'Bearer f' }, body: 'b' });
  return same(response.status + ':' + response.headers.get('x-probe') + ':' + (await response.json()).method, '200:yes:PATCH');
});
server.close();
try { fs.rmSync(work, { recursive: true, force: true }); } catch {}

process.stdout.write(JSON.stringify(report) + '\n');
