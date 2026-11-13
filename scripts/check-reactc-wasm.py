"""Build and exercise a WASI page through the same protocol as the desktop host."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'host'))
from native_http import read_http
from native_page import Session, find, text_of, wasi_command

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = '{"message":"Hello Ω"}'.encode()
        self.send_response(200 if self.path == '/message' else 404)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


HTTP_ENTRY = '''import { useState } from 'react';

export default function App() {
  const [status, setStatus] = useState('Ready');
  async function check() {
    try {
      const original = 'native Ω 😀';
      const response = await fetch('/message');
      if (!response.ok) throw Error('HTTP ' + response.status);
      setStatus((await response.json()).message + ' · ' + original);
    } catch (error) {
      console.error(error);
      setStatus('Failed: ' + error.message);
    }
  }
  return <main><p id="result">{status}</p><button id="check" onClick={check}>Check</button></main>;
}
'''

FILES_ENTRY = '''import fs from 'node:fs';
import {readFile, writeFile, readdir} from 'node:fs/promises';

async function exercise() {
  const file = '/data/Ω.txt';
  const content = 'native Ω 😀';
  fs.writeFileSync(file, content, 'utf8');
  if (fs.readFileSync(file, 'utf8') !== content) return 'sync filesystem failed';
  await writeFile('/data/copy.txt', await readFile(file));
  if ((await readdir('/data')).length !== 2) return 'promise filesystem failed';
  let denied = false;
  try { fs.writeFileSync('/outside.txt', 'denied'); } catch { denied = true; }
  return denied ? content : 'access outside the granted directory';
}

export default async function App() {
  return <main><p id="result">{await exercise()}</p></main>;
}
'''

STREAMS_ENTRY = '''import fs from 'node:fs';
import { Readable } from 'node:stream';

function collect(stream) {
  return new Promise((resolve, reject) => {
    let text = '';
    stream.on('data', chunk => { text += chunk; });
    stream.on('error', reject);
    stream.on('end', () => resolve(text));
  });
}

export default async function App() {
  const memory = await collect(Readable.from(['a', 'b']));
  const file = await collect(fs.createReadStream('/data/Ω.txt', {encoding: 'utf8'}));
  return <main><p id="result">{memory + ' · ' + file}</p></main>;
}
'''

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reactc', type=Path)
    engine = parser.add_mutually_exclusive_group()
    engine.add_argument('--wasmtime')
    engine.add_argument('--wasm-runtime')
    args = parser.parse_args()
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='reactc-wasm-', dir=dist) as temporary:
        folder = Path(temporary)
        data = folder / 'data'
        data.mkdir()

        def build(name, source, *flags):
            entry = folder / (name + '.tsx')
            entry.write_text(source, encoding='utf-8')
            output = folder / name
            command = [str(args.reactc.resolve()), 'build', str(entry.relative_to(ROOT)), '--target', 'wasm',
                       '--outdir', str(output.relative_to(ROOT)), *flags]
            subprocess.run(command, cwd=ROOT, check=True, timeout=300)
            manifest = json.loads((output / 'manifest.json').read_text())
            assert manifest['nativeTarget'] == 'wasm32-wasip1'
            assert manifest['cSources'] == ['app.c', 'app.wasi.c', 'wasi.c']
            assert all((output / source).is_file() for source in manifest['cSources'])
            wasm = output / (name + '.wasm')
            with wasm.open('rb') as stream:
                assert stream.read(8) == b'\x00asm\x01\x00\x00\x00'
            return wasm

        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                wasm = build('http', HTTP_ENTRY, '--http-origin', f'http://127.0.0.1:{server.server_port}')
                command = wasi_command(wasm, args.wasmtime, runtime=args.wasm_runtime)
                session = Session(command, transport=read_http, startup_timeout=60)
                try:
                    assert text_of(find(session.snapshot, 'result')) == 'Ready'
                    result = text_of(find(session.event('check', 'press'), 'result'))
                    assert result == 'Hello Ω · native Ω 😀', result
                finally:
                    session.close()
            finally:
                server.shutdown()
                thread.join()

        for name, source, expected in [
            ('files', FILES_ENTRY, 'native Ω 😀'),
            ('streams', STREAMS_ENTRY, 'ab · native Ω 😀'),
        ]:
            wasm = build(name, source, '--async-page')
            command = wasi_command(wasm, args.wasmtime, [f'{data}::/data'], runtime=args.wasm_runtime)
            session = Session(command, startup_timeout=60)
            try:
                result = text_of(find(session.snapshot, 'result'))
                assert result == expected, result
            finally:
                session.close()
        assert (data / 'copy.txt').read_text(encoding='utf-8') == 'native Ω 😀'
    print('PASS: compiled WebAssembly state and HTTP, Node filesystem and streams, and WASI directory grants')


if __name__ == '__main__':
    main()
