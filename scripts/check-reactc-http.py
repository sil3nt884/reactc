"""Run reactc's compiled client against a local synthetic HTTP test service."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'host'))
from native_http import read_http
from native_page import Session, find, text_of


ENTRY = '''import React from 'react';
export default function App() {
  const [result, setResult] = React.useState('waiting');
  const [connection, setConnection] = React.useState('online');
  React.useEffect(() => {
    const offline = () => setConnection('offline');
    window.addEventListener('offline', offline);
    fetch('http://localhost:LOCAL_PORT/message').then(response => response.json()).then(data => setResult(data.message)).catch(error => {
      console.log('Startup request failed:', error);
      setResult(error.message);
    });
    return () => window.removeEventListener('offline', offline);
  }, []);
  async function inspect() {
    try {
      const head = await fetch('/message', {method: 'HEAD'});
      const missing = await fetch('/missing');
      setResult([head.status, (await head.text()).length, missing.status, missing.ok, await missing.text()].join('|'));
    } catch (error) {
      console.log('Inspect request failed:', error);
      setResult(error.message);
    }
  }
  return <div><p id="result">{result}</p><p id="connection">{connection}</p><button id="inspect" onClick={inspect}>Inspect</button></div>;
}'''


FULL_ENTRY = '''import React from 'react';
export default function App() {
  const [result, setResult] = React.useState('waiting');
  React.useEffect(() => {
    (async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer t0k' };
      const put = await fetch('/items/1', { method: 'PUT', headers: auth, body: JSON.stringify({ title: 'Ω' }) });
      const putData = await put.json();
      const patch = await fetch('/items/1', { method: 'PATCH', headers: new Headers(auth), body: '{"done":true}' });
      const patched = await patch.json();
      const removed = await fetch('/items/1', { method: 'DELETE', headers: [['Authorization', 'Bearer t0k']] });
      const options = await fetch('/items', { method: 'OPTIONS' });
      const secret = await fetch('/secret', { cache: 'no-store' });
      const plain = await fetch('/echo', { method: 'POST', body: 'plain' });
      const echoed = await plain.json();
      let forbidden = 'allowed';
      try { await fetch('/echo', { headers: { Host: 'elsewhere' } }); } catch (error) { forbidden = 'refused'; }
      setResult([put.status, put.statusText, put.headers.get('X-Echo'), putData.method, putData.auth, putData.body,
        putData.contentType, patched.method, patched.body, removed.status, (await removed.text()).length,
        options.headers.get('allow'), secret.status, secret.statusText, secret.ok, echoed.contentType, echoed.body,
        forbidden].join('|'));
    })().catch(error => setResult('error: ' + error.message));
  }, []);
  return <p id="result">{result}</p>;
}'''
FULL_EXPECTED = ('201|Created|yes|PUT|Bearer t0k|{"title":"Ω"}|application/json|PATCH|{"done":true}|204|0|'
                 'GET, PUT, PATCH, DELETE, OPTIONS|401|Unauthorized|false|text/plain;charset=UTF-8|plain|refused')


class FullHandler(BaseHTTPRequestHandler):
    """Echoes method, Authorization, Content-Type and body for the full fetch app."""
    def reply(self, status, payload=None, headers=()):
        body = b'' if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        for name, value in headers:
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def echo(self):
        length = int(self.headers.get('Content-Length') or 0)
        return {'method': self.command, 'auth': self.headers.get('Authorization'),
                'contentType': self.headers.get('Content-Type'), 'body': self.rfile.read(length).decode()}

    def do_PUT(self):
        self.reply(201, self.echo(), [('X-Echo', 'yes')])

    def do_PATCH(self):
        self.reply(200, self.echo())

    def do_DELETE(self):
        self.echo()
        self.reply(204 if self.headers.get('Authorization') == 'Bearer t0k' else 401)

    def do_OPTIONS(self):
        self.reply(204, None, [('Allow', 'GET, PUT, PATCH, DELETE, OPTIONS')])

    def do_GET(self):
        self.reply(401, {'error': 'sign in'})

    def do_POST(self):
        self.reply(200, self.echo())

    def log_message(self, *_):
        pass


def settle(session, transport):
    """Answer the page's queued HTTP requests until it has none left."""
    snapshot = session.snapshot
    for _ in range(32):
        if not snapshot.get('requests'):
            return snapshot
        for request in snapshot['requests']:
            snapshot = session.send({'type': 'result', 'id': request['id'], 'result': transport(request)})
    raise AssertionError('The page kept requesting')


def check_full(reactc, folder):
    """Every method, request headers, bodies and response headers through the protocol core."""
    with ThreadingHTTPServer(('127.0.0.1', 0), FullHandler) as server:
        worker = threading.Thread(target=server.serve_forever)
        worker.start()
        try:
            entry = folder / 'full.tsx'
            entry.write_text(FULL_ENTRY, encoding='utf-8')
            output = folder / 'full-host'
            subprocess.run([str(reactc), 'build', str(entry.relative_to(ROOT)), '--http-origin',
                            f'http://127.0.0.1:{server.server_port}', '--target', 'host', '--outdir',
                            str(output.relative_to(ROOT))], cwd=ROOT, check=True, timeout=300)
            session = Session(str(output / 'app'), transport=read_http)
            try:
                result = text_of(find(settle(session, read_http), 'result'))
            finally:
                session.close()
            assert result == FULL_EXPECTED, result
        finally:
            server.shutdown()
            worker.join()
    print('PASS: native fetch PUT, PATCH, DELETE and OPTIONS, Authorization and Headers, bodies, '
          'status text, response headers, 401, and refused host-owned headers')


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body=b''):
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        if self.path == '/message':
            self.reply(200, '{"message":"Hello Ω"}'.encode())
        else:
            self.reply(404, b'missing')

    def do_HEAD(self):
        self.reply(200, b'head')

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('reactc', type=Path)
    parser.add_argument('--windows-smoke', action='store_true', help='Also run the Windows executable with the server offline')
    args = parser.parse_args()
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    # Keep the entry and output on the checkout's drive when reactc is a Windows binary.
    with TemporaryDirectory(prefix='reactc-http-', dir=dist) as directory:
        folder = Path(directory)
        entry = folder / 'entry.tsx'
        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            entry.write_text(ENTRY.replace('LOCAL_PORT', str(server.server_port)), encoding='utf-8')
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            origin = f'http://127.0.0.1:{server.server_port}'

            def build(target, output, *extra):
                subprocess.run([str(args.reactc.resolve()), 'build', str(entry.relative_to(ROOT)),
                                '--http-origin', origin, '--target', target, '--outdir',
                                str(output.relative_to(ROOT)), *extra], cwd=ROOT, check=True, timeout=300)
                manifest = json.loads((output / 'manifest.json').read_text())
                assert manifest['httpOrigin'] == origin
                assert all((output / source).is_file() for source in manifest['cSources'])
                return manifest

            session = None
            try:
                host = folder / 'host'
                manifest = build('host', host)
                assert {'app.c', 'host.c'} <= set(manifest['cSources'])
                windows = folder / 'windows'
                manifest = build('windows', windows, '--emit-c')
                assert set(manifest['cSources']) == {'app.c', 'app.windows.c', 'entry.c', 'windows-host.c'}
                assert manifest['windowsThreading']['hostRequests'] == 'protocol-worker'
                assert not list(windows.glob('*.exe'))
                session = Session(str(host / 'app'), transport=read_http)
                request, = session.snapshot['requests']
                snapshot = session.send({'type': 'result', 'id': request['id'], 'result': read_http(request)})
                assert text_of(find(snapshot, 'result')) == 'Hello Ω'
                snapshot = session.event('inspect', 'press')
                assert text_of(find(snapshot, 'result')) == '200|0|404|false|missing'
                server.shutdown()
                server.server_close()
                snapshot = session.event('inspect', 'press')
                assert text_of(find(snapshot, 'result')) == 'Native HTTP request failed'
                assert text_of(find(snapshot, 'connection')) == 'offline'
                if args.windows_smoke:
                    windows_app = folder / 'windows-app'
                    build('windows', windows_app, '--name', 'HttpProbe')
                    subprocess.run([str(windows_app / 'HttpProbe.exe'), '--smoke'],
                                   cwd=windows_app, check=True, timeout=25)
                    snapshot = json.loads((windows_app / 'native-app-smoke.json').read_text())
                    assert text_of(find(snapshot, 'result')) == 'Native HTTP request failed'
                    assert text_of(find(snapshot, 'connection')) == 'offline'
                    print('PASS: Windows offline startup logs to stderr and still renders')
            finally:
                server.shutdown()
                worker.join()
                if session:
                    session.close()
        check_full(args.reactc.resolve(), folder)
    print('PASS: native reactc GET and HEAD, UTF-8, HTTP and connection errors, and host/Windows C output')


if __name__ == '__main__':
    main()
