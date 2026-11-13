"""Exercise the compiled Node modules against real loopback and subprocess I/O."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import ssl
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'host'))
from native_page import Session, text_of


ENTRY = r'''import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { createHash, webcrypto } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

function check(value, operation) {
  if (!value) throw new Error(operation);
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    let result = '';
    stream.on('data', data => { result += data.toString(); });
    stream.on('end', () => resolve(result));
    stream.on('error', reject);
  });
}

function request(client, url, options) {
  return new Promise((resolve, reject) => {
    const req = client.get(url, options, response => {
      collect(response).then(body => resolve([response.statusCode, body]), reject);
    });
    req.on('error', reject);
  });
}

async function exercise() {
  const payload = 'compression Ω';
  check(gunzipSync(gzipSync(payload)).toString() === payload, 'gzip');
  check(brotliDecompressSync(brotliCompressSync(payload)).toString() === payload, 'brotli');
  check(createHash('sha256').update('abc').digest('hex') ===
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256');
  const random = webcrypto.getRandomValues(new Uint8Array(32));
  check(random.some(value => value !== 0), 'secure random');
  check((await webcrypto.subtle.digest('SHA-256', new Uint8Array([97, 98, 99]))).byteLength === 32, 'WebCrypto');

  const [file, args] = CHILD;
  check(execFileSync(file, args, {encoding: 'utf8', timeout: 3000}).trim() === 'child-ok', 'execFileSync');
  const child = spawn(file, args);
  const ended = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  check((await collect(child.stdout)).trim() === 'child-ok' && await ended === 0, 'spawn');

  const server = net.createServer(socket => socket.end('tcp-ok'));
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    check(await collect(net.connect(server.address().port, '127.0.0.1')) === 'tcp-ok', 'TCP loopback');
  } finally {
    server.close();
  }

  const service = http.createServer((req, response) => {
    response.writeHead(req.url === '/message' ? 200 : 404, {'content-type': 'text/plain'});
    response.end('http-ok');
  });
  await new Promise((resolve, reject) => {
    service.on('error', reject);
    service.listen(0, '127.0.0.1', resolve);
  });
  try {
    const [status, body] = await request(http, 'http://127.0.0.1:' + service.address().port + '/message', {});
    check(status === 200 && body === 'http-ok', 'HTTP client and server');
  } finally {
    service.close();
  }

  let untrusted = false;
  try { await request(https, HTTPS_URL, {}); } catch (error) { untrusted = true; }
  check(untrusted, 'HTTPS rejects untrusted certificate');
  const [status, body] = await request(https, HTTPS_URL, {ca: CERTIFICATE});
  check(status === 200 && body === 'https-ok', 'HTTPS with explicit CA');
  return 'Native Node modules passed';
}

const result = exercise().catch(error => 'Native Node probe failed: ' + error.message);
export default async function App() {
  return <main><p>{await result}</p></main>;
}
'''


class Handler(BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            # The untrusted-certificate check deliberately aborts a handshake.
            pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Length', '8')
        self.end_headers()
        self.wfile.write(b'https-ok')

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('reactc', type=Path)
    parser.add_argument('--target', choices=('host', 'windows'), required=True)
    args = parser.parse_args()
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='reactc-node-', dir=dist) as temporary:
        folder = Path(temporary)
        certificate, key = folder / 'cert.pem', folder / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
                        '-keyout', key, '-out', certificate], check=True, capture_output=True)
        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(certificate, key)
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            try:
                child = [r'C:\Windows\System32\cmd.exe', ['/d', '/c', 'echo', 'child-ok']] if args.target == 'windows' else ['/bin/echo', ['child-ok']]
                entry = folder / 'probe.tsx'
                entry.write_text(ENTRY.replace('CHILD', json.dumps(child))
                                 .replace('HTTPS_URL', json.dumps(f'https://127.0.0.1:{server.server_port}/'))
                                 .replace('CERTIFICATE', json.dumps(certificate.read_text())), encoding='utf-8')
                output = folder / 'build'
                subprocess.run([str(args.reactc.resolve()), 'build', str(entry.relative_to(ROOT)),
                                '--target', args.target, '--async-page', '--name', 'NodeProbe',
                                '--outdir', str(output.relative_to(ROOT))], cwd=ROOT, check=True, timeout=420)
                manifest = json.loads((output / 'manifest.json').read_text())
                assert 'porf_uws.cpp' in manifest['cSources']
                if args.target == 'windows':
                    assert 'porf_uws.windows.cpp' in manifest['cSources']
                    try:
                        subprocess.run([str(output / 'NodeProbe.exe'), '--smoke'], cwd=output, check=True, timeout=30)
                    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                        log = output / 'native-app-error.log'
                        if log.is_file():
                            print(log.read_text(), file=sys.stderr)
                        raise
                    snapshot = json.loads((output / 'native-app-smoke.json').read_text())
                else:
                    session = Session(str(output / 'app'))
                    try:
                        snapshot = session.snapshot
                    finally:
                        session.close()
                text = text_of(snapshot['tree'])
                assert text == 'Native Node modules passed', text
            finally:
                server.shutdown()
                worker.join()
    print(f'PASS: {args.target} TCP, subprocesses, compression, crypto, WebCrypto, HTTP and verified HTTPS')


if __name__ == '__main__':
    main()
